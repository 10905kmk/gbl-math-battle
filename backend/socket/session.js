import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startBattleRoom,
  startNextRound,
  leaveBattleStage,
  resetBattleHistory,
} from './battle.js';
import { saveParticipantResults } from '../lib/resultStorage.js';
import { fallbackDamage, fallbackAttackRange } from '../routes/weaponEvaluate.js';
import { logError, getErrorLog } from '../lib/errorLog.js';

// admin:nextSlide 상한을 정하려면 슬라이드 개수를 알아야 한다 — 프론트가 렌더링에 쓰는
// 원본 JSON을 그대로 읽어서 슬라이드 콘텐츠를 중복 관리하지 않는다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SLIDE_COUNT = JSON.parse(
  readFileSync(path.join(__dirname, '../../frontend/src/content/shapes-slides.json'), 'utf-8'),
).length;

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

// socket.id -> socket 참조 — admin:kickParticipant가 io.sockets.sockets(실제 Socket.IO
// 서버 내부 레지스트리)에 의존하지 않고도 대상 소켓을 직접 끊을 수 있게 이 모듈이 스스로
// 들고 있는다. 테스트 목 io는 io.sockets를 흉내내지 않으므로, 여기 의존하면 목 소켓에도
// 실제 서버와 같은 구조를 강제해야 해서 더 무거워진다.
const connectedSockets = new Map();

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
  return (winners, scores, kda) => {
    // 저장이 끝나야 각 참가자 결과 행의 id를 알 수 있다(QR/링크가 그 id로 result-page를
    // 가리켜야 하므로) — outcomes는 roster와 같은 순서라 인덱스로 그대로 짝지을 수 있다.
    // 저장 실패(rejected)한 참가자에게는 보내지 않는다 — 존재하지 않는 id로 QR을 만들면
    // 스캔했을 때 "결과 없음"만 보게 되므로, 아예 안 보내는 쪽이 참가자 화면이 QR 없이
    // 요약만 보여주는 정상적인 폴백으로 이어진다.
    saveParticipantResults(roster, winners, scores, kda)
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
  // battle을 실제로 "떠나는" 순간에만 아래 정리 로직을 태운다 — nextStage가 battle이
  // 아닌 다른 두 단계 사이를 오갈 때마다(예: result -> thanks) 또 실행되면 이미 저장한
  // 라운드를 중복 저장하게 된다.
  const wasInBattle = cohort.stage === 'battle';
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
  } else if (wasInBattle) {
    // battle을 떠나면 진행 중이던 대전은 더 이상 의미가 없으니 같이 정리해야 한다 —
    // 진행 중이었는지/룰렛·카운트다운 중이었는지/이미 자연 종료돼 대시보드만 남았는지는
    // battle.js만 알고 있으므로 그 판단을 여기서 직접 하지 않는다(Opus 리뷰 Important #7,
    // 2026-08-10 — 예전엔 여기서 getBattleRoom() truthy/falsy로 직접 분기했는데 status까지는
    // 몰라 Critical #1 사각지대가 생겼었다).
    leaveBattleStage(makeSaveResultsCallback(io, cohort.battleRoster));
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

// 기기 번호는 접속 순서대로 자동 배정되고(admin:setDeviceNumber로 관리자가 언제든
// 덮어쓸 수 있음), admin:reset/admin:startSession을 거쳐도 유지된다 — resetRoundFields가
// 참가자 엔트리 자체는 남기고 이번 라운드 필드만 지우는 것과 같은 이유로, 기기 번호는
// "이번 라운드"가 아니라 "이 물리적 기기"에 대한 정보이기 때문이다. 단, 와이파이
// 순단 등으로 소켓이 완전히 끊겼다 재연결되면 새 엔트리(새 socket.id)로 취급돼 새
// 번호를 받는다 — 그 경우엔 관리자가 admin:setDeviceNumber로 다시 맞춰주면 된다.
let nextDeviceNumber = 1;

function findOrCreateParticipant(io, id) {
  let entry = cohort.participants.find((p) => p.id === id);
  if (!entry) {
    entry = { id, name: null, createDone: false, weapon: null, deviceNumber: nextDeviceNumber };
    nextDeviceNumber += 1;
    cohort.participants.push(entry);
    // 참가자 기기 화면 한구석에 자기 번호를 계속 띄워두려는 용도 — 스태프가 그
    // 노트북 화면만 보고도 몇 번 기기인지 바로 알 수 있게 한다(admin:setDeviceNumber로
    // 나중에 바뀌면 그때도 다시 쏴준다, 아래 핸들러 참고).
    io.to(id).emit('device:number', entry.deviceNumber);
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
  connectedSockets.set(socket.id, socket);

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
    const entry = findOrCreateParticipant(io, socket.id);
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
    const entry = findOrCreateParticipant(io, socket.id);
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
    // SLIDE_COUNT(마지막 슬라이드 다음 한 칸, "마지막 슬라이드입니다" 상태)에서 멈춘다 —
    // 클램프가 없으면 다음 버튼을 계속 누를 때마다 끝없이 커져서 이전 버튼을 그만큼
    // 여러 번 눌러야 슬라이드 목록으로 돌아오게 된다.
    cohort.slideIndex = Math.min(SLIDE_COUNT, cohort.slideIndex + 1);
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
    // 대전 중 완전히 나간 기기는 새 판에서 빼고, 그 사이 재접속했거나(새 socket.id) 새로
    // 무기를 완성한 기기는 넣는다 — 예전엔 filter(제거)만 하고 추가하는 로직이 없어서
    // 재접속한 참가자가 그 이후 모든 판에서 영구히 배제됐다(Opus 리뷰 Important #3,
    // 2026-08-10). 다만 결과 저장은 battleRoster(첫 판 기준)로 하므로 그쪽은 건드리지 않는다.
    const stayed = cohort.battleRoster.filter((p) => cohort.participants.some((c) => c.id === p.id));
    const newcomers = cohort.participants.filter(
      (c) => c.weapon != null && !stayed.some((p) => p.id === c.id),
    );
    const roster = [...stayed, ...newcomers];
    startNextRound(io, roster.length > 0 ? roster : cohort.battleRoster, {
      onEnd: makeSaveResultsCallback(io, cohort.battleRoster),
    });
  });

  // "부스 종료" — 마지막 판의 점수로 결과를 저장하고 결과(QR/PDF) 단계로 넘긴다.
  // 진행 중인 판이 있는지/이미 대시보드만 떠 있는지에 따라 저장 방식이 달라지는데,
  // goToStage가 battle을 떠나는 모든 경로(다음 단계/이전 단계/부스 종료)에 대해 이미
  // 똑같은 분기를 갖고 있으므로 여기서 따로 처리하지 않는다 — 중복 처리하면 결과가
  // 두 번 저장된다(2026-08-10 실측).
  socket.on('admin:endBooth', () => {
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
    const entry = findOrCreateParticipant(io, socket.id);
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
  // create 단계에서만 허용한다 — admin:reopenCreate와 같은 이유(292행 참고)로, 이 가드가
  // 없으면 battle 단계 중에도 눌러서 cohort.battleRoster 안의 같은 참가자 객체를 그
  // 자리에서 바꿔버릴 수 있었다. 지금 진행 중인 판에는 영향 없지만(buildPlayer가 이미
  // 스냅샷을 떴으므로), 관리자가 이후 "새로운 판"을 누르면 아무 명시적 조치 없이 조용히
  // 무기가 바뀐 채로 시작된다(Opus 리뷰 Important #6, 2026-08-10).
  socket.on('admin:forceFinish', (participantId) => {
    if (cohort.stage !== 'create') return;
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

  // 유령/불필요한 연결을 관리자가 즉시 끊을 때 쓴다 — 이름 없이 오래 떠 있는 소켓이나
  // 자리를 뜬 참가자가 핑퐁 타임아웃(자연 disconnect)을 기다리지 않고 명단에서 바로
  // 빠지게 한다. 대상 소켓의 연결을 실제로 끊으므로(disconnect(true)) 정리/재브로드캐스트는
  // 아래 'disconnect' 핸들러가 그대로 처리한다 — 로직을 여기 따로 둘 필요가 없다.
  socket.on('admin:kickParticipant', (participantId) => {
    connectedSockets.get(participantId)?.disconnect(true);
  });

  // 자동 배정된 기기 번호를 관리자가 덮어쓴다(세션 시작 전 기기 관리용) — 유효한
  // 양의 정수가 아니거나 이미 다른 기기가 쓰는 번호면 조용히 무시한다(번호 중복은
  // "몇 번 기기냐"는 식별 목적 자체를 무너뜨리므로).
  socket.on('admin:setDeviceNumber', (participantId, number) => {
    const entry = cohort.participants.find((p) => p.id === participantId);
    if (!entry) return;
    if (!Number.isInteger(number) || number <= 0) return;
    const alreadyUsed = cohort.participants.some((p) => p.id !== participantId && p.deviceNumber === number);
    if (alreadyUsed) return;
    entry.deviceNumber = number;
    io.to(entry.id).emit('device:number', entry.deviceNumber);
    broadcastParticipants(io);
  });

  // 참가자가 완전히 연결을 끊으면(기기를 끄거나 브라우저를 닫는 등) 명단에서 제거한다.
  // 새로고침만으로는 여기 안 온다고 가정하면 안 된다 — 새로고침도 기존 소켓의
  // disconnect를 먼저 발생시키고 새 소켓으로 다시 연결되므로, 옛 id를 지워두지 않으면
  // 유령 참가자가 계속 쌓인다(Opus 리뷰 Critical #2b, 실제로 재현됨).
  socket.on('disconnect', () => {
    connectedSockets.delete(socket.id);
    const before = cohort.participants.length;
    cohort.participants = cohort.participants.filter((p) => p.id !== socket.id);
    if (cohort.participants.length !== before) {
      broadcastProgress(io);
      broadcastParticipants(io);
    }
  });
}

// 부스 QR 체크인(backend/socket/checkin.js)이 쓰는 헬퍼 — cohort.participants를
// 직접 export하지 않고 이 세 함수로만 접근을 허용해, checkin.js가 cohort 내부 구조를
// 몰라도 되게 한다.

// 아직 이름을 받지 않은 기기(=참가자가 QR로 배정될 수 있는 기기)를 찾는다.
export function findUnassignedParticipant() {
  return cohort.participants.find((p) => p.name === null) ?? null;
}

export function assignParticipantName(io, id, name) {
  const entry = cohort.participants.find((p) => p.id === id);
  if (!entry) return false;
  entry.name = sanitizeParticipantName(name);
  if (cohort.stage !== 'idle') broadcastProgress(io);
  broadcastParticipants(io);
  return true;
}

// 이름까지 입력했지만 부스를 나간 참가자의 기기를 새 참가자에게 다시 내줄 때 쓴다.
// battle 단계에서는 거부한다 — 이미 대전 시작 시점의 참가자 스냅샷(cohort.battleRoster)이
// 떠 있어서, 여기서 지워봐야 진행 중인 대전에는 반영되지 않고 다음 판 로스터 계산만
// 어긋난다(admin:reopenCreate가 create 단계로 제한하는 것과 같은 이유).
export function resetParticipant(io, id) {
  if (cohort.stage === 'battle') return false;
  const entry = cohort.participants.find((p) => p.id === id);
  if (!entry) return false;
  entry.name = null;
  entry.createDone = false;
  entry.weapon = null;
  // 서버 데이터만 지우고 끝나면 그 기기의 화면은 이전 참가자가 보던 그대로(완료 카드,
  // 만들던 무기 등) 남아있는다 — 이 기기 소켓에 신호를 보내 로컬 화면도 현재 stage의
  // 처음 상태로 되돌리게 한다(admin:reopenCreate의 create:reopen과 같은 패턴).
  io.to(entry.id).emit('participant:reset');
  if (cohort.stage !== 'idle') broadcastProgress(io);
  broadcastParticipants(io);
  return true;
}
