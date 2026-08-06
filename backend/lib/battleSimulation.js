export const CHARACTER_RADIUS = 20;
export const MOVE_SPEED = 4;
export const HIT_SCORE_COEFFICIENT = 0.05;
export const ATTACK_HITBOX_SIZE = 30;
export const ATTACK_COOLDOWN_MS = 500;
export const BATTLE_DURATION_MS = 90000;
// 조준 벡터가 이 길이보다 짧으면 "조준 입력 없음"으로 보고 이전 조준을 유지한다 — 모바일
// 조준 스틱이 중앙 근처에 있거나 마우스가 캐릭터 위에 있을 때, 히트박스가 캐릭터 자기
// 자신 위치로 무너지는 것을 방지한다.
const AIM_DEADZONE = 0.01;
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
function moveOne(player, walls, arenaSize) {
  const input = player.input ?? {};
  const move = normalizeIfLong(input.moveX ?? 0, input.moveY ?? 0);
  const dx = move.x * MOVE_SPEED;
  const dy = move.y * MOVE_SPEED;

  let x = clamp(player.x + dx, CHARACTER_RADIUS, arenaSize.width - CHARACTER_RADIUS);
  let y = clamp(player.y + dy, CHARACTER_RADIUS, arenaSize.height - CHARACTER_RADIUS);

  if (circleOverlapsAnyWall(x, player.y, CHARACTER_RADIUS, walls)) x = player.x;
  if (circleOverlapsAnyWall(x, y, CHARACTER_RADIUS, walls)) y = player.y;

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

// 공격 히트박스 — 캐릭터 중심에서 조준 방향으로 고정 거리만큼 떨어진 지점에 고정 크기
// 정사각형을 둔다. 4방향 lookup 대신 연속 각도(aimX/aimY)로 위치만 계산하므로, 히트박스
// 자체는 회전하지 않는 axis-aligned 사각형 그대로라 circleRectOverlap을 그대로 재사용한다.
function attackHitboxRect(player) {
  const offset = CHARACTER_RADIUS + ATTACK_HITBOX_SIZE / 2;
  const aimX = player.aimX ?? 0;
  const aimY = player.aimY ?? 1;
  const centerX = player.x + aimX * offset;
  const centerY = player.y + aimY * offset;
  return {
    x: centerX - ATTACK_HITBOX_SIZE / 2,
    y: centerY - ATTACK_HITBOX_SIZE / 2,
    width: ATTACK_HITBOX_SIZE,
    height: ATTACK_HITBOX_SIZE,
  };
}

export function stepSimulation(room, now) {
  if (room.status !== 'active') return { room, winners: null };

  const players = {};
  for (const id of Object.keys(room.players)) {
    const p = room.players[id];
    players[id] = p.connected ? applyAim(moveOne(p, room.walls, room.arenaSize)) : { ...p };
  }

  // 공격 판정 — 참가자 순서(입장 순서)대로 한 명씩 처리, 쿨다운 통과 시 즉시 판정.
  // attackRequested는 "그 순간의 요청 1회"라, 처리 결과(성공/쿨다운 실패)와 무관하게 이
  // 틱에서 항상 소비(false로 리셋)한다 — 다음 틱까지 대기열에 남지 않는다.
  for (const id of Object.keys(players)) {
    const attacker = players[id];
    const wantsAttack = attacker.connected && attacker.attackRequested;
    players[id] = { ...attacker, attackRequested: false };
    if (!wantsAttack) continue;
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
