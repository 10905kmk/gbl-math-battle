// 세션(코호트) 상태 — 5명이 공유하는 stage, slideIndex, 참가자 진행도
const cohort = {
  stage: 'idle',
  slideIndex: 0,
  participants: [], // { id, name, done }
};

export function registerSessionHandlers(io, socket) {
  socket.on('admin:startSession', () => {
    cohort.stage = 'learn';
    cohort.slideIndex = 0;
    io.emit('stage:change', cohort.stage);
  });

  socket.on('admin:nextSlide', () => {
    cohort.slideIndex += 1;
    io.emit('learn:slide', cohort.slideIndex);
  });

  socket.on('admin:prevSlide', () => {
    cohort.slideIndex = Math.max(0, cohort.slideIndex - 1);
    io.emit('learn:slide', cohort.slideIndex);
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
