import { startBattleRoom, stopBattleRoom } from './battle.js';
import { saveParticipantResults } from '../lib/resultStorage.js';

// 세션(코호트) 상태 — 부스 참가자들이 공유하는 stage, slideIndex, 참가자 진행도.
// 목표 인원(expectedParticipants)은 고정값이 아니라 admin:startSession 시점에 그때까지
// participant:join을 보낸 소켓 수로 매번 새로 고정된다(참가 인원 유동화 설계 문서 참고).
const cohort = {
  stage: 'idle',
  slideIndex: 0,
  participants: [], // { id, name, done }
  expectedParticipants: 0,
};

// 현재 접속 중인 "참가자" 소켓 id 집합. 관리자 화면/공용화면도 같은 서버에 소켓으로
// 접속하므로, 접속 자체만으로는 참가자인지 구분할 수 없다 — 참가자 화면(frontend/src/app.js)이
// 접속 시 보내는 participant:join 신호로만 구분한다.
const joined = new Set();

// 관리자가 수동으로 단계를 앞뒤로 넘길 때의 순서. idle은 startSession/reset으로만 드나든다.
const STAGE_ORDER = ['learn', 'create', 'battle', 'result', 'thanks'];

function goToStage(io, nextStage) {
  cohort.stage = nextStage;
  cohort.slideIndex = 0;
  io.emit('stage:change', cohort.stage);
  if (nextStage === 'battle') {
    // 대전 시작 시점의 참가자 목록을 스냅샷으로 떼어둔다 — cohort.participants는 대전 도중
    // 참가자가 연결을 끊으면 disconnect 핸들러가 그 참가자를 걸러낸 "새 배열"로 재할당해버려서,
    // 라운드가 끝난 뒤 결과 저장 시점엔 이미 그 참가자가 사라지고 없다(연결이 끊겼어도 대전
    // 결과 자체는 저장돼야 하므로, 대전 중 필터링과 결과 저장은 서로 다른 참가자 목록을 봐야 함).
    const participantsAtBattleStart = [...cohort.participants];
    startBattleRoom(io, participantsAtBattleStart, {
      // 관리자가 대전 도중 다른 단계로 수동 이동한 뒤에 뒤늦게 라운드가 끝나면(타이머 만료 등)
      // 이 콜백이 그때 가서 엉뚱하게 result로 되돌려버릴 수 있다 — 그 사이 stage가 이미
      // battle이 아니게 됐으면 무시한다. (아래 else 분기가 stopBattleRoom도 호출하므로
      // 정상 경로에서는 이 콜백 자체가 그 뒤로 불릴 일이 없다 — 이건 이중 방어.)
      onEnd: (winners) => {
        saveParticipantResults(participantsAtBattleStart, winners).catch((err) => {
          console.error('[session] 결과 저장 중 예외:', err);
        });
        if (cohort.stage === 'battle') goToStage(io, 'result');
      },
    });
  } else {
    // battle이 아닌 다른 단계로 넘어가면(관리자가 수동으로 건너뛴 경우 포함) 진행 중이던
    // 대전은 더 이상 의미가 없으니 같이 정지 — 안 그러면 admin:reset 없이도 뒷단계까지
    // battle:state가 계속 broadcast되고, 나중에 끝났을 때 엉뚱한 단계에서 result로 끌려간다.
    stopBattleRoom();
  }
}

function doneCount() {
  return cohort.participants.filter((p) => p.done).length;
}

function broadcastProgress(io) {
  io.emit('create:progress', { done: doneCount(), total: cohort.expectedParticipants });
}

export function registerSessionHandlers(io, socket) {
  // 새로 연결된 소켓(새로고침한 참가자, 나중에 여는 공용화면 등)에게 현재 상태를 바로 알려준다.
  // 이게 없으면 stage:change/learn:slide는 "그 이후 변경분"만 받기 때문에 계속 idle로 보임.
  socket.emit('stage:change', cohort.stage);
  socket.emit('learn:slide', cohort.slideIndex);
  socket.emit('create:progress', { done: doneCount(), total: cohort.expectedParticipants });

  // 참가자 화면만 보내는 신호 — 관리자/공용화면은 이 이벤트를 보내지 않으므로 joined에 안 잡힌다.
  socket.on('participant:join', () => {
    joined.add(socket.id);
  });

  socket.on('admin:startSession', () => {
    // 이 시점까지 접속해 있던 참가자 수를 이번 세션의 목표 인원으로 고정한다. 하드코딩된
    // 상수(예전엔 5) 대신, 실제 부스 회차마다 다를 수 있는 인원에 맞춘다.
    cohort.expectedParticipants = joined.size;
    // 이 스냅샷은 관리자가 되돌릴 수 없는 단발성 결정이라(운영 중 눈으로 확인할 방법이 없으면
    // 과소/과다 집계를 그 자리에서 알아챌 수 없다 — Opus 리뷰 Important I1) 서버 로그로
    // 남기고, 이미 접속해 있던 참가자 화면들에도 즉시 정확한 total을 알려준다(Minor M1 —
    // 안 그러면 첫 create:done이 올 때까지 옛 total이 그대로 보인다).
    console.log(`[session] 세션 시작 — 목표 인원 ${cohort.expectedParticipants}명으로 고정`);
    goToStage(io, 'learn');
    broadcastProgress(io);
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

  socket.on('admin:reset', () => {
    stopBattleRoom();
    cohort.stage = 'idle';
    cohort.slideIndex = 0;
    cohort.participants = [];
    cohort.expectedParticipants = 0;
    io.emit('stage:change', cohort.stage);
    broadcastProgress(io);
  });

  socket.on('create:done', (weapon) => {
    const existing = cohort.participants.find((p) => p.id === socket.id);
    if (existing) {
      existing.done = true;
      existing.weapon = weapon;
    } else {
      cohort.participants.push({ id: socket.id, done: true, weapon });
    }
    broadcastProgress(io);
    // 관리자가 이미 create 단계를 벗어난 뒤에(강제로 다음 단계로 넘긴 경우 등) 뒤늦게 도착한
    // create:done은 무시한다 — 안 그러면 느린 참가자가 뒤늦게 "AI 평가받기"를 눌렀을 때 이미
    // battle/result까지 진행된 코호트를 도로 battle로 되돌려버릴 수 있다(Opus 리뷰 Critical #2a).
    if (cohort.stage !== 'create') return;
    // expectedParticipants가 0이면(관리자가 아무도 접속하지 않은 상태에서 세션 시작을 누른
    // 경우) doneCount() >= 0은 첫 완료자만으로 항상 참이 되어 1명짜리 battle room이 열리고
    // 곧바로 종료돼버린다(Opus 리뷰 Critical C1). 목표 인원이 실제로 1명 이상 고정된 경우에만
    // 완료 인원과 비교한다.
    if (cohort.expectedParticipants > 0 && doneCount() >= cohort.expectedParticipants) {
      goToStage(io, 'battle');
    }
  });

  // 참가자가 새로고침 등으로 끊기면 새 소켓으로 다시 잡을 때 새 id로 등록되므로, 끊긴 옛
  // id를 지워두지 않으면 명단에 유령 참가자가 계속 쌓인다 — 한 명이 실수로 여러 번
  // 새로고침하면 실제로는 4명인데 서버는 5명 완료로 잘못 세어서 battle로 조기 전환될 수
  // 있다(Opus 리뷰 Critical #2b, 실제로 재현됨).
  socket.on('disconnect', () => {
    joined.delete(socket.id);
    const before = cohort.participants.length;
    cohort.participants = cohort.participants.filter((p) => p.id !== socket.id);
    if (cohort.participants.length !== before) {
      broadcastProgress(io);
    }
  });
}
