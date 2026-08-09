import {
  stepSimulation,
  hpDamageFromWeaponDamage,
  HP_MAX,
  DEFAULT_MOVE_SPEED,
} from '../lib/battleSimulation.js';
import { activateSkill, newPlayerSkillState } from '../lib/skillEngine.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
import { isValidSkillId } from '../../shapes/skills.js';

const TICK_MS = 50;
const DEV_DURATION_MS = 60 * 60_000;
const TARGET_POSITIONS = [
  { x: 1100, y: 808 },
  { x: 1050, y: 760 },
  { x: 1050, y: 856 },
];

// 일반 부스 battleRoom과 완전히 분리된 소켓별 개발자 방.
// 개발자 창을 여러 개 열어도 서로 간섭하지 않고, 창의 소켓이 끊기면 해당 방만 제거된다.
const devRooms = new Map();

function weaponParts() {
  return [
    { id: 'dev-blade', shapeId: 'triangle', x: 0, y: -25, rotation: 0, scaleX: 0.7, scaleY: 1.1 },
    { id: 'dev-handle', shapeId: 'bar', x: 0, y: 15, rotation: 0, scaleX: 0.55, scaleY: 1.2 },
  ];
}

function buildPlayer(id, name, characterId, position, { connected = true } = {}) {
  return {
    id,
    name,
    characterId,
    x: position.x,
    y: position.y,
    aimX: 1,
    aimY: 0,
    hp: HP_MAX,
    alive: true,
    respawnAt: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    recentDamagers: {},
    hpDamage: hpDamageFromWeaponDamage(5000),
    isRanged: false,
    rangeDistance: null,
    weaponParts: weaponParts(),
    connected,
    lastAttackAt: 0,
    attackRequested: false,
    input: { moveX: 0, moveY: 0, aimX: 1, aimY: 0 },
    skillChoices: [],
    ...newPlayerSkillState('heal'),
  };
}

export function createDevBattleRoom(socketId, now = Date.now()) {
  const players = {
    [socketId]: buildPlayer(socketId, '개발자', 'char2', { x: 941, y: 808 }),
  };
  TARGET_POSITIONS.forEach((position, index) => {
    const id = `dev-target-${socketId}-${index + 1}`;
    players[id] = buildPlayer(id, `테스트 표적 ${index + 1}`, `char${index + 3}`, position);
  });
  return {
    status: 'active',
    countdownEndsAt: null,
    endsAt: now + DEV_DURATION_MS,
    durationMs: DEV_DURATION_MS,
    round: 0,
    moveSpeed: DEFAULT_MOVE_SPEED,
    players,
    walls: DEFAULT_MAP.walls,
    arenaSize: DEFAULT_MAP.arenaSize,
    spawnPoints: DEFAULT_MAP.spawnPoints,
    projectiles: [],
    mines: [],
    blackholes: [],
    pearls: [],
    effects: [],
    effectSeq: 1,
    developerMode: true,
  };
}

function stopDevRoom(socketId) {
  const entry = devRooms.get(socketId);
  if (!entry) return;
  clearInterval(entry.interval);
  devRooms.delete(socketId);
}

function emitState(socket, room) {
  socket.emit('devBattle:state', room);
}

function startDevRoom(socket) {
  stopDevRoom(socket.id);
  const entry = { room: createDevBattleRoom(socket.id), interval: null };
  entry.interval = setInterval(() => {
    const stepped = stepSimulation(entry.room, Date.now());
    entry.room = stepped.room;
    // 한 시간 제한에 닿더라도 개발자가 창을 열어 둔 동안에는 새 테스트 상태로 계속한다.
    if (entry.room.status === 'ended') entry.room = createDevBattleRoom(socket.id);
    emitState(socket, entry.room);
    if (stepped.events?.length) socket.emit('devBattle:events', stepped.events);
  }, TICK_MS);
  devRooms.set(socket.id, entry);
  emitState(socket, entry.room);
}

export function getDevBattleRoom(socketId) {
  return devRooms.get(socketId)?.room ?? null;
}

export function registerDevBattleHandlers(socket) {
  socket.on('devBattle:start', () => startDevRoom(socket));
  socket.on('devBattle:requestSync', () => {
    const room = getDevBattleRoom(socket.id);
    if (room) emitState(socket, room);
  });
  socket.on('devBattle:input', (input) => {
    const player = getDevBattleRoom(socket.id)?.players[socket.id];
    if (!player) return;
    const src = input ?? {};
    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    player.input = {
      moveX: num(src.moveX), moveY: num(src.moveY),
      aimX: num(src.aimX), aimY: num(src.aimY),
    };
  });
  socket.on('devBattle:attack', () => {
    const player = getDevBattleRoom(socket.id)?.players[socket.id];
    if (player) player.attackRequested = true;
  });
  socket.on('devBattle:skill', () => {
    const room = getDevBattleRoom(socket.id);
    if (room) activateSkill(room, socket.id, Date.now());
  });
  socket.on('devBattle:selectSkill', (skillId) => {
    if (!isValidSkillId(skillId)) return;
    const room = getDevBattleRoom(socket.id);
    const player = room?.players[socket.id];
    if (!player) return;
    room.players[socket.id] = { ...player, ...newPlayerSkillState(skillId) };
    emitState(socket, room);
  });
  socket.on('devBattle:resetCooldown', () => {
    const room = getDevBattleRoom(socket.id);
    const player = room?.players[socket.id];
    if (!player) return;
    room.players[socket.id] = { ...player, ...newPlayerSkillState(player.skillId) };
    emitState(socket, room);
  });
  socket.on('devBattle:lowHp', () => {
    const room = getDevBattleRoom(socket.id);
    const player = room?.players[socket.id];
    if (!player) return;
    player.hp = Math.max(1, Math.floor(HP_MAX * 0.15));
    emitState(socket, room);
  });
  socket.on('devBattle:reset', () => startDevRoom(socket));
  socket.on('devBattle:stop', () => stopDevRoom(socket.id));
  socket.on('disconnect', () => stopDevRoom(socket.id));
}
