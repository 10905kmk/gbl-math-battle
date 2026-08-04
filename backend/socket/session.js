// 세션(코호트) 상태 — 5명이 공유하는 stage, slideIndex, 참가자 진행도
const cohort = {
  stage: 'idle',
  slideIndex: 0,
  participants: [], // { id, name, done }
};

// 관리자가 수동으로 단계를 앞뒤로 넘길 때의 순서. idle은 startSession/reset으로만 드나든다.
const STAGE_ORDER = ['learn', 'create', 'battle', 'result', 'thanks'];

function goToStage(io, nextStage) {
  cohort.stage = nextStage;
  cohort.slideIndex = 0;
  io.emit('stage:change', cohort.stage);
}

export function registerSessionHandlers(io, socket) {
  // 새로 연결된 소켓(새로고침한 참가자, 나중에 여는 공용화면 등)에게 현재 상태를 바로 알려준다.
  // 이게 없으면 stage:change/learn:slide는 "그 이후 변경분"만 받기 때문에 계속 idle로 보임.
  socket.emit('stage:change', cohort.stage);
  socket.emit('learn:slide', cohort.slideIndex);

  socket.on('admin:startSession', () => {
    goToStage(io, 'learn');
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
    cohort.stage = 'idle';
    cohort.slideIndex = 0;
    cohort.participants = [];
    io.emit('stage:change', cohort.stage);
  });

  socket.on('create:done', () => {
    // TODO: participant별 완료 처리, 전원 완료 시 stage='battle' broadcast (docs/초안.md 7-② 참고)
  });
}
