import { stepSimulation, hitScoreFromWeaponDamage, BATTLE_DURATION_MS } from '../lib/battleSimulation.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';

const CHARACTER_IDS = ['char1', 'char2', 'char3', 'char4', 'char5', 'char6', 'char7', 'char8'];
const TICK_MS = 50;

let battleRoom = null;
let tickInterval = null;

export function getBattleRoom() {
  return battleRoom;
}

// 진행 중인 대전이 있으면 정지시키고 상태를 완전히 비운다 — 멈추기만 하고 battleRoom을 그대로
// 두면, 이미 끊긴 상태인데도 getBattleRoom()이 "진행 중"으로 보이거나 오래된 소켓의
// battle:input이 계속 그 데이터를 건드릴 수 있다.
export function stopBattleRoom() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  battleRoom = null;
}

// participants: [{ id, weapon: { damage, ... } }, ...] — session.js의 cohort.participants
export function startBattleRoom(io, participants, { onEnd } = {}) {
  stopBattleRoom();

  const players = {};
  participants.forEach((participant, i) => {
    const spawn = DEFAULT_MAP.spawnPoints[i % DEFAULT_MAP.spawnPoints.length];
    players[participant.id] = {
      id: participant.id,
      characterId: CHARACTER_IDS[i % CHARACTER_IDS.length],
      x: spawn.x,
      y: spawn.y,
      // 기본 조준 방향(아래쪽) — 기존 facing:'down' 기본값과 같은 의미.
      aimX: 0,
      aimY: 1,
      score: 0,
      hitScore: hitScoreFromWeaponDamage(participant.weapon?.damage),
      weaponParts: participant.weapon?.parts ?? [],
      connected: true,
      lastAttackAt: 0,
      attackRequested: false,
      input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0 },
    };
  });

  battleRoom = {
    status: 'active',
    endsAt: Date.now() + BATTLE_DURATION_MS,
    players,
    walls: DEFAULT_MAP.walls,
  };

  tickInterval = setInterval(() => {
    const { room, winners } = stepSimulation(battleRoom, Date.now());
    battleRoom = room;
    io.emit('battle:state', battleRoom);

    if (winners !== null) {
      // stopBattleRoom()이 battleRoom을 null로 비우기 전에, 결과를 보낼 대상 목록과 최종
      // 점수 스냅샷을 먼저 뽑아둔다 — session.js가 결과 저장에 점수를 함께 쓴다.
      const endedRoom = battleRoom;
      const scores = {};
      for (const id of Object.keys(endedRoom.players)) {
        scores[id] = endedRoom.players[id].score;
      }
      stopBattleRoom();
      for (const id of Object.keys(endedRoom.players)) {
        io.to(id).emit('battle:result', { win: winners.includes(id) });
      }
      if (onEnd) onEnd(winners, scores);
    }
  }, TICK_MS);
}

export function registerBattleHandlers(io, socket) {
  socket.on('battle:input', (input) => {
    if (!battleRoom || !battleRoom.players[socket.id]) return;
    // input이 아예 안 왔거나(undefined/null) 이상한 값/타입이 섞여 있어도 크래시하지 않게 방어.
    const src = input ?? {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    battleRoom.players[socket.id].input = {
      moveX: num(src.moveX),
      moveY: num(src.moveY),
      aimX: num(src.aimX),
      aimY: num(src.aimY),
    };
  });

  // 공격은 더 이상 "누르고 있는 상태"가 아니라 1회성 요청이다 — PC는 마우스 클릭, 모바일은
  // 조준 스틱을 놓는 순간 한 번만 emit된다(조작방식 재설계 스펙 참고). stepSimulation이 다음
  // 틱에서 이 요청을 소비한다.
  socket.on('battle:attack', () => {
    if (!battleRoom || !battleRoom.players[socket.id]) return;
    battleRoom.players[socket.id].attackRequested = true;
  });

  // 대전 중 연결이 끊긴 참가자는 더 이상 조작할 수 없는 상태로 처리 — 이동/공격 대상에서
  // 제외되지만(stepSimulation의 connected 체크), 점수는 그대로 유지되어 최종 판정에 포함된다.
  socket.on('disconnect', () => {
    if (battleRoom && battleRoom.players[socket.id]) {
      battleRoom.players[socket.id] = { ...battleRoom.players[socket.id], connected: false };
    }
  });
}
