export const ARENA_SIZE = { width: 800, height: 600 };
export const CHARACTER_RADIUS = 20;
export const MOVE_SPEED = 4;
export const HIT_SCORE_COEFFICIENT = 0.05;
export const ATTACK_HITBOX_SIZE = 30;
export const ATTACK_COOLDOWN_MS = 500;
export const BATTLE_DURATION_MS = 90000;
// aiClient.js의 DAMAGE_MAX와 같은 상한 — weapon.damage는 소켓으로 들어오는 클라이언트 제공
// 값이라 서버 검증을 거치지 않는다. 상한 없이 곱하면 비정상적으로 큰 값(치트/버그)이 그대로
// 점수에 반영되어 한 방에 상대를 0점으로 만들거나, DB의 score integer 컬럼 범위를 넘길 수
// 있다(Opus 리뷰 Critical C1).
const WEAPON_DAMAGE_MAX = 10000;

// weaponDamage는 숫자가 아니거나 0 이하일 수도 있다 — 검증 없이 곱하면 NaN/음수 점수 변동으로
// 이어져 사고가 난다. 숫자가 아니거나 0 이하면 최소치(1)로 취급하고, 큰 값은 위 상한으로
// clamp한다. 계산 결과가 0이 되면(약한 무기가 반올림으로 0점) 한 대 맞혔는데도 점수가 전혀
// 안 오르는 게 되므로, 명중은 항상 최소 1점을 보장한다(Opus 리뷰 Important I1).
export function hitScoreFromWeaponDamage(weaponDamage) {
  const value = Number(weaponDamage);
  const safeValue = Number.isFinite(value) && value > 0 ? Math.min(value, WEAPON_DAMAGE_MAX) : 1;
  return Math.max(1, Math.round(safeValue * HIT_SCORE_COEFFICIENT));
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function circleRectOverlap(cx, cy, r, rectX, rectY, rectW, rectH) {
  const closestX = clamp(cx, rectX, rectX + rectW);
  const closestY = clamp(cy, rectY, rectY + rectH);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

function circleOverlapsAnyWall(cx, cy, r, walls) {
  return walls.some((w) => circleRectOverlap(cx, cy, r, w.x, w.y, w.width, w.height));
}

// 입력 방향 우선순위 고정: up > down > left > right. 여러 방향이 동시에 눌려도(대각선 입력 등)
// 하나만 적용 — "마지막으로 누른 방향" 추적은 상태가 필요해 순수 함수 원칙과 안 맞아서 단순화.
function moveOne(player, walls) {
  const { up, down, left, right } = player.input;
  let dx = 0;
  let dy = 0;
  let facing = player.facing;
  if (up) {
    dy = -MOVE_SPEED;
    facing = 'up';
  } else if (down) {
    dy = MOVE_SPEED;
    facing = 'down';
  } else if (left) {
    dx = -MOVE_SPEED;
    facing = 'left';
  } else if (right) {
    dx = MOVE_SPEED;
    facing = 'right';
  }

  let x = clamp(player.x + dx, CHARACTER_RADIUS, ARENA_SIZE.width - CHARACTER_RADIUS);
  let y = clamp(player.y + dy, CHARACTER_RADIUS, ARENA_SIZE.height - CHARACTER_RADIUS);

  if (circleOverlapsAnyWall(x, player.y, CHARACTER_RADIUS, walls)) x = player.x;
  if (circleOverlapsAnyWall(x, y, CHARACTER_RADIUS, walls)) y = player.y;

  return { ...player, x, y, facing };
}

function attackHitboxRect(player) {
  const offset = CHARACTER_RADIUS + ATTACK_HITBOX_SIZE / 2;
  const center = {
    up: { x: player.x, y: player.y - offset },
    down: { x: player.x, y: player.y + offset },
    left: { x: player.x - offset, y: player.y },
    right: { x: player.x + offset, y: player.y },
  }[player.facing];
  return {
    x: center.x - ATTACK_HITBOX_SIZE / 2,
    y: center.y - ATTACK_HITBOX_SIZE / 2,
    width: ATTACK_HITBOX_SIZE,
    height: ATTACK_HITBOX_SIZE,
  };
}

export function stepSimulation(room, now) {
  if (room.status !== 'active') return { room, winners: null };

  const players = {};
  for (const id of Object.keys(room.players)) {
    const p = room.players[id];
    players[id] = p.connected ? moveOne(p, room.walls) : { ...p };
  }

  // 공격 판정 — 참가자 순서(입장 순서)대로 한 명씩 처리, 쿨다운 통과 시 즉시 판정.
  // 맞히면 공격자 점수는 오르고, 맞은 쪽 점수는 내려가되 0 밑으로는 안 내려간다(탈락 없음).
  for (const id of Object.keys(players)) {
    const attacker = players[id];
    if (!attacker.connected) continue;
    if (!attacker.input.attack) continue;
    if (now - attacker.lastAttackAt < ATTACK_COOLDOWN_MS) continue;

    const hitbox = attackHitboxRect(attacker);
    const delta = attacker.hitScore;
    for (const targetId of Object.keys(players)) {
      if (targetId === id) continue;
      const target = players[targetId];
      if (!target.connected) continue;
      if (circleRectOverlap(target.x, target.y, CHARACTER_RADIUS, hitbox.x, hitbox.y, hitbox.width, hitbox.height)) {
        players[targetId] = { ...target, score: Math.max(0, target.score - delta) };
        players[id] = { ...players[id], score: players[id].score + delta };
      }
    }
    players[id] = { ...players[id], lastAttackAt: now };
  }

  // 탈락이 없으므로 승패는 원칙적으로 제한시간 종료 시점에만 갈린다 — 다만 참가자가 0~1명이면
  // (관리자가 아무도/한 명만 완료 안 한 상태에서 강제로 battle 단계로 넘긴 경우) 제한시간을
  // 다 채울 이유가 없으므로 그 즉시 종료한다(Opus 리뷰 Important I3).
  const allPlayers = Object.values(players);
  let winners = null;
  let status = room.status;
  if (allPlayers.length <= 1) {
    winners = allPlayers.map((p) => p.id);
    status = 'ended';
  } else if (now >= room.endsAt) {
    const maxScore = Math.max(...allPlayers.map((p) => p.score));
    winners = allPlayers.filter((p) => p.score === maxScore).map((p) => p.id);
    status = 'ended';
  }

  return { room: { ...room, players, status }, winners };
}
