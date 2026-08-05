import { startBattleRoom, stopBattleRoom } from './battle.js';
import { saveParticipantResults } from '../lib/resultStorage.js';

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
    stopBattleRoom();
    cohort.stage = 'idle';
    cohort.slideIndex = 0;
    cohort.participants = [];
    io.emit('stage:change', cohort.stage);
  });

  socket.on('create:done', (weapon) => {
    const existing = cohort.participants.find((p) => p.id === socket.id);
    if (existing) {
      existing.weapon = weapon;
    } else {
      cohort.participants.push({ id: socket.id, weapon });
    }
  });

  // 참가자가 새로고침 등으로 끊기면 새 소켓으로 다시 잡을 때 새 id로 등록되므로,
  // 끊긴 옛 id를 지워두지 않으면 명단에 유령 참가자가 계속 쌓인다.
  socket.on('disconnect', () => {
    cohort.participants = cohort.participants.filter((p) => p.id !== socket.id);
  });
}
