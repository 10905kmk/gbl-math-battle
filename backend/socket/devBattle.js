import {
  stepSimulation,
  hpDamageFromWeaponDamage,
  HP_MAX,
  DEFAULT_MOVE_SPEED,
} from '../lib/battleSimulation.js';
import { activateSkill, newPlayerSkillState } from '../lib/skillEngine.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
import { isValidSkillId } from '../../shapes/skills.js';
import { buildBattleStatePayload } from './battle.js';

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

function emitState(socket, room, { volatile = false } = {}) {
  const emitter = volatile && socket.volatile ? socket.volatile : socket;
  emitter.emit('devBattle:state', buildBattleStatePayload(room));
}

function startDevRoom(socket) {
  stopDevRoom(socket.id);
  const entry = { room: createDevBattleRoom(socket.id), controlledId: socket.id, interval: null };
  entry.interval = setInterval(() => {
    const stepped = stepSimulation(entry.room, Date.now());
    entry.room = stepped.room;
    // 한 시간 제한에 닿더라도 개발자가 창을 열어 둔 동안에는 새 테스트 상태로 계속한다.
    if (entry.room.status === 'ended') entry.room = createDevBattleRoom(socket.id);
    emitState(socket, entry.room, { volatile: true });
    if (stepped.events?.length) socket.emit('devBattle:events', stepped.events);
  }, TICK_MS);
  devRooms.set(socket.id, entry);
  socket.emit('devBattle:controlled', { playerId: entry.controlledId });
  emitState(socket, entry.room);
}

export function getDevBattleRoom(socketId) {
  return devRooms.get(socketId)?.room ?? null;
}

export function getDevControlledPlayerId(socketId) {
  return devRooms.get(socketId)?.controlledId ?? null;
}

function controlledPlayer(socketId) {
  const entry = devRooms.get(socketId);
  if (!entry) return null;
  return entry.room.players[entry.controlledId] ?? null;
}

function clearDevCombatArtifacts(room) {
  room.effects = [];
  room.mines = [];
  room.blackholes = [];
  room.pearls = [];
  room.projectiles = [];
  for (const player of Object.values(room.players)) {
    const fresh = newPlayerSkillState(player.skillId);
    player.status = fresh.status;
    player.skillReadyAt = 0;
    player.skillReadyAts = {};
  }
}

export function registerDevBattleHandlers(socket) {
  socket.on('devBattle:start', () => startDevRoom(socket));
  socket.on('devBattle:requestSync', () => {
    const room = getDevBattleRoom(socket.id);
    if (room) emitState(socket, room);
  });
  socket.on('devBattle:input', (input) => {
    const player = controlledPlayer(socket.id);
    if (!player) return;
    const src = input ?? {};
    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    player.input = {
      moveX: num(src.moveX), moveY: num(src.moveY),
      aimX: num(src.aimX), aimY: num(src.aimY),
    };
  });
  socket.on('devBattle:attack', () => {
    const player = controlledPlayer(socket.id);
    if (player) player.attackRequested = true;
  });
  socket.on('devBattle:skill', () => {
    const entry = devRooms.get(socket.id);
    if (entry) activateSkill(entry.room, entry.controlledId, Date.now());
  });
  socket.on('devBattle:controlPlayer', (playerId) => {
    const entry = devRooms.get(socket.id);
    if (!entry || !entry.room.players[playerId]) return;
    const previous = entry.room.players[entry.controlledId];
    if (previous) previous.input = { moveX: 0, moveY: 0, aimX: previous.aimX ?? 1, aimY: previous.aimY ?? 0 };
    entry.controlledId = playerId;
    socket.emit('devBattle:controlled', { playerId });
    emitState(socket, entry.room);
  });
  socket.on('devBattle:selectSkill', (skillId) => {
    if (!isValidSkillId(skillId)) return;
    const entry = devRooms.get(socket.id);
    const room = entry?.room;
    const player = entry ? room.players[entry.controlledId] : null;
    if (!player) return;
    // 여러 스킬을 빠르게 시험할 때 이전 테스트의 긴 지속효과가 화면에 겹쳐 남지 않게 한다.
    clearDevCombatArtifacts(room);
    room.players[entry.controlledId] = { ...player, ...newPlayerSkillState(skillId) };
    emitState(socket, room);
  });
  socket.on('devBattle:resetCooldown', () => {
    const entry = devRooms.get(socket.id);
    const room = entry?.room;
    const player = entry ? room.players[entry.controlledId] : null;
    if (!player) return;
    clearDevCombatArtifacts(room);
    room.players[entry.controlledId] = { ...player, ...newPlayerSkillState(player.skillId) };
    emitState(socket, room);
  });
  socket.on('devBattle:lowHp', () => {
    const entry = devRooms.get(socket.id);
    const room = entry?.room;
    const player = entry ? room.players[entry.controlledId] : null;
    if (!player) return;
    player.hp = Math.max(1, Math.floor(HP_MAX * 0.15));
    emitState(socket, room);
  });
  socket.on('devBattle:reset', () => startDevRoom(socket));
  socket.on('devBattle:stop', () => stopDevRoom(socket.id));
  socket.on('disconnect', () => stopDevRoom(socket.id));
}
