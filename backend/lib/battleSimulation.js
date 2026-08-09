import { meleeHitboxRect, circleOverlapsRotatedRect, PROJECTILE_SPEED, PROJECTILE_RADIUS, RANGE_DISTANCE_MIN } from '../../shapes/attackGeometry.js';
import { MAX_HP } from '../../shapes/combatRules.js';
import { circleOverlapsAnyWall, resolveCircleFromWalls } from '../../shapes/collision.js';
import {
  speedMultiplier,
  isInvulnerable,
  isCloaked,
  outgoingDamageMultiplier,
  incomingDamageMultiplier,
  tickSkillWorld,
  onWeaponHit,
  setKillHandler,
  resetSkillsOnRespawn,
  pushEffect,
} from './skillEngine.js';

export const CHARACTER_RADIUS = 20;

// 이동 속도 — 틱(50ms)당 픽셀. 예전 4는 초당 80px이라 2176x1632 맵을 가로지르는 데 27초가
// 걸려서 "느리다"는 피드백이 나왔다. 기본을 8(초당 160px, 맵 횡단 13.6초)로 올리고,
// 부스 현장에서 관리자가 바로 조절할 수 있게 범위를 열어둔다.
export const DEFAULT_MOVE_SPEED = 8;
export const MOVE_SPEED_MIN = 3;
export const MOVE_SPEED_MAX = 20;

export const RANGED_ATTACK_COOLDOWN_MS = 500;
export const MELEE_ATTACK_COOLDOWN_MS = 350;
// 기존 import와의 호환: 공통 쿨타임 상수는 원거리 기본값을 뜻한다.
export const ATTACK_COOLDOWN_MS = RANGED_ATTACK_COOLDOWN_MS;
// 한 판 기본 3분. 시작 전 5초 카운트다운은 이 시간에 포함되지 않는다(카운트다운이 끝나는 순간
// endsAt을 다시 잡는다).
export const BATTLE_DURATION_MS = 180000;
export const COUNTDOWN_MS = 5000;
export const RESPAWN_MS = 10000;
export const SPAWN_INVULNERABILITY_MS = 5000;

// ── 체력 ───────────────────────────────────────────────────────────────
// 목숨은 무한이고 죽으면 10초 뒤 부활한다 — 그래서 체력은 "탈락 여부"가 아니라 "얼마나
// 자주 죽느냐"를 정하는 값이다.
export const HP_MAX = MAX_HP;
// 무기 데미지(1~10000)를 한 대당 HP로 환산하는 구간. 상한이 24라 아무리 센 무기라도
// 최소 4대는 맞아야 죽는다(24×3=72) — "바로 죽는 건 안 된다"는 요구를 이 상한 하나로
// 보장한다. 근접 보정(×1.3)을 곱한 뒤에도 같은 상한으로 다시 clamp한다.
export const HP_DAMAGE_MIN = 3;
export const HP_DAMAGE_MAX = 24;
export const MELEE_DAMAGE_MULTIPLIER = 1.3;

// ── 점수 ───────────────────────────────────────────────────────────────
export const SCORE_PER_KILL = 20;
export const SCORE_PER_DEATH = -10;
export const SCORE_PER_ASSIST = 5;
// 죽기 직전 이 시간 안에 피해를 준 사람은(막타를 친 사람 제외) 어시스트를 받는다.
export const ASSIST_WINDOW_MS = 8000;

// 조준 벡터가 이 길이보다 짧으면 "조준 입력 없음"으로 보고 이전 조준을 유지한다 — 모바일
// 조준 스틱이 중앙 근처에 있거나 마우스가 캐릭터 위에 있을 때, 히트박스가 캐릭터 자기
// 자신 위치로 무너지는 것을 방지한다.
const AIM_DEADZONE = 0.01;
// aiClient.js의 DAMAGE_MAX와 같은 상한 — weapon.damage는 소켓으로 들어오는 클라이언트 제공
// 값이라 서버 검증을 거치지 않는다. 상한 없이 곱하면 비정상적으로 큰 값(치트/버그)이 그대로
// 반영된다(Opus 리뷰 Critical C1).
const WEAPON_DAMAGE_MAX = 10000;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// HP는 소수 첫째 자리까지만 — 매 틱 전체 room을 브로드캐스트하므로 부동소수점 꼬리가
// 붙으면 payload만 커지고 화면에 보이는 값은 똑같다.
function round1(v) {
  return Math.round(v * 10) / 10;
}

// weaponDamage는 숫자가 아니거나 0 이하일 수도 있다 — 검증 없이 쓰면 NaN 체력으로 이어져
// 그 참가자가 영원히 안 죽거나 즉사한다. 숫자가 아니거나 0 이하면 최소치로 취급한다.
export function hpDamageFromWeaponDamage(weaponDamage) {
  const value = Number(weaponDamage);
  const safeValue = Number.isFinite(value) && value > 0 ? Math.min(value, WEAPON_DAMAGE_MAX) : 1;
  const ratio = safeValue / WEAPON_DAMAGE_MAX;
  return round1(clamp(HP_DAMAGE_MIN + ratio * (HP_DAMAGE_MAX - HP_DAMAGE_MIN), HP_DAMAGE_MIN, HP_DAMAGE_MAX));
}

export function clampMoveSpeed(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_MOVE_SPEED;
  return clamp(num, MOVE_SPEED_MIN, MOVE_SPEED_MAX);
}

// 킬 20점, 데스 -10점, 어시스트 5점. 음수도 그대로 둔다 — 0에서 막으면 "많이 죽어도
// 손해가 없다"가 되어 死 페널티가 사라진다.
export function computeScore(player) {
  return (
    (player.kills ?? 0) * SCORE_PER_KILL +
    (player.deaths ?? 0) * SCORE_PER_DEATH +
    (player.assists ?? 0) * SCORE_PER_ASSIST
  );
}

// scores: { [id]: number } -> { [id]: rank } — 표준 대회 순위(동점자는 같은 등수를 공유하고,
// 그다음 등수는 동점자 수만큼 건너뛴다. 예: 90,90,80 -> 1,1,3). 대전 종료 브로드캐스트
// (backend/socket/battle.js)와 결과 저장(backend/lib/resultStorage.js) 양쪽이 같은 scores
// 데이터로 이 함수를 각자 호출한다 — 등수 계산식이 한 곳에만 있어야 두 값이 어긋나지 않는다.
export function computeRanks(scores) {
  const entries = Object.entries(scores);
  const ranks = {};
  entries.forEach(([id, score]) => {
    const higherCount = entries.filter(([, s]) => s > score).length;
    ranks[id] = higherCount + 1;
  });
  return ranks;
}

// 최종 순위 대시보드용 — 1등부터 꼴등까지 킬/데스/어시스트/종합 점수를 한 배열로.
export function buildStandings(players) {
  const list = Object.values(players).map((p) => ({
    id: p.id,
    name: p.name ?? null,
    characterId: p.characterId,
    kills: p.kills ?? 0,
    deaths: p.deaths ?? 0,
    assists: p.assists ?? 0,
    score: computeScore(p),
  }));
  const scores = Object.fromEntries(list.map((p) => [p.id, p.score]));
  const ranks = computeRanks(scores);
  return list
    .map((p) => ({ ...p, rank: ranks[p.id] }))
    // 같은 점수면 킬이 많은 쪽을 위에 보여준다 — 등수(rank)는 동점 그대로 공유하되,
    // 표에서 줄 순서까지 무작위로 흔들리면 참가자가 화면을 못 믿는다.
    .sort((a, b) => a.rank - b.rank || b.kills - a.kills || (a.name ?? '').localeCompare(b.name ?? ''));
}

// 벡터 길이가 1을 넘으면 방향은 유지한 채 길이만 1로 줄인다 — 클라이언트가 정규화 안 된
// 값(버그 또는 조작된 입력)을 보내도 서버가 항상 재검증한다(weaponDamage clamp와 같은 원칙).
// NaN/Infinity가 섞여 있으면(소켓 레이어에서 이미 걸러지지만, 방어적 이중화 원칙에 따라
// 여기서도 한 번 더) 이동 없음(0,0)으로 취급 — 위치가 NaN으로 영구 오염되는 것을 막는다.
function normalizeIfLong(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  if (len <= 1) return { x, y };
  return { x: x / len, y: y / len };
}

// 이동 벡터(moveX/moveY, -1~1)로 이동한다 — 대각선 입력이 자동으로 가능해지고(둘 다 0이
// 아닐 수 있으므로), 벽/경계 충돌 판정은 기존과 동일하다.
function moveOne(player, walls, arenaSize, moveSpeed, now) {
  const input = player.input ?? {};
  const move = normalizeIfLong(input.moveX ?? 0, input.moveY ?? 0);
  // 속도증가/속도지옥/시간정지(0배)/최후의 발악이 여기 한 번에 반영된다.
  const effective = moveSpeed * speedMultiplier(player, now);
  const dx = move.x * effective;
  const dy = move.y * effective;

  const safeStart = resolveCircleFromWalls(player.x, player.y, CHARACTER_RADIUS, walls, arenaSize);
  let x = clamp(safeStart.x + dx, CHARACTER_RADIUS, arenaSize.width - CHARACTER_RADIUS);
  let y = clamp(safeStart.y + dy, CHARACTER_RADIUS, arenaSize.height - CHARACTER_RADIUS);

  if (circleOverlapsAnyWall(x, safeStart.y, CHARACTER_RADIUS, walls)) x = safeStart.x;
  if (circleOverlapsAnyWall(x, y, CHARACTER_RADIUS, walls)) y = safeStart.y;

  return { ...player, x, y };
}

// 조준(aimX/aimY)은 이동과 분리된 별개 입력이라 여기서 따로 갱신한다. 입력 벡터가
// 데드존보다 짧으면(스틱이 중앙 근처, 마우스가 캐릭터 위인 등) 이전 조준을 그대로
// 유지하고, 그렇지 않으면 정규화(단위벡터화)해서 저장한다.
// len이 Infinity로 오버플로하는 경우(예: Number.MAX_VALUE급 입력값)도 데드존 미달과 같이
// 취급해 이전 조준을 유지한다 — 안 그러면 x/len, y/len이 둘 다 0이 되어 "조준 없음"이
// 영구 저장되고, 그 상태의 히트박스는 캐릭터 중심에 고정돼 전방위로 맞아버린다(Opus 리뷰
// Important I3).
function applyAim(player) {
  const input = player.input ?? {};
  const x = input.aimX ?? 0;
  const y = input.aimY ?? 0;
  const len = Math.hypot(x, y);
  if (!Number.isFinite(len) || len < AIM_DEADZONE) return player;
  return { ...player, aimX: x / len, aimY: y / len };
}

// 부활 지점은 "살아 있는 다른 플레이어에게서 가장 먼 스폰"을 고른다 — 고정 순번으로 돌리면
// 부활하자마자 같은 사람에게 다시 맞는 스폰 캠핑이 그대로 성립한다. 후보가 10개뿐이고
// 참가자도 최대 8명이라 매번 전수 계산해도 비용이 없다.
function pickRespawnPoint(spawnPoints, players, selfId) {
  const others = Object.values(players).filter((p) => p.id !== selfId && p.alive && p.connected);
  if (others.length === 0) return spawnPoints[0];
  let best = spawnPoints[0];
  let bestDist = -Infinity;
  for (const spawn of spawnPoints) {
    const nearest = Math.min(...others.map((p) => Math.hypot(p.x - spawn.x, p.y - spawn.y)));
    if (nearest > bestDist) {
      bestDist = nearest;
      best = spawn;
    }
  }
  return best;
}

// 투사체 하나를 한 틱만큼 이동시킨 다음 상태를 반환한다 — 순수 함수, room 자체를 안 건드림.
function moveProjectile(proj) {
  return {
    ...proj,
    x: proj.x + proj.aimX * PROJECTILE_SPEED,
    y: proj.y + proj.aimY * PROJECTILE_SPEED,
    traveled: proj.traveled + PROJECTILE_SPEED,
  };
}

// 피격 처리 — 체력을 깎고, 0이 되면 킬/데스/어시스트를 정산한다. players는 이번 틱의
// 작업용 사본이라 여기서 직접 갈아끼운다.
function applyHit(players, attackerId, targetId, damage, now, events, room) {
  const target = players[targetId];
  const attacker = players[attackerId];
  if (!target || !attacker || !target.alive) return;
  // 실드/투명망토/대쉬 무적 — 맞아도 아무 일이 일어나지 않는다(어시스트 기록도 안 남김).
  if (isInvulnerable(target, now)) return;

  // 최후의 발악/사형선고 표식/운빨을 곱한 최종 피해.
  const { multiplier, lucky } = outgoingDamageMultiplier(attacker, target, now);
  const finalDamage = round1(damage * multiplier * incomingDamageMultiplier(target, now));
  if (lucky) events.push({ type: 'lucky', playerId: attackerId, x: attacker.x, y: attacker.y });

  // 독이 장전돼 있으면 이 명중으로 대상에게 붙는다.
  if (room) onWeaponHit(room, attacker, target, now);

  // 반사 — 대상이 반사 중이면 공격자가 절반을 되돌려받는다(대상은 원래대로 다 맞는다).
  const reflectUntil = target.status?.reflectUntil ?? 0;
  if (reflectUntil > now && !isInvulnerable(attacker, now)) {
    const back = round1(finalDamage * 0.5);
    players[attackerId] = { ...attacker, hp: round1(Math.max(0, attacker.hp - back)) };
    events.push({ type: 'reflect', targetId: attackerId, attackerId: targetId, damage: back, x: attacker.x, y: attacker.y });
  }

  const hp = round1(Math.max(0, target.hp - finalDamage));
  // "누가 최근에 나를 때렸는지" — 죽는 순간 어시스트를 나눠주기 위한 기록.
  const recentDamagers = { ...(target.recentDamagers ?? {}), [attackerId]: now };
  events.push({ type: 'hit', targetId, attackerId, damage: finalDamage, x: target.x, y: target.y });

  if (hp > 0) {
    players[targetId] = { ...target, hp, recentDamagers };
    return;
  }

  recordDeath(players, attackerId, targetId, recentDamagers, now, events);
}

// 죽음 정산(킬/데스/어시스트) — 무기 피해로 죽든 스킬 피해로 죽든 규칙이 같아야 하므로
// 한 함수로 모으고, skillEngine에도 이 함수를 콜백으로 등록한다(순환 import 회피).
function recordDeath(players, attackerId, targetId, recentDamagers, now, events) {
  const target = players[targetId];
  const assisters = Object.keys(recentDamagers ?? {}).filter(
    (id) => id !== attackerId && id !== targetId && players[id] && now - recentDamagers[id] <= ASSIST_WINDOW_MS,
  );

  players[targetId] = {
    ...target,
    hp: 0,
    alive: false,
    respawnAt: now + RESPAWN_MS,
    deaths: (target.deaths ?? 0) + 1,
    recentDamagers: {},
    // 죽으면 입력을 비운다 — 안 그러면 부활하는 순간 죽기 직전에 누르고 있던 방향으로
    // 저절로 미끄러진다.
    input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0 },
    attackRequested: false,
  };
  if (players[attackerId] && attackerId !== targetId) {
    players[attackerId] = { ...players[attackerId], kills: (players[attackerId].kills ?? 0) + 1 };
  }
  assisters.forEach((id) => {
    players[id] = { ...players[id], assists: (players[id].assists ?? 0) + 1 };
  });
  events.push({ type: 'kill', targetId, attackerId, assistIds: assisters, x: target.x, y: target.y });
}

// skillEngine은 players 객체를 직접 수정하는 방식이라(스킬 효과가 여러 대상을 동시에
// 건드림) 죽음 정산도 같은 방식으로 맞춰준다.
setKillHandler((room, attackerId, target, now, events) => {
  const players = room.players;
  const recent = target.recentDamagers ?? {};
  recordDeath(players, attackerId, target.id, recent, now, events);
  // recordDeath는 새 객체로 갈아끼우므로, 호출자가 들고 있던 target 참조도 맞춰준다.
  Object.assign(target, players[target.id]);
});

export function stepSimulation(room, now) {
  // 룰렛(스킬 선택) → 관리자가 시작 승인 → 카운트다운 → 본 게임. 준비 단계에서는
  // 아무도 움직이거나 공격할 수 없다. 예전에는 9초가 지나면 자동으로 룰렛을 닫았는데,
  // 한 참가자가 늦게 고르는 동안 다른 참가자 화면이 먼저 게임으로 넘어가는 문제가 있었다.
  // 룰렛 종료는 socket/battle.js의 admin:startBattleCountdown만 담당한다.
  if (room.status === 'roulette') {
    return { room, winners: null, events: [] };
  }
  if (room.status === 'countdown') {
    if (now < room.countdownEndsAt) return { room, winners: null, events: [] };
    const durationMs = Number.isFinite(room.durationMs) && room.durationMs > 0
      ? room.durationMs
      : BATTLE_DURATION_MS;
    return {
      room: { ...room, status: 'active', endsAt: now + durationMs },
      winners: null,
      events: [{ type: 'roundStart' }],
    };
  }
  if (room.status !== 'active') return { room, winners: null, events: [] };

  const events = [];
  const moveSpeed = clampMoveSpeed(room.moveSpeed);

  const players = {};
  for (const id of Object.keys(room.players)) {
    const p = room.players[id];
    if (!p.alive) {
      // 부활 대기 — 시간이 되면 가장 안전한 스폰에서 만피로 되살아난다.
      if (now >= p.respawnAt) {
        const spawn = pickRespawnPoint(room.spawnPoints, room.players, id);
        // 부활하면 걸려 있던 버프/디버프를 전부 지우고 특수 스킬도 바로 쓸 수 있게 한다(요구사항).
        const respawned = resetSkillsOnRespawn({
          ...p, alive: true, hp: HP_MAX, x: spawn.x, y: spawn.y, respawnAt: 0, recentDamagers: {},
        });
        respawned.status.invulnUntil = now + SPAWN_INVULNERABILITY_MS;
        players[id] = respawned;
        pushEffect(room, {
          type: 'shield', playerId: id,
          endsAt: respawned.status.invulnUntil, color: '#7cc4ff',
        });
        events.push({ type: 'respawn', playerId: id, x: spawn.x, y: spawn.y });
      } else {
        players[id] = { ...p };
      }
      continue;
    }
    players[id] = p.connected ? applyAim(moveOne(p, room.walls, room.arenaSize, moveSpeed, now)) : { ...p };
  }

  // 지뢰/블랙홀/순간이동 진주/독 도트/최후의 발악은 플레이어 위치가 이번 틱 값으로 갱신된
  // 뒤에 판정해야 한다 — 그래야 화면에 보이는 위치와 판정이 어긋나지 않는다. tickSkillWorld는
  // players를 직접 수정하므로(성능/단순성) 여기서 임시 room을 만들어 넘긴다.
  const skillRoom = { ...room, players };
  tickSkillWorld(skillRoom, now, events);
  room = skillRoom;

  // 기존 투사체를 먼저 이동/판정한다 — 이번 틱에 새로 발사되는 투사체는 여기 안 끼고
  // 다음 틱부터 이동을 시작한다(플레이어 이동과 같은 "한 틱에 한 번만 갱신" 원칙).
  const projectiles = [];
  for (const proj of room.projectiles ?? []) {
    const next = moveProjectile(proj);
    if (next.traveled >= next.maxRange) continue; // 사거리 소진 — 소멸, 효과 없음
    if (circleOverlapsAnyWall(next.x, next.y, PROJECTILE_RADIUS, room.walls)) continue; // 벽 충돌 — 소멸

    let hit = false;
    for (const targetId of Object.keys(players)) {
      if (targetId === next.ownerId) continue;
      const target = players[targetId];
      if (!target.connected || !target.alive) continue;
      const dx = target.x - next.x;
      const dy = target.y - next.y;
      const hitRadius = PROJECTILE_RADIUS + CHARACTER_RADIUS;
      if (dx * dx + dy * dy < hitRadius * hitRadius) {
        applyHit(players, next.ownerId, targetId, next.hpDamage, now, events, room);
        hit = true;
        break; // 한 발에 한 명만 — 관통 없음
      }
    }
    if (!hit) projectiles.push(next);
  }

  // 공격 판정 — 참가자 순서(입장 순서)대로 한 명씩 처리, 쿨다운 통과 시 즉시 판정.
  // attackRequested는 "그 순간의 요청 1회"라, 처리 결과(성공/쿨다운 실패)와 무관하게 이
  // 틱에서 항상 소비(false로 리셋)한다 — 다음 틱까지 대기열에 남지 않는다.
  for (const id of Object.keys(players)) {
    const attacker = players[id];
    const wantsAttack = attacker.connected && attacker.alive && attacker.attackRequested;
    players[id] = { ...attacker, attackRequested: false };
    if (!wantsAttack) continue;
    const attackCooldownMs = attacker.isRanged === true
      ? RANGED_ATTACK_COOLDOWN_MS
      : MELEE_ATTACK_COOLDOWN_MS;
    if (now - attacker.lastAttackAt < attackCooldownMs) continue;

    if (attacker.isRanged === true) {
      // 원거리 무기는 즉시 판정하지 않고 투사체를 하나 스폰한다 — 이동/충돌은 다음 틱부터
      // 위 "기존 투사체" 루프에서 처리된다. 사거리(maxRange)는 AI(또는 폴백)가 이 무기에
      // 대해 정한 값을 그대로 쓰되, 값이 없거나 이상하면 최소 사거리로 방어한다.
      const maxRange = Number.isFinite(attacker.rangeDistance) ? attacker.rangeDistance : RANGE_DISTANCE_MIN;
      projectiles.push({
        id: `${id}-${now}-${Math.random().toString(36).slice(2, 8)}`,
        ownerId: id,
        x: attacker.x,
        y: attacker.y,
        aimX: attacker.aimX ?? 0,
        aimY: attacker.aimY ?? 1,
        traveled: 0,
        hpDamage: attacker.hpDamage,
        maxRange,
      });
      events.push({ type: 'attack', playerId: id, ranged: true, x: attacker.x, y: attacker.y });
    } else {
      const hitbox = meleeHitboxRect(attacker.x, attacker.y, attacker.aimX ?? 0, attacker.aimY ?? 1, CHARACTER_RADIUS);
      for (const targetId of Object.keys(players)) {
        if (targetId === id) continue;
        const target = players[targetId];
        if (!target.connected || !target.alive) continue;
        if (circleOverlapsRotatedRect(target.x, target.y, CHARACTER_RADIUS, hitbox)) {
          applyHit(players, id, targetId, attacker.hpDamage, now, events, room);
        }
      }
      events.push({ type: 'attack', playerId: id, ranged: false, x: attacker.x, y: attacker.y });
    }
    players[id] = { ...players[id], lastAttackAt: now };
  }

  // 목숨이 무한이라 라운드는 제한시간으로만 끝난다 — 다만 참가자가 0~1명이면(관리자가
  // 참가자가 한 명뿐이어도 부스 및 개발자 테스트가 가능하도록 제한 시간까지 진행한다.
  const allPlayers = Object.values(players);
  let winners = null;
  let status = room.status;
  if (allPlayers.length === 0) {
    winners = [];
    status = 'ended';
  } else if (now >= room.endsAt) {
    const maxScore = Math.max(...allPlayers.map((p) => computeScore(p)));
    winners = allPlayers.filter((p) => computeScore(p) === maxScore).map((p) => p.id);
    status = 'ended';
  }

  return { room: { ...room, players, projectiles, status }, winners, events };
}
