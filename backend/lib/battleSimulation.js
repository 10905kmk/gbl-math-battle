export const ARENA_SIZE = { width: 800, height: 600 };
export const CHARACTER_RADIUS = 20;
export const MOVE_SPEED = 4;
export const HIT_DAMAGE_MIN = 5;
export const HIT_DAMAGE_MAX = 50;
export const ATTACK_HITBOX_SIZE = 30;
export const ATTACK_COOLDOWN_MS = 500;
export const BATTLE_DURATION_MS = 90000;

// weaponDamage는 소켓으로 들어오는 클라이언트 제공 값이라 숫자가 아닐 수도 있다 — 검증 없이
// 나누면 NaN이 되어(즉시 최소 데미지도 아니고 즉사급 비교 실패로 이어짐) 사고가 난다.
export function hitDamageFromWeaponDamage(weaponDamage) {
  const value = Number(weaponDamage);
  if (!Number.isFinite(value)) return HIT_DAMAGE_MIN;
  return Math.min(HIT_DAMAGE_MAX, Math.max(HIT_DAMAGE_MIN, Math.round(value / 200)));
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
    players[id] = p.alive ? moveOne(p, room.walls) : { ...p };
  }

  // 공격 판정 — 참가자 순서(입장 순서)대로 한 명씩 처리, 쿨다운 통과 시 즉시 판정
  for (const id of Object.keys(players)) {
    const attacker = players[id];
    if (!attacker.alive) continue;
    if (!attacker.input.attack) continue;
    if (now - attacker.lastAttackAt < ATTACK_COOLDOWN_MS) continue;

    const hitbox = attackHitboxRect(attacker);
    for (const targetId of Object.keys(players)) {
      if (targetId === id) continue;
      const target = players[targetId];
      if (!target.alive) continue;
      if (circleRectOverlap(target.x, target.y, CHARACTER_RADIUS, hitbox.x, hitbox.y, hitbox.width, hitbox.height)) {
        const hp = Math.max(0, target.hp - attacker.hitDamage);
        players[targetId] = { ...target, hp, alive: hp > 0 };
      }
    }
    players[id] = { ...attacker, lastAttackAt: now };
  }

  const alivePlayers = Object.values(players).filter((p) => p.alive);
  let winners = null;
  let status = room.status;
  if (alivePlayers.length <= 1) {
    winners = alivePlayers.map((p) => p.id);
    status = 'ended';
  } else if (now >= room.endsAt) {
    // 죽은 참가자(연결 끊김 등으로 alive=false)는 체력이 남아있어도 최다 체력 후보에서 제외.
    // 이 시점엔 alivePlayers.length가 항상 2 이상이라(위 분기에서 이미 걸러짐) 빈 배열 걱정은 없음.
    const maxHp = Math.max(...alivePlayers.map((p) => p.hp));
    winners = alivePlayers
      .filter((p) => p.hp === maxHp)
      .map((p) => p.id);
    status = 'ended';
  }

  return { room: { ...room, players, status }, winners };
}
