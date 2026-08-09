// 특수 스킬의 실제 판정 — 순수 로직(Konva/소켓 의존 없음)이라 노드에서 그대로 테스트한다.
//
// 설계 원칙: 스킬마다 서버 코드를 따로 흩어놓지 않고, 플레이어에 "상태(status)"를 남기고
// 시뮬레이션 루프가 그 상태를 해석하게 한다. 스킬이 20개라도 판정 지점은
//   - activateSkill()  : 버튼을 눌렀을 때 한 번
//   - tickSkillWorld() : 매 틱(지뢰/블랙홀/진주/독 도트)
//   - 데미지 계산 훅   : outgoingMultiplier / incomingMultiplier / onDamaged
// 세 곳뿐이라 서로 간섭하지 않는다.
import { getSkill, METER } from '../../shapes/skills.js';
import { MAX_HP } from '../../shapes/combatRules.js';
import { circleRectOverlap, resolveCircleFromWalls } from '../../shapes/collision.js';

export const CHARACTER_RADIUS = 20;

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// 스킬이 만들어내는 시각 효과는 서버가 만들어 room.effects에 넣고, 클라이언트는 그걸
// 그대로 그리기만 한다 — 파티클이 "모두에게 보인다"는 요구를 만족시키는 가장 단순한 방법.
export function ensureSkillWorld(room) {
  if (!room.effects) room.effects = [];
  if (!room.mines) room.mines = [];
  if (!room.blackholes) room.blackholes = [];
  if (!room.pearls) room.pearls = [];
  if (!Number.isFinite(room.effectSeq)) room.effectSeq = 1;
  return room;
}

export function pushEffect(room, effect) {
  ensureSkillWorld(room);
  room.effects.push({ id: `fx${room.effectSeq++}`, ...effect });
}

function hasSkill(player, skillId) {
  return player.skillId === skillId || player.skillIds?.includes(skillId);
}

function skillReadyAt(player, skillId) {
  if (Array.isArray(player.skillIds)) return player.skillReadyAts?.[skillId] ?? 0;
  return player.skillReadyAt ?? 0;
}

function setSkillReadyAt(player, skillId, readyAt) {
  if (Array.isArray(player.skillIds)) {
    player.skillReadyAts = { ...(player.skillReadyAts ?? {}), [skillId]: readyAt };
  } else {
    player.skillReadyAt = readyAt;
  }
}

export function newPlayerSkillState(skillId) {
  return {
    skillId: skillId ?? null,
    // 0이면 즉시 사용 가능. 처음 시작할 때와 부활 직후엔 항상 0으로 둔다(요구사항).
    skillReadyAt: 0,
    status: {
      speedUntil: 0, speedMul: 1,
      slowUntil: 0, slowMul: 1,
      frozenUntil: 0,
      invulnUntil: 0,
      cloakUntil: 0,
      reflectUntil: 0,
      poisonArmedUntil: 0,
      poisonedUntil: 0, poisonedBy: null, poisonNextTickAt: 0,
      markedBy: null, markedUntil: 0,
      savedX: null, savedY: null, savedUntil: 0,
      lastStandUntil: 0,
      luckyUntil: 0, luckyReadyAt: 0,
    },
  };
}

// 죽었다 부활하면 걸려 있던 디버프/버프를 모두 지우고 스킬을 바로 쓸 수 있게 한다(요구사항).
export function resetSkillsOnRespawn(player) {
  const fresh = newPlayerSkillState(player.skillId);
  // 최후의 발악은 "죽고 부활하면 바로 발동 가능"이라 재사용 대기도 같이 지운다.
  return {
    ...player,
    skillReadyAt: 0,
    skillReadyAts: Array.isArray(player.skillIds) ? {} : player.skillReadyAts,
    status: fresh.status,
  };
}

export function isFrozen(player, now) {
  return (player.status?.frozenUntil ?? 0) > now;
}

export function isInvulnerable(player, now) {
  const s = player.status ?? {};
  return (s.invulnUntil ?? 0) > now || (s.cloakUntil ?? 0) > now;
}

export function isCloaked(player, now) {
  return (player.status?.cloakUntil ?? 0) > now;
}

// 이동 속도 배율 — 버프(속도증가/최후의 발악)와 디버프(속도지옥)가 함께 걸릴 수 있으므로
// 곱해서 합친다. 얼면 0.
export function speedMultiplier(player, now) {
  const s = player.status ?? {};
  if ((s.frozenUntil ?? 0) > now) return 0;
  let mul = 1;
  if ((s.speedUntil ?? 0) > now) mul *= s.speedMul ?? 1;
  if ((s.lastStandUntil ?? 0) > now) mul *= getSkill('lastStand').speedMultiplier;
  if ((s.slowUntil ?? 0) > now) mul /= s.slowMul ?? 1;
  return mul;
}

// 공격자가 주는 피해 배율 — 최후의 발악/사형선고 표식/운빨을 전부 여기서 합친다.
export function outgoingDamageMultiplier(attacker, target, now, random = Math.random) {
  const s = attacker.status ?? {};
  let mul = 1;
  if ((s.lastStandUntil ?? 0) > now) mul *= getSkill('lastStand').damageOut;
  // 사형선고: 표식을 남긴 "그 사람"이 때릴 때만 증폭된다.
  if (target.status?.markedBy === attacker.id && (target.status?.markedUntil ?? 0) > now) {
    mul *= getSkill('deathMark').damageBonus;
  }
  let lucky = false;
  if (hasSkill(attacker, 'lucky')) {
    const skill = getSkill('lucky');
    if ((s.luckyUntil ?? 0) > now) {
      mul *= skill.multiplier;
      lucky = true;
    } else if (now >= (s.luckyReadyAt ?? 0)) {
      s.luckyReadyAt = now + skill.cooldownMs;
      if (random() < skill.chance) {
        s.luckyUntil = now + skill.activationDurationMs;
        mul *= skill.multiplier;
        lucky = true;
      }
    }
  }
  return { multiplier: mul, lucky };
}

export function incomingDamageMultiplier(target, now) {
  return 1;
}

// 원 안의 살아 있는 다른 플레이어들.
function enemiesInRadius(players, self, cx, cy, radius, now) {
  return Object.values(players).filter(
    (p) => p.id !== self.id && p.alive && p.connected && !isCloaked(p, now) && dist(p.x, p.y, cx, cy) <= radius,
  );
}

// 앞쪽 부채꼴 안의 모든 적. 콜드플레이는 전원, 연행영장/사형선고는
// 이 목록에서 가장 가까운 한 명만 사용한다.
function coneTargets(players, self, range, halfAngle, now) {
  const ax = self.aimX ?? 0;
  const ay = self.aimY ?? 1;
  return Object.values(players).filter((p) => {
    if (p.id === self.id || !p.alive || !p.connected || isCloaked(p, now)) return false;
    const dx = p.x - self.x;
    const dy = p.y - self.y;
    const d = Math.hypot(dx, dy);
    if (d > range || d === 0) return false;
    // 조준 방향과 대상 방향 사이의 각도가 halfAngle 이내인지 — 내적으로 판정한다.
    const cos = (dx * ax + dy * ay) / d;
    return cos >= Math.cos(halfAngle);
  });
}

function pickConeTarget(players, self, range, halfAngle, now) {
  const candidates = coneTargets(players, self, range, halfAngle, now);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, p) =>
    dist(p.x, p.y, self.x, self.y) < dist(best.x, best.y, self.x, self.y) ? p : best,
  );
}

// 벽/경계를 뚫지 않는 선에서 (x,y)로 최대한 밀어낸다 — 대쉬/넉백/끌어당김이 공유한다.
function moveToward(player, targetX, targetY, room) {
  const steps = 8;
  const safeStart = resolveCircleFromWalls(player.x, player.y, CHARACTER_RADIUS, room.walls, room.arenaSize);
  let lastX = safeStart.x;
  let lastY = safeStart.y;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const nx = clamp(safeStart.x + (targetX - safeStart.x) * t, CHARACTER_RADIUS, room.arenaSize.width - CHARACTER_RADIUS);
    const ny = clamp(safeStart.y + (targetY - safeStart.y) * t, CHARACTER_RADIUS, room.arenaSize.height - CHARACTER_RADIUS);
    if (room.walls.some((w) => circleRectOverlap(nx, ny, CHARACTER_RADIUS, w))) break;
    lastX = nx;
    lastY = ny;
  }
  return { x: lastX, y: lastY };
}

// 스킬이 직접 주는 피해(충격파/콜드플레이/지뢰/독 도트)는 무기 데미지와 별개로 "HP %"다.
// 실드/투명(무적)은 여기서도 막고, 반사도 여기서 함께 처리한다.
export function applySkillDamage(room, attackerId, target, percent, now, events) {
  if (!target.alive || isInvulnerable(target, now)) return;
  const attacker = room.players[attackerId];
  const amount = round1(percent * incomingDamageMultiplier(target, now));
  target.hp = round1(Math.max(0, target.hp - amount));
  target.recentDamagers = { ...(target.recentDamagers ?? {}), [attackerId]: now };
  events.push({ type: 'hit', targetId: target.id, attackerId, damage: amount, x: target.x, y: target.y });

  // 반사 — 피해를 준 쪽이 그 절반을 되돌려받는다(대상 자신은 원래 피해를 그대로 받는다).
  if ((target.status?.reflectUntil ?? 0) > now && attacker && attacker.alive && !isInvulnerable(attacker, now)) {
    const back = round1(amount * getSkill('reflect').reflectRatio);
    attacker.hp = round1(Math.max(0, attacker.hp - back));
    pushEffect(room, { type: 'reflect', x: attacker.x, y: attacker.y, endsAt: now + 500 });
  }

  if (target.hp <= 0) {
    killPlayer(room, attackerId, target, now, events);
  }
}

// battleSimulation.js의 죽음 처리와 같은 규칙(킬/데스/어시스트) — 스킬 피해로 죽는 경우에도
// 기록이 똑같이 남아야 해서 여기 한 벌 더 두지 않고 콜백으로 주입받는다.
let killHandler = null;
export function setKillHandler(fn) {
  killHandler = fn;
}
function killPlayer(room, attackerId, target, now, events) {
  if (killHandler) killHandler(room, attackerId, target, now, events);
}

// ── 스킬 발동 ────────────────────────────────────────────────────────────
export function activateSkill(room, playerId, now, random = Math.random, requestedSkillId = null) {
  const player = room.players[playerId];
  if (!player || !player.alive || !player.connected) return false;
  if (isFrozen(player, now)) return false;
  const selectedSkillId = requestedSkillId ?? player.skillId;
  if (requestedSkillId && Array.isArray(player.skillIds) && !player.skillIds.includes(requestedSkillId)) return false;
  const skill = getSkill(selectedSkillId);
  if (!skill || skill.kind === 'passive') return false;
  // 텔레포트 백은 "저장 대기 중"일 때 쿨타임을 무시하고 두 번째 입력을 받아야 한다.
  const recallPending = skill.id === 'recall' && (player.status.savedUntil ?? 0) > now;
  if (!recallPending && now < skillReadyAt(player, skill.id)) return false;

  const events = [];
  const s = player.status;

  switch (skill.id) {
    case 'heal': {
      player.hp = round1(Math.min(MAX_HP, player.hp + skill.healPercent));
      pushEffect(room, { type: 'heal', playerId, endsAt: now + skill.activationDurationMs, color: skill.color });
      break;
    }
    case 'shield': {
      s.invulnUntil = now + skill.activationDurationMs;
      pushEffect(room, { type: 'shield', playerId, endsAt: s.invulnUntil, color: skill.color });
      break;
    }
    case 'reflect': {
      s.reflectUntil = now + skill.activationDurationMs;
      pushEffect(room, { type: 'reflectAura', playerId, endsAt: s.reflectUntil, color: skill.color });
      break;
    }
    case 'speedUp': {
      s.speedUntil = now + skill.activationDurationMs;
      s.speedMul = skill.speedMultiplier;
      pushEffect(room, { type: 'speedUp', playerId, endsAt: s.speedUntil, color: skill.color });
      break;
    }
    case 'cloak': {
      s.cloakUntil = now + skill.activationDurationMs;
      // 상대에게는 은신 위치를 노출하지 않고, 사용자 본인에게만 발동 상태를 알린다.
      pushEffect(room, {
        type: 'cloakSelf', playerId, ownerId: playerId, ownerOnly: true,
        endsAt: s.cloakUntil, color: skill.color,
      });
      break;
    }
    case 'poison': {
      s.poisonArmedUntil = now + skill.activationDurationMs;
      pushEffect(room, { type: 'poisonArm', playerId, endsAt: s.poisonArmedUntil, color: skill.color });
      break;
    }
    case 'dash': {
      const from = { x: player.x, y: player.y };
      const to = moveToward(
        player,
        player.x + (player.aimX ?? 0) * skill.distance,
        player.y + (player.aimY ?? 1) * skill.distance,
        room,
      );
      player.x = to.x;
      player.y = to.y;
      s.invulnUntil = Math.max(s.invulnUntil, now + skill.activationDurationMs);
      pushEffect(room, { type: 'dash', fromX: from.x, fromY: from.y, x: to.x, y: to.y, endsAt: now + skill.activationDurationMs, color: skill.color });
      break;
    }
    case 'recall': {
      if (recallPending) {
        pushEffect(room, { type: 'recallJump', fromX: player.x, fromY: player.y, x: s.savedX, y: s.savedY, endsAt: now + 600, color: skill.color });
        player.x = s.savedX;
        player.y = s.savedY;
        s.savedUntil = 0;
        s.savedX = null;
        s.savedY = null;
        setSkillReadyAt(player, skill.id, now + skill.cooldownMs);
        room.events = events;
        return true;
      }
      s.savedX = player.x;
      s.savedY = player.y;
      s.savedUntil = now + skill.activationDurationMs;
      pushEffect(room, { type: 'recallMark', x: player.x, y: player.y, endsAt: s.savedUntil, color: skill.color });
      // 첫 입력은 위치만 저장한다. 재사용 대기 40초는 실제로 복귀한 순간에만 시작한다.
      return true;
    }
    case 'blink': {
      room.pearls.push({
        id: `pearl${room.effectSeq++}`,
        ownerId: playerId,
        x: player.x, y: player.y,
        aimX: player.aimX ?? 0, aimY: player.aimY ?? 1,
        traveled: 0,
        speed: skill.projectileSpeed,
        maxRange: skill.maxRange,
        endsAt: now + skill.activationDurationMs,
      });
      break;
    }
    case 'mine': {
      // 최대 1개 — 새로 놓으면 이전 것은 사라진다.
      room.mines = room.mines.filter((m) => m.ownerId !== playerId);
      room.mines.push({
        id: `mine${room.effectSeq++}`, ownerId: playerId, x: player.x, y: player.y,
        endsAt: now + skill.activationDurationMs,
      });
      break;
    }
    case 'blackhole': {
      const cx = player.x + (player.aimX ?? 0) * skill.placeDistance;
      const cy = player.y + (player.aimY ?? 1) * skill.placeDistance;
      room.blackholes.push({
        id: `bh${room.effectSeq++}`,
        ownerId: playerId,
        x: clamp(cx, 0, room.arenaSize.width),
        y: clamp(cy, 0, room.arenaSize.height),
        radius: skill.radius,
        endsAt: now + skill.activationDurationMs,
      });
      break;
    }
    case 'slowHell':
    case 'timeStop':
    case 'shockwave': {
      const targets = enemiesInRadius(room.players, player, player.x, player.y, skill.radius, now);
      for (const t of targets) {
        if (skill.id === 'slowHell') {
          t.status.slowUntil = now + skill.activationDurationMs;
          t.status.slowMul = skill.slowFactor;
        } else if (skill.id === 'timeStop') {
          if (!isInvulnerable(t, now)) t.status.frozenUntil = now + skill.activationDurationMs;
        } else {
          // 충격파 — 밀어낸 뒤 피해. 순서를 반대로 하면 죽은 대상을 밀어내게 된다.
          const dx = t.x - player.x;
          const dy = t.y - player.y;
          const len = Math.hypot(dx, dy) || 1;
          const to = moveToward(t, t.x + (dx / len) * skill.knockback, t.y + (dy / len) * skill.knockback, room);
          t.x = to.x;
          t.y = to.y;
          applySkillDamage(room, playerId, t, skill.damagePercent, now, events);
        }
      }
      pushEffect(room, {
        type: skill.id, playerId, x: player.x, y: player.y,
        radius: skill.radius, endsAt: now + skill.activationDurationMs,
        color: skill.color,
      });
      break;
    }
    case 'warrant':
    case 'coldplay':
    case 'deathMark': {
      const targets = coneTargets(room.players, player, skill.range, skill.halfAngle, now);
      const target = pickConeTarget(room.players, player, skill.range, skill.halfAngle, now);
      // 사형선고는 사용 순간 대상이 확정되고 과녁만 남아야 한다. 이전 프레임의 부채꼴도
      // 즉시 지운 뒤 새 부채꼴을 만들지 않는다. 연행영장은 0.5초, 콜드플레이는 2초 유지.
      if (skill.id === 'deathMark') {
        room.effects = room.effects.filter((fx) => !(fx.type === 'cone' && fx.skillId === 'deathMark' && fx.playerId === playerId));
      } else {
        const coneDurationMs = skill.id === 'coldplay' ? skill.activationDurationMs : 500;
        pushEffect(room, {
          type: 'cone', skillId: skill.id, playerId,
          x: player.x, y: player.y, aimX: player.aimX ?? 0, aimY: player.aimY ?? 1,
          range: skill.range, halfAngle: skill.halfAngle,
          endsAt: now + coneDurationMs, color: skill.color,
        });
      }
      if (target) {
        if (skill.id === 'warrant') {
          // 자신 앞 한 칸(캐릭터 지름)에 끌어다 놓는다.
          const front = 2 * CHARACTER_RADIUS + 8;
          const to = moveToward(target, player.x + (player.aimX ?? 0) * front, player.y + (player.aimY ?? 1) * front, room);
          pushEffect(room, { type: 'pullLine', fromX: target.x, fromY: target.y, x: to.x, y: to.y, endsAt: now + 500, color: skill.color });
          target.x = to.x;
          target.y = to.y;
        } else if (skill.id === 'coldplay') {
          for (const frozenTarget of targets) {
            if (isInvulnerable(frozenTarget, now)) continue;
            frozenTarget.status.frozenUntil = now + skill.activationDurationMs;
            pushEffect(room, {
              type: 'frozenIce', playerId: frozenTarget.id,
              endsAt: frozenTarget.status.frozenUntil, color: skill.color,
            });
            applySkillDamage(room, playerId, frozenTarget, skill.damagePercent, now, events);
          }
        } else {
          target.status.markedBy = playerId;
          target.status.markedUntil = now + skill.activationDurationMs;
          pushEffect(room, { type: 'mark', playerId: target.id, endsAt: target.status.markedUntil, color: skill.color });
        }
      }
      break;
    }
    default:
      return false;
  }

  setSkillReadyAt(player, skill.id, now + skill.cooldownMs);
  room.events = events;
  return true;
}

// ── 매 틱 처리 ──────────────────────────────────────────────────────────
// 지뢰/블랙홀/진주/독 도트/최후의 발악/만료된 이펙트를 한 번에 정리한다.
export function tickSkillWorld(room, now, events) {
  // 스킬 월드 배열이 없는 room(예전 형식/단위 테스트가 만든 최소 room)도 크래시 없이
  // 그냥 "스킬이 아무것도 없는 판"으로 돌아가야 한다 — 전투 자체가 스킬 때문에 멈추면 안 된다.
  ensureSkillWorld(room);

  // 만료된 시각 효과 제거
  room.effects = room.effects.filter((e) => e.endsAt > now);

  // 순간이동 진주 — 벽에 닿는 순간 주인이 그 자리로 이동한다.
  const pearls = [];
  for (const pearl of room.pearls) {
    const nx = pearl.x + pearl.aimX * pearl.speed;
    const ny = pearl.y + pearl.aimY * pearl.speed;
    const traveled = pearl.traveled + pearl.speed;
    const owner = room.players[pearl.ownerId];
    const hitWall =
      room.walls.some((w) => circleRectOverlap(nx, ny, 6, w)) ||
      nx <= CHARACTER_RADIUS || ny <= CHARACTER_RADIUS ||
      nx >= room.arenaSize.width - CHARACTER_RADIUS || ny >= room.arenaSize.height - CHARACTER_RADIUS;

    if (hitWall || traveled >= pearl.maxRange || now >= pearl.endsAt) {
      if (owner && owner.alive) {
        const to = moveToward(owner, pearl.x, pearl.y, room);
        pushEffect(room, { type: 'blinkJump', fromX: owner.x, fromY: owner.y, x: to.x, y: to.y, endsAt: now + 500, color: '#ffffff' });
        owner.x = to.x;
        owner.y = to.y;
      }
      continue;
    }
    pearls.push({ ...pearl, x: nx, y: ny, traveled });
  }
  room.pearls = pearls;

  // 블랙홀 — 살아 있는 동안 반경 안의 적을 중심으로 끌어당긴다.
  room.blackholes = room.blackholes.filter((bh) => bh.endsAt > now);
  for (const bh of room.blackholes) {
    for (const p of Object.values(room.players)) {
      if (p.id === bh.ownerId || !p.alive || !p.connected) continue;
      const d = dist(p.x, p.y, bh.x, bh.y);
      if (d > bh.radius || d < 1) continue;
      const skill = getSkill('blackhole');
      const to = moveToward(p, p.x + ((bh.x - p.x) / d) * skill.pullPerTick, p.y + ((bh.y - p.y) / d) * skill.pullPerTick, room);
      p.x = to.x;
      p.y = to.y;
    }
  }

  // 지뢰 — 설치자 외의 적이 가까이 오면 폭발.
  const mineSkill = getSkill('mine');
  const remainingMines = [];
  for (const mine of room.mines) {
    if (now >= mine.endsAt) continue;
    const victim = Object.values(room.players).find(
      (p) => p.id !== mine.ownerId && p.alive && p.connected && dist(p.x, p.y, mine.x, mine.y) <= mineSkill.triggerRadius,
    );
    if (!victim) {
      remainingMines.push(mine);
      continue;
    }
    const dx = victim.x - mine.x;
    const dy = victim.y - mine.y;
    const len = Math.hypot(dx, dy) || 1;
    const to = moveToward(victim, victim.x + (dx / len) * mineSkill.knockback, victim.y + (dy / len) * mineSkill.knockback, room);
    victim.x = to.x;
    victim.y = to.y;
    pushEffect(room, { type: 'mineBoom', x: mine.x, y: mine.y, endsAt: now + 600, color: mineSkill.color });
    applySkillDamage(room, mine.ownerId, victim, mineSkill.damagePercent, now, events);
  }
  room.mines = remainingMines;

  // 독 도트 — 1초마다 1%씩.
  const poisonSkill = getSkill('poison');
  for (const p of Object.values(room.players)) {
    const s = p.status;
    if (!s || !p.alive) continue;
    if ((s.poisonedUntil ?? 0) > now && now >= (s.poisonNextTickAt ?? 0)) {
      s.poisonNextTickAt = now + 1000;
      applySkillDamage(room, s.poisonedBy ?? p.id, p, poisonSkill.dotPercentPerSec, now, events);
    }

    // 최후의 발악 — HP가 20 이하인 동안 무제한 유지. 쿨타임은 없고
    // 회복/사망/부활로 HP 조건을 벗어나면 즉시 상태와 파티클을 제거한다.
    if (hasSkill(p, 'lastStand')) {
      const skill = getSkill('lastStand');
      const active = p.alive && p.hp > 0 && p.hp <= skill.thresholdHp;
      if (active && (s.lastStandUntil ?? 0) <= now) {
        s.lastStandUntil = Number.MAX_SAFE_INTEGER;
        pushEffect(room, { type: 'lastStand', playerId: p.id, endsAt: s.lastStandUntil, color: skill.color });
      } else if (!active) {
        s.lastStandUntil = 0;
        room.effects = room.effects.filter((fx) => !(fx.type === 'lastStand' && fx.playerId === p.id));
      }
    }
  }
}

// 무기 공격이 명중했을 때 "독" 부착을 처리한다 — battleSimulation의 applyHit이 호출한다.
export function onWeaponHit(room, attacker, target, now) {
  const s = attacker.status;
  if (!s || !hasSkill(attacker, 'poison')) return;
  if ((s.poisonArmedUntil ?? 0) <= now) return;
  const skill = getSkill('poison');
  s.poisonArmedUntil = 0;
  target.status.poisonedUntil = now + skill.dotMs;
  target.status.poisonedBy = attacker.id;
  target.status.poisonNextTickAt = now + 1000;
  pushEffect(room, { type: 'poisoned', playerId: target.id, endsAt: target.status.poisonedUntil, color: skill.color });
}

export { METER };
