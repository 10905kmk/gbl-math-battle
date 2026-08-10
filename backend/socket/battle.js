import {
  stepSimulation,
  hpDamageFromWeaponDamage,
  computeRanks,
  computeScore,
  buildStandings,
  clampMoveSpeed,
  COUNTDOWN_MS,
  BATTLE_DURATION_MS,
  MELEE_DAMAGE_MULTIPLIER,
  HP_DAMAGE_MAX,
  HP_MAX,
  DEFAULT_MOVE_SPEED,
} from '../lib/battleSimulation.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
import {
  RANGE_DISTANCE_MIN,
  RANGE_DISTANCE_MAX,
  RANGED_COMBAT_RANGE_MULTIPLIER,
} from '../../shapes/attackGeometry.js';
import { drawSkillChoices } from '../../shapes/skills.js';
import { newPlayerSkillState, activateSkill } from '../lib/skillEngine.js';

const CHARACTER_IDS = ['char1', 'char2', 'char3', 'char4', 'char5', 'char6', 'char7', 'char8'];
const TICK_MS = 50;
export const BATTLE_TIME_EXTENSION_MS = 30_000;
export const BATTLE_DURATION_MIN_MS = 30_000;
export const BATTLE_DURATION_MAX_MS = 20 * 60_000;
export const SKILL_CHOICE_COUNT = 9;
export const SKILL_PICK_COUNT = 4;

let battleRoom = null;
let tickInterval = null;
// finishBattleRoomNow()가 자연 종료 경로와 똑같이 battle:result/onEnd를 호출하려면
// startBattleRoom에 전달됐던 io/onEnd를 나중에도 참조할 수 있어야 한다 — battleRoom/
// tickInterval과 같은 이유로 모듈 스코프에 들고 있는다.
let ioRef = null;
let onEndRef = null;
// 라운드가 끝나도 유지돼야 하는 것들 — 관리자가 "새로운 판"을 누르면 같은 참가자/무기로
// 다시 시작해야 하고(제작 단계로 되돌아가지 않는다), 이동 속도 설정도 판마다 초기화되면
// 관리자가 매 판 다시 맞춰야 한다.
let lastParticipants = [];
let moveSpeedSetting = DEFAULT_MOVE_SPEED;
let battleDurationSetting = BATTLE_DURATION_MS;
// 방금 끝난 판의 최종 순위 — 대시보드 화면이 이걸 본다. 새 판을 시작하면 지워진다.
let lastStandings = null;
let roundNumber = 0;
let lastCountdownBroadcastSecond = null;

// 전투 내부 판정에만 필요한 입력/최근 공격자/쿨타임 원본과 정적 맵 충돌 데이터는 매 50ms
// 네트워크 패킷에 실어 보낼 필요가 없다. 클라이언트가 실제로 그리는 공개 상태만 전송해
// 직렬화 비용과 참가자 수만큼 반복되는 송신량을 줄인다.
export function buildBattleStatePayload(room) {
  if (!room) return room;
  const { walls, spawnPoints, ...publicRoom } = room;
  const players = Object.fromEntries(Object.entries(room.players ?? {}).map(([id, player]) => {
    const {
      input,
      recentDamagers,
      attackRequested,
      lastAttackAt,
      hpDamage,
      ...publicPlayer
    } = player;
    return [id, publicPlayer];
  }));
  return { ...publicRoom, players, serverNow: Date.now() };
}

function emitBattleState(target, room, { volatile = false } = {}) {
  const emitter = volatile && target?.volatile ? target.volatile : target;
  emitter?.emit('battle:state', buildBattleStatePayload(room));
}

export function getBattleRoom() {
  return battleRoom;
}

export function getLastStandings() {
  return lastStandings;
}

export function getMoveSpeed() {
  return moveSpeedSetting;
}

export function getBattleDuration() {
  return battleDurationSetting;
}

export function getRoundNumber() {
  return roundNumber;
}

// 이동 속도는 진행 중인 판에도 즉시 반영된다 — 관리자가 "느리다"는 걸 알아채는 시점은
// 보통 판이 이미 시작된 뒤라, 다음 판까지 기다리게 하면 조절 기능의 의미가 없다.
export function setMoveSpeed(value) {
  moveSpeedSetting = clampMoveSpeed(value);
  if (battleRoom) battleRoom.moveSpeed = moveSpeedSetting;
  return moveSpeedSetting;
}

export function setBattleDuration(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return battleDurationSetting;
  const stepped = Math.round(raw / BATTLE_TIME_EXTENSION_MS) * BATTLE_TIME_EXTENSION_MS;
  battleDurationSetting = Math.min(BATTLE_DURATION_MAX_MS, Math.max(BATTLE_DURATION_MIN_MS, stepped));
  if (battleRoom?.status === 'roulette') battleRoom.durationMs = battleDurationSetting;
  return battleDurationSetting;
}

export function addBattleTime(amountMs = BATTLE_TIME_EXTENSION_MS) {
  if (!battleRoom || battleRoom.status !== 'active' || !Number.isFinite(battleRoom.endsAt)) return false;
  const safeAmount = Number(amountMs);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) return false;
  battleRoom = { ...battleRoom, endsAt: battleRoom.endsAt + safeAmount };
  emitBattleState(ioRef, battleRoom);
  return true;
}

// 진행 중인 대전이 있으면 정지시키고 상태를 완전히 비운다 — 멈추기만 하고 battleRoom을 그대로
// 두면, 이미 끊긴 상태인데도 getBattleRoom()이 "진행 중"으로 보이거나 오래된 소켓의
// battle:input이 계속 그 데이터를 건드릴 수 있다. 결과를 저장하지 않는 "그냥 중단"이다 —
// admin:reset처럼 라운드 자체를 폐기하고 싶을 때 쓴다. 결과를 남기면서 끝내려면
// finishBattleRoomNow()를 쓸 것.
export function stopBattleRoom() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  battleRoom = null;
  ioRef = null;
  onEndRef = null;
  lastCountdownBroadcastSecond = null;
}

// 부스 전체를 초기화할 때(admin:reset) 판 기록까지 지운다.
export function resetBattleHistory() {
  stopBattleRoom();
  lastParticipants = [];
  lastStandings = null;
  roundNumber = 0;
}

// 자연 종료(타이머 만료)든, 관리자가 결과를 기다리지 않고 수동으로 battle 단계를 벗어나서
// 조기 종료시키는 경우든 "라운드를 정상적으로 마무리하는" 로직은 여기 하나로 통일한다 —
// stopBattleRoom()만 부르면 tick interval만 죽고 결과 저장/battle:result/onEnd가 전부
// 스킵된다(2026-08-07 Opus 리뷰: 관리자가 대전 중 수동으로 다음 단계를 누르면 참가자
// 전원이 QR도 결과도 못 받고 "결과 집계 중..."에 멈추는 버그).
//
// saveResults=false면 순위 대시보드만 띄우고 Supabase 저장/stage 전환은 하지 않는다 —
// 한 팀이 여러 판을 도는데 매 판마다 결과 행이 쌓이면 QR이 가리키는 결과가 어느 판인지
// 알 수 없게 된다. 저장은 관리자가 "부스 종료"를 누르는 마지막 한 번만.
function concludeRound(winners, { saveResults }) {
  if (!battleRoom) return;
  const endedRoom = battleRoom;
  const scores = {};
  // 킬/데스/어시스트도 점수와 같은 스냅샷 시점에 같이 떼어둔다 — Vercel 상시 결과
  // 페이지/PDF 증서에도 표시하려면 결과 저장(session.js -> resultStorage.js)까지 그대로
  // 실려가야 한다(2026-08-10).
  const kda = {};
  for (const id of Object.keys(endedRoom.players)) {
    const player = endedRoom.players[id];
    scores[id] = computeScore(player);
    kda[id] = { kills: player.kills ?? 0, deaths: player.deaths ?? 0, assists: player.assists ?? 0 };
  }
  const ranks = computeRanks(scores);
  const total = Object.keys(endedRoom.players).length;
  const standings = buildStandings(endedRoom.players);
  const io = ioRef;
  const onEnd = onEndRef;

  lastStandings = { round: roundNumber, standings, endedAt: Date.now() };
  stopBattleRoom();

  if (io) {
    // 순위표 자체는 전원이 같은 내용을 봐야 하므로 전체 브로드캐스트, "내 결과"는 개인별로.
    io.emit('battle:standings', lastStandings);
    for (const id of Object.keys(endedRoom.players)) {
      io.to(id).emit('battle:result', {
        win: winners.includes(id),
        score: scores[id],
        rank: ranks[id],
        total,
        ...kda[id],
      });
    }
  }
  if (saveResults && onEnd) onEnd(winners, scores, kda);
}

// 진행 중인 라운드가 있으면 "지금 시점 점수"로 즉시 정상 종료 처리한다. session.js의
// goToStage가 관리자의 수동 단계 전환으로 battle을 벗어날 때 호출한다(그때는 결과를
// 저장해야 하므로 saveResults=true).
export function finishBattleRoomNow({ saveResults = true } = {}) {
  if (!battleRoom) return;
  if (battleRoom.status !== 'active') {
    // 룰렛(스킬 선택)/카운트다운 중에는 아직 아무도 싸우지 않아 전원 킬/데스/어시스트가
    // 0이다 — 이 시점에 관리자가 battle을 벗어나면 그 "0-0-0 무승부"를 결과로 저장하면
    // 안 된다(Opus 리뷰 Critical #1, 2026-08-10). 실제 대전이 시작도 안 했으므로 그냥
    // 폐기한다 — admin:reset과 같은 "결과 저장 없는 순수 중단".
    stopBattleRoom();
    return;
  }
  const allPlayers = Object.values(battleRoom.players);
  const maxScore = Math.max(...allPlayers.map((p) => computeScore(p)));
  const winners = allPlayers.filter((p) => computeScore(p) === maxScore).map((p) => p.id);
  concludeRound(winners, { saveResults });
}

// 라운드가 끝나 순위 대시보드가 떠 있는 상태에서 관리자가 "부스 종료"를 누르면, 마지막
// 판의 점수로 결과를 저장하고 결과(QR/PDF) 단계로 넘어가야 한다. 이때는 이미 battleRoom이
// 없으므로 concludeRound를 다시 탈 수 없다 — 저장해둔 순위표로 onEnd만 호출한다.
export function saveLastRoundResults(onEnd) {
  if (!lastStandings || !onEnd) return false;
  const scores = Object.fromEntries(lastStandings.standings.map((p) => [p.id, p.score]));
  const kda = Object.fromEntries(
    lastStandings.standings.map((p) => [p.id, { kills: p.kills, deaths: p.deaths, assists: p.assists }]),
  );
  const maxScore = Math.max(...lastStandings.standings.map((p) => p.score));
  const winners = lastStandings.standings.filter((p) => p.score === maxScore).map((p) => p.id);
  onEnd(winners, scores, kda);
  return true;
}

function buildPlayer(participant, index) {
  const spawn = DEFAULT_MAP.spawnPoints[index % DEFAULT_MAP.spawnPoints.length];
  // AI(또는 실패 시 폴백)가 판단한 근접/원거리 — 서버가 신뢰하지 않고 항상 재검증한다
  // (기존 weaponDamage clamp와 같은 원칙). 'ranged'가 아니면 전부 근접으로 취급.
  const isRanged = participant.weapon?.attackRange === 'ranged';
  const rawDistance = Number(participant.weapon?.attackRangeDistance);
  const evaluatedRangeDistance = Math.min(
    RANGE_DISTANCE_MAX,
    Math.max(RANGE_DISTANCE_MIN, Number.isFinite(rawDistance) ? rawDistance : RANGE_DISTANCE_MIN),
  );
  const rangeDistance = isRanged
    ? evaluatedRangeDistance * RANGED_COMBAT_RANGE_MULTIPLIER
    : null;
  const baseDamage = hpDamageFromWeaponDamage(participant.weapon?.damage);
  // 근접은 가까이 가야 하는 위험을 감수하므로 원거리보다 세다 — 다만 보정을 곱한 뒤에도
  // 한 방 상한(HP_DAMAGE_MAX)은 반드시 지킨다. 이 clamp가 "최소 5대"를 보장한다.
  const hpDamage = Math.min(HP_DAMAGE_MAX, isRanged ? baseDamage : Math.round(baseDamage * MELEE_DAMAGE_MULTIPLIER * 10) / 10);

  return {
    id: participant.id,
    name: participant.name ?? null,
    characterId: CHARACTER_IDS[index % CHARACTER_IDS.length],
    x: spawn.x,
    y: spawn.y,
    // 기본 조준 방향(아래쪽) — 기존 facing:'down' 기본값과 같은 의미.
    aimX: 0,
    aimY: 1,
    hp: HP_MAX,
    alive: true,
    respawnAt: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    // { [attackerId]: timestamp } — 죽는 순간 어시스트를 나눠주기 위한 최근 피격 기록.
    recentDamagers: {},
    hpDamage,
    isRanged,
    rangeDistance,
    weaponParts: participant.weapon?.parts ?? [],
    connected: true,
    lastAttackAt: 0,
    attackRequested: false,
    input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0 },
    // 서버가 추첨한 9개 후보 중 참가자가 4개를 고른다.
    skillChoices: drawSkillChoices(SKILL_CHOICE_COUNT),
    skillIds: [],
    skillSelectionConfirmed: false,
    skillReadyAts: {},
    ...newPlayerSkillState(null),
  };
}

// participants: [{ id, weapon: { damage, ... } }, ...] — session.js의 cohort.participants
export function startBattleRoom(io, participants, { onEnd } = {}) {
  stopBattleRoom();
  ioRef = io;
  onEndRef = onEnd ?? null;
  lastParticipants = participants;
  lastStandings = null;
  roundNumber += 1;

  const players = {};
  participants.forEach((participant, i) => {
    players[participant.id] = buildPlayer(participant, i);
  });

  const now = Date.now();
  battleRoom = {
    // 매 판은 "룰렛(스킬 9개 중 4개 선택) → 관리자 시작 승인 → 5초 카운트다운 →
    // 본 게임" 순서다. 룰렛에는 자동 종료 시각을 두지 않는다.
    status: 'roulette',
    rouletteEndsAt: null,
    countdownEndsAt: null,
    endsAt: null,
    round: roundNumber,
    moveSpeed: moveSpeedSetting,
    durationMs: battleDurationSetting,
    players,
    walls: DEFAULT_MAP.walls,
    arenaSize: DEFAULT_MAP.arenaSize,
    spawnPoints: DEFAULT_MAP.spawnPoints,
    projectiles: [],
    // 특수 스킬이 만들어내는 월드 오브젝트 / 시각 효과. 클라이언트는 이걸 그대로 그린다.
    mines: [],
    blackholes: [],
    pearls: [],
    effects: [],
    effectSeq: 1,
  };

  io.emit('battle:standings', null); // 이전 판의 대시보드를 내린다
  tickInterval = setInterval(() => {
    const previousStatus = battleRoom.status;
    const { room, winners, events } = stepSimulation(battleRoom, Date.now());
    battleRoom = room;
    // roulette은 선택/확정 이벤트 때 이미 즉시 전송하므로 변화 없는 방 전체를 20Hz로
    // 반복할 필요가 없다. countdown도 화면에 보이는 초가 바뀔 때만 보내고, active에서만
    // 위치 스냅샷을 20Hz 전송한다. 화면 움직임은 클라이언트가 50~60FPS로 보간한다.
    const countdownSecond = battleRoom.status === 'countdown'
      ? Math.max(0, Math.ceil((battleRoom.countdownEndsAt - Date.now()) / 1000))
      : null;
    const shouldEmit = battleRoom.status === 'active'
      || battleRoom.status !== previousStatus
      || (battleRoom.status === 'countdown' && countdownSecond !== lastCountdownBroadcastSecond);
    if (shouldEmit) {
      // 상태는 곧 다음 스냅샷으로 완전히 대체된다. 느린 네트워크에 옛 프레임을 쌓지 않는다.
      emitBattleState(io, battleRoom, { volatile: battleRoom.status === 'active' });
    }
    lastCountdownBroadcastSecond = countdownSecond;
    if (events && events.length > 0) io.emit('battle:events', events);

    if (winners !== null) {
      // 자연 종료(기본 3분 만료)는 대시보드만 띄우고 저장하지 않는다 — 관리자가 "새로운 판"으로
      // 계속 돌릴 수 있고, 저장은 "부스 종료" 한 번만.
      concludeRound(winners, { saveResults: false });
    }
  }, TICK_MS);
}

// 관리자가 누르는 최종 시작 게이트. 선택을 끝내지 않은 참가자는 이미 고른 스킬을 유지하고
// 남은 칸을 자신의 9개 후보에서 자동 배정한다. 부스 진행이 한 기기 때문에 막히지 않게 한다.
export function startBattleCountdown(now = Date.now()) {
  if (!battleRoom || battleRoom.status !== 'roulette') return false;

  const connectedPlayers = Object.values(battleRoom.players).filter((p) => p.connected !== false);
  if (connectedPlayers.length === 0) return false;

  for (const player of connectedPlayers) {
    const choices = Array.isArray(player.skillChoices) ? player.skillChoices : [];
    const selected = [...new Set(Array.isArray(player.skillIds) ? player.skillIds : [])]
      .filter((skillId) => choices.includes(skillId))
      .slice(0, SKILL_PICK_COUNT);
    const autoAssigned = choices.filter((skillId) => !selected.includes(skillId));
    player.skillIds = [...selected, ...autoAssigned].slice(0, SKILL_PICK_COUNT);
    if (player.skillIds.length !== SKILL_PICK_COUNT) return false;
    player.skillSelectionConfirmed = true;
  }

  battleRoom = {
    ...battleRoom,
    status: 'countdown',
    countdownEndsAt: now + COUNTDOWN_MS,
    // 실제 active 진입 때 stepSimulation이 다시 정확히 잡는다. 이 값은 카운트다운 첫
    // 프레임부터 클라이언트가 전체 진행 시간을 예측할 수 있게 하는 초기값이다.
    endsAt: now + COUNTDOWN_MS + battleRoom.durationMs,
  };
  lastCountdownBroadcastSecond = Math.ceil(COUNTDOWN_MS / 1000);
  emitBattleState(ioRef, battleRoom);
  return true;
}

// 관리자가 순위 대시보드에서 "새로운 판"을 눌렀을 때 — 직전 판과 같은 참가자/무기로
// 새 라운드를 시작한다. 대전 도중 나간 참가자는 세션이 알아서 걸러준 목록으로 다시 받는다.
export function startNextRound(io, participants, { onEnd } = {}) {
  const roster = participants && participants.length > 0 ? participants : lastParticipants;
  if (!roster || roster.length === 0) return false;
  startBattleRoom(io, roster, { onEnd });
  return true;
}

export function registerBattleHandlers(io, socket) {
  // 새로 접속한 화면(참가자 재접속, 나중에 여는 공용화면/관리자)에게 현재 대시보드 상태를
  // 바로 알려준다 — 없으면 순위표가 안 보인 채로 남는다.
  socket.emit('battle:standings', lastStandings);
  socket.emit('battle:moveSpeed', moveSpeedSetting);
  socket.emit('battle:duration', battleDurationSetting);

  // 화면이 늦게 마운트되거나(참가자가 battle 단계에 들어온 순간) 대시보드 도중 새로고침해도
  // 현재 상태를 받을 수 있어야 한다 — 연결 시점 emit만으로는 그 이후에 붙는 리스너가
  // 놓친다(순위표가 안 보인 채 빈 아레나만 남는 사고).
  socket.on('battle:requestSync', () => {
    socket.emit('battle:standings', lastStandings);
    socket.emit('battle:moveSpeed', moveSpeedSetting);
    socket.emit('battle:duration', battleDurationSetting);
    if (battleRoom) emitBattleState(socket, battleRoom);
  });

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

  // 룰렛에서 4개를 토글 선택한다. 자기에게 뽑힌 9개 안에 있고 최대 4개여야 한다(클라이언트가
  // 보낸 값을 그대로 믿지 않는 이 프로젝트의 기존 원칙).
  socket.on('battle:pickSkill', (skillId) => {
    const player = battleRoom?.players[socket.id];
    if (!player || battleRoom.status !== 'roulette') return;
    if (!player.skillChoices?.includes(skillId)) return;
    const selected = player.skillIds ?? [];
    player.skillIds = selected.includes(skillId)
      ? selected.filter((id) => id !== skillId)
      : selected.length < SKILL_PICK_COUNT ? [...selected, skillId] : selected;
    player.skillSelectionConfirmed = false;
    emitBattleState(io, battleRoom);
  });

  socket.on('battle:confirmSkills', () => {
    const player = battleRoom?.players[socket.id];
    if (!player || battleRoom.status !== 'roulette') return;
    if (player.skillIds?.length !== SKILL_PICK_COUNT) return;
    player.skillSelectionConfirmed = true;
    emitBattleState(io, battleRoom);
  });

  // 룰렛은 참가자 한 명의 선택이나 시간 경과로 끝나지 않는다. 전원이 선택한 상태에서
  // 관리자 화면의 "5초 카운트다운 시작" 버튼을 눌러야만 다음 단계로 간다.
  socket.on('admin:startBattleCountdown', () => {
    startBattleCountdown();
  });

  // 특수 스킬 발동 — PC Z/X/C/V와 모바일 4개 버튼이 선택한 스킬 id를 보낸다.
  socket.on('battle:skill', (skillId) => {
    if (!battleRoom || battleRoom.status !== 'active') return;
    if (typeof skillId !== 'string') return;
    activateSkill(battleRoom, socket.id, Date.now(), Math.random, skillId);
  });

  socket.on('admin:setMoveSpeed', (value) => {
    const applied = setMoveSpeed(value);
    io.emit('battle:moveSpeed', applied);
  });

  socket.on('admin:setBattleDuration', (value) => {
    if (battleRoom && battleRoom.status !== 'roulette') return;
    const applied = setBattleDuration(value);
    io.emit('battle:duration', applied);
    if (battleRoom) emitBattleState(io, battleRoom);
  });

  socket.on('admin:addBattleTime', () => {
    addBattleTime();
  });

  // 대전 중 연결이 끊긴 참가자는 더 이상 조작할 수 없는 상태로 처리 — 이동/공격 대상에서
  // 제외되지만, 기록(킬/데스/어시스트)은 그대로 유지되어 최종 순위에 포함된다.
  socket.on('disconnect', () => {
    if (battleRoom && battleRoom.players[socket.id]) {
      battleRoom.players[socket.id] = { ...battleRoom.players[socket.id], connected: false };
    }
  });
}
