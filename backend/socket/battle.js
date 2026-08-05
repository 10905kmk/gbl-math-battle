import { stepSimulation, hitDamageFromWeaponDamage, BATTLE_DURATION_MS } from '../lib/battleSimulation.js';
import { DEFAULT_MAP } from '../lib/battleMap.js';

const CHARACTER_IDS = ['char1', 'char2', 'char3', 'char4', 'char5', 'char6'];
// 기본 맵의 벽(중앙/좌상단/우하단)에서 떨어진 5개 스폰 지점
const SPAWN_POINTS = [
  { x: 80, y: 80 },
  { x: 720, y: 80 },
  { x: 80, y: 520 },
  { x: 720, y: 520 },
  { x: 400, y: 520 },
];
const TICK_MS = 50;

let battleRoom = null;
let tickInterval = null;

export function getBattleRoom() {
  return battleRoom;
}

export function stopBattleRoom() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// participants: [{ id, weapon: { damage, ... } }, ...] — session.js의 cohort.participants
export function startBattleRoom(io, participants, { onEnd } = {}) {
  stopBattleRoom();

  const players = {};
  participants.forEach((participant, i) => {
    const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
    players[participant.id] = {
      id: participant.id,
      characterId: CHARACTER_IDS[i % CHARACTER_IDS.length],
      x: spawn.x,
      y: spawn.y,
      facing: 'down',
      hp: 100,
      hitDamage: hitDamageFromWeaponDamage(participant.weapon?.damage ?? 1),
      alive: true,
      lastAttackAt: 0,
      input: { up: false, down: false, left: false, right: false, attack: false },
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
      stopBattleRoom();
      for (const id of Object.keys(battleRoom.players)) {
        io.to(id).emit('battle:result', { win: winners.includes(id) });
      }
      if (onEnd) onEnd(winners);
    }
  }, TICK_MS);
}

export function registerBattleHandlers(io, socket) {
  socket.on('battle:input', (input) => {
    if (!battleRoom || !battleRoom.players[socket.id]) return;
    battleRoom.players[socket.id].input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      attack: !!input.attack,
    };
  });
}
