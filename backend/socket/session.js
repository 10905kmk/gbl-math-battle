import {
  startBattleRoom,
  finishBattleRoomNow,
  startNextRound,
  saveLastRoundResults,
  resetBattleHistory,
  getBattleRoom,
} from './battle.js';
import { saveParticipantResults } from '../lib/resultStorage.js';
import { fallbackDamage, fallbackAttackRange } from '../routes/weaponEvaluate.js';
import { logError, getErrorLog } from '../lib/errorLog.js';

// 세션(코호트) 상태 — 부스 참가자들이 공유하는 stage, slideIndex, 참가자 진행도.
// 목표 인원(expectedParticipants)은 고정값이 아니라 admin:startSession 시점에 그때까지
// participant:join을 보낸 소켓 수로 매번 새로 고정된다(참가 인원 유동화 설계 문서 참고).
const cohort = {
  stage: 'idle',
  slideIndex: 0,
  // { id, name, createDone, weapon } — participant:join 시점에 엔트리가 생기고
  // disconnect로만 제거된다. admin:reset/admin:startSession은 엔트리 자체는 남기고
  // 이번 라운드 관련 필드(name/createDone/weapon)만 초기화한다 — 기기를 새로고침 없이
  // 계속 켜두는 운영 방식이라(2026-08-07 설계 문서), "몇 명이 접속해 있는지"와 "이번
  // 라운드에서 뭘 했는지"를 분리해야 한다. 예전엔 joined(Set) + participantNames(Map) +
  // cohort.participants(create 완료자만) 세 구조로 흩어져 있었는데, 관리자 대시보드가
  // "지금 접속한 모두"를 실시간으로 봐야 해서 하나로 합쳤다.
  participants: [],
  expectedParticipants: 0,
  // battle 단계에 들어간 시점의 참가자 스냅샷 — 여러 판을 도는 동안 이 목록을 계속 쓰고,
  // 마지막에 결과를 저장할 때도 이걸 기준으로 한다(대전 도중 나간 참가자도 결과에 남아야 함).
  battleRoster: [],
};

// 관리자가 수동으로 단계를 앞뒤로 넘길 때의 순서. idle은 startSession/reset으로만 드나든다.
// 'name'이 맨 앞에 추가됨(2026-08-07) — 기기를 새로고침 없이 계속 켜두므로 라운드마다
// 이름을 다시 물어봐야 해서, 전역 화면 게이트가 아니라 실제 stage로 승격시켰다.
const STAGE_ORDER = ['name', 'learn', 'create', 'battle', 'result', 'thanks'];

// 라운드가 최종적으로 마무리될 때(= 관리자가 "부스 종료"를 누르거나 battle 단계를 벗어날
// 때) 결과를 Supabase에 저장하고 각 참가자에게 자기 결과 행의 id를 보내준다.
//
// 한 팀이 여러 판을 도는 운영 방식이라(2026-08-09) 매 판 끝날 때마다 저장하지 않는다 —
// 판마다 행이 쌓이면 QR이 어느 판의 결과를 가리키는지 알 수 없어진다. 저장은 마지막 한 번.
function makeSaveResultsCallback(io, roster) {
  return (winners, scores) => {
    // 저장이 끝나야 각 참가자 결과 행의 id를 알 수 있다(QR/링크가 그 id로 result-page를
    // 가리켜야 하므로) — outcomes는 roster와 같은 순서라 인덱스로 그대로 짝지을 수 있다.
    // 저장 실패(rejected)한 참가자에게는 보내지 않는다 — 존재하지 않는 id로 QR을 만들면
    // 스캔했을 때 "결과 없음"만 보게 되므로, 아예 안 보내는 쪽이 참가자 화면이 QR 없이
    // 요약만 보여주는 정상적인 폴백으로 이어진다.
    saveParticipantResults(roster, winners, scores)
      .then((outcomes) => {
        outcomes.forEach((outcome, i) => {
          if (outcome.status === 'fulfilled' && outcome.value?.id) {
            io.to(roster[i].id).emit('result:saved', { id: outcome.value.id });
          }
        });
      })
      .catch((err) => {
        logError('session', err);
      });
  };
}

function goToStage(io, nextStage) {
  cohort.stage = nextStage;
  cohort.slideIndex = 0;
  io.emit('stage:change', cohort.stage);
  if (nextStage === 'battle') {
    // 대전 시작 시점의 참가자 목록을 스냅샷으로 떼어둔다 — cohort.participants는 대전 도중
    // 참가자가 연결을 끊으면 disconnect 핸들러가 그 참가자를 걸러낸 "새 배열"로 재할당해버려서,
    // 라운드가 끝난 뒤 결과 저장 시점엔 이미 그 참가자가 사라지고 없다(연결이 끊겼어도 대전
    // 결과 자체는 저장돼야 하므로, 대전 중 필터링과 결과 저장은 서로 다른 참가자 목록을 봐야 함).
    cohort.battleRoster = [...cohort.participants];
    startBattleRoom(io, cohort.battleRoster, {
      onEnd: makeSaveResultsCallback(io, cohort.battleRoster),
    });
  } else {
    // battle이 아닌 다른 단계로 넘어가면 진행 중이던 대전은 더 이상 의미가 없으니 같이
    // 정리해야 한다. stopBattleRoom()으로 그냥 중단시키면 tick interval만 죽고
    // 결과 저장/battle:result/result:saved 경로 전체가 스킵된다 — create/battle 전환이
    // 이제 관리자 수동이라(자동 전환 없음), "관리자가 타이머 만료를 기다리지 않고 다음
    // 단계를 누른다"가 실제로 흔히 일어날 수 있는 정상 경로가 됐다(2026-08-07 Opus
    // 리뷰). 그래서 finishBattleRoomNow()로 지금 시점 점수를 그대로 정상 종료 처리한다 —
    // 라운드가 이미 자연 종료돼 battleRoom이 없으면 조용히 아무 일도 안 하므로 항상
    // 안전하게 호출할 수 있다.
    finishBattleRoomNow();
  }
}

function doneCount() {
  return cohort.participants.filter((p) => p.createDone).length;
}

function broadcastProgress(io) {
  // 오른쪽 값은 고정 목표 인원이 아니라 현재 세션에 실제 연결된 참가자 수다.
  // disconnect에서 참가자 엔트리를 제거하므로 새로고침/이탈 뒤 유령 인원이 남지 않는다.
  io.emit('create:progress', { done: doneCount(), total: cohort.participants.length });
}

function broadcastParticipants(io) {
  io.emit('admin:participants', cohort.participants);
}

// admin:reset과 admin:startSession 둘 다 이걸 부른다 — 참가자 엔트리(연결 식별자) 자체는
// 남기고 "이번 라운드" 관련 필드만 지운다. 안 그러면 admin:reset을 거치지 않고 바로
// 다음 admin:startSession을 눌러도(실제 운영에서 흔함) 이전 라운드의 이름/완료 상태가
// 새 라운드로 그대로 넘어온다.
function resetRoundFields() {
  cohort.participants.forEach((p) => {
    p.name = null;
    p.createDone = false;
    p.weapon = null;
  });
}

function findOrCreateParticipant(id) {
  let entry = cohort.participants.find((p) => p.id === id);
  if (!entry) {
    entry = { id, name: null, createDone: false, weapon: null };
    cohort.participants.push(entry);
  }
  return entry;
}

function sanitizeParticipantName(name) {
  const safeName = typeof name === 'string' ? name.trim().slice(0, 20) : '';
  return safeName || null;
}

// admin:forceFinish가 부여하는 "기본 무기" — AI 평가 자체를 시도하지 않은 참가자용이므로
// weaponEvaluate.js가 AI 평가 "실패" 시 쓰는 결정론적 폴백을 그대로 재사용한다(빈
// parts에 대한 값은 항상 DAMAGE_MIN/melee로 고정) — 새 상수를 따로 만들지 않아 두 값이
// 나중에 어긋날 걱정이 없다.
// 무기 이름은 참가자가 직접 입력한 값이라(frontend/src/screens/create.js) 그대로 믿지
// 않는다 — 이 값은 Supabase에 저장돼서 결과 상시 페이지와 PDF 증서의 제목으로 다시
// 렌더링되므로, participant:name과 같은 수준(문자열 확인 + trim + 길이 제한)으로 막는다.
// 클라이언트도 같은 대체 이름을 쓰지만, create:done을 직접 쏘는 경로가 있을 수 있으니
// 서버에서도 빈 이름을 대체해둔다.
const WEAPON_NAME_MAX = 24;

export function sanitizeWeaponName(name) {
  const safe = typeof name === 'string' ? name.trim().slice(0, WEAPON_NAME_MAX) : '';
  return safe || '이름 없는 무기';
}

function defaultWeapon() {
  const { attackRange, attackRangeDistance } = fallbackAttackRange({ parts: [] });
  return {
    name: '기본 무기',
    image: null,
    damage: fallbackDamage({ parts: [] }),
    attackRange,
    attackRangeDistance,
    parts: [],
  };
}

export function registerSessionHandlers(io, socket) {
  // 새로 연결된 소켓(새로고침한 참가자, 나중에 여는 관리자/공용화면 등)에게 현재 상태를
  // 바로 알려준다. 이게 없으면 stage:change/learn:slide 등은 "그 이후 변경분"만 받기
  // 때문에 계속 idle/빈 값으로 보인다.
  socket.emit('stage:change', cohort.stage);
  socket.emit('learn:slide', cohort.slideIndex);
  socket.emit('create:progress', { done: doneCount(), total: cohort.participants.length });
  socket.emit('admin:participants', cohort.participants);
  socket.emit('admin:errorLog', getErrorLog());

  // 참가자 화면만 보내는 신호 — 관리자/공용화면은 이 이벤트를 보내지 않으므로
  // cohort.participants에 안 잡힌다.
  socket.on('participant:join', (payload) => {
    const entry = findOrCreateParticipant(socket.id);
    // 새로고침/네트워크 재연결 때 브라우저가 보존한 이름을 참가 등록과 동시에 복원한다.
    // payload가 없는 기존 클라이언트는 현재 이름을 덮어쓰지 않아 하위 호환된다.
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'name')) {
      entry.name = sanitizeParticipantName(payload.name);
    }
    if (cohort.stage !== 'idle') broadcastProgress(io);
    broadcastParticipants(io);
  });

  // 참가자 이름 — 인원수 집계(participant:join)와 완전히 분리된 별도 신호다. 클라이언트가
  // 보낸 값을 그대로 믿지 않고 문자열인지 확인한 뒤 trim + 20자로 제한한다.
  socket.on('participant:name', (name) => {
    // participant:join과 별개 신호라 도착 순서를 100% 보장할 수 없다 — 엔트리가 아직
    // 없으면(이론상으론 join이 먼저 오지만) findOrCreateParticipant로 만들어서 이름을
    // 잃어버리지 않는다.
    const entry = findOrCreateParticipant(socket.id);
    entry.name = sanitizeParticipantName(name);
    if (cohort.stage !== 'idle') broadcastProgress(io);
    broadcastParticipants(io);
  });

  socket.on('admin:startSession', () => {
    // 이 시점까지 접속해 있던(=cohort.participants에 엔트리가 있는) 참가자 수를 이번
    // 세션의 목표 인원으로 고정한다.
    cohort.expectedParticipants = cohort.participants.length;
    // 새 라운드가 시작되므로 이전 라운드의 이름/제작 완료 상태를 지운다(resetRoundFields
    // 주석 참고) — admin:reset을 거치지 않고 바로 다음 세션을 시작하는 경우에도 항상
    // 여기서 초기화되어야 한다.
    resetRoundFields();
    console.log(`[session] 세션 시작 — 목표 인원 ${cohort.expectedParticipants}명으로 고정`);
    goToStage(io, 'name');
    broadcastProgress(io);
    broadcastParticipants(io);
  });

  socket.on('admin:nextSlide', () => {
    cohort.slideIndex += 1;
    io.emit('learn:slide', cohort.slideIndex);
  });

  socket.on('admin:prevSlide', () => {
    cohort.slideIndex = Math.max(0, cohort.slideIndex - 1);
    io.emit('learn:slide', cohort.slideIndex);
  });

  socket.on('admin:nextStage', () => {
    const idx = STAGE_ORDER.indexOf(cohort.stage);
    const next = STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];
    goToStage(io, next);
  });

  socket.on('admin:prevStage', () => {
    const idx = STAGE_ORDER.indexOf(cohort.stage);
    if (idx <= 0) return;
    goToStage(io, STAGE_ORDER[idx - 1]);
  });

  // 순위 대시보드에서 "새로운 판" — 같은 참가자/무기로 다음 라운드를 바로 시작한다.
  // 제작 단계로 되돌아가지 않으므로 한 시간대에 여러 판을 빠르게 돌릴 수 있다.
  socket.on('admin:newRound', () => {
    if (cohort.stage !== 'battle') return;
    // 대전 중 완전히 나간 기기는 새 판에서 빼고, 그 사이 새로 들어온 기기는 넣는다 —
    // 다만 결과 저장은 battleRoster(첫 판 기준)로 하므로 그쪽은 건드리지 않는다.
    const roster = cohort.battleRoster.filter((p) => cohort.participants.some((c) => c.id === p.id));
    startNextRound(io, roster.length > 0 ? roster : cohort.battleRoster, {
      onEnd: makeSaveResultsCallback(io, cohort.battleRoster),
    });
  });

  // "부스 종료" — 마지막 판의 점수로 결과를 저장하고 결과(QR/PDF) 단계로 넘긴다.
  // 진행 중인 판이 있으면 그 시점 점수로 정상 종료시키고, 이미 대시보드가 떠 있으면
  // 저장해둔 마지막 순위표로 저장만 한다.
  socket.on('admin:endBooth', () => {
    if (getBattleRoom()) {
      finishBattleRoomNow({ saveResults: true });
    } else {
      saveLastRoundResults(makeSaveResultsCallback(io, cohort.battleRoster));
    }
    goToStage(io, 'result');
  });

  socket.on('admin:reset', () => {
    resetBattleHistory();
    cohort.battleRoster = [];
    cohort.stage = 'idle';
    cohort.slideIndex = 0;
    resetRoundFields();
    cohort.expectedParticipants = 0;
    io.emit('stage:change', cohort.stage);
    broadcastProgress(io);
    broadcastParticipants(io);
  });

  socket.on('create:done', (weapon) => {
    const entry = findOrCreateParticipant(socket.id);
    entry.createDone = true;
    entry.weapon =
      weapon && typeof weapon === 'object'
        ? { ...weapon, name: sanitizeWeaponName(weapon.name) }
        : defaultWeapon();
    broadcastProgress(io);
    broadcastParticipants(io);
  });

  // 관리자가 제작 단계에서 시간을 다 채우고도 완료하지 못한 참가자("낙오자")를 강제로
  // 마감시킬 때 쓴다 — create -> battle 전환이 이제 전원 완료를 기다리지 않고 관리자
  // 수동으로 일어나므로, 이걸 안 만들면 미완료 참가자는 무기 없이 battle에서 통째로
  // 빠진다(대전 참여도 결과 저장도 못 함).
  socket.on('admin:forceFinish', (participantId) => {
    const entry = cohort.participants.find((p) => p.id === participantId);
    if (!entry || entry.createDone) return;
    entry.createDone = true;
    entry.weapon = defaultWeapon();
    broadcastProgress(io);
    broadcastParticipants(io);
  });

  // 참가자가 실수로 "AI 평가받기"를 눌러 제작이 확정돼버린 경우, 관리자가 그 참가자만
  // 편집 화면으로 되돌려준다. 평가 자체가 "되돌릴 수 없음"인 건 참가자에게 신중하게
  // 만들라고 거는 제약이지 운영 사고까지 감수하겠다는 뜻은 아니다 — 되돌리는 권한은
  // 관리자에게만 둔다.
  //
  // create 단계에서만 허용한다: battle로 넘어간 뒤엔 이미 대전 시작 시점의 참가자
  // 스냅샷(goToStage의 participantsAtBattleStart)이 떠 있어서, 여기서 무기를 지워봐야
  // 진행 중인 대전에는 반영되지 않고 결과 저장만 어긋난다.
  socket.on('admin:reopenCreate', (participantId) => {
    if (cohort.stage !== 'create') return;
    const entry = cohort.participants.find((p) => p.id === participantId);
    if (!entry || !entry.createDone) return;
    entry.createDone = false;
    entry.weapon = null;
    // 해당 참가자 기기만 편집 화면으로 되돌린다. 캔버스에 올려둔 도형과 무기 이름은
    // 클라이언트가 계속 들고 있으므로(CreateScreen이 계속 마운트된 채 phase만 바뀜)
    // 참가자는 만들던 그대로에서 이어서 고칠 수 있다.
    io.to(entry.id).emit('create:reopen');
    broadcastProgress(io);
    broadcastParticipants(io);
  });

  // 참가자가 완전히 연결을 끊으면(기기를 끄거나 브라우저를 닫는 등) 명단에서 제거한다.
  // 새로고침만으로는 여기 안 온다고 가정하면 안 된다 — 새로고침도 기존 소켓의
  // disconnect를 먼저 발생시키고 새 소켓으로 다시 연결되므로, 옛 id를 지워두지 않으면
  // 유령 참가자가 계속 쌓인다(Opus 리뷰 Critical #2b, 실제로 재현됨).
  socket.on('disconnect', () => {
    const before = cohort.participants.length;
    cohort.participants = cohort.participants.filter((p) => p.id !== socket.id);
    if (cohort.participants.length !== before) {
      broadcastProgress(io);
      broadcastParticipants(io);
    }
  });
}
