export function circleRectOverlap(cx, cy, radius, rect) {
  const closestX = Math.min(rect.x + rect.width, Math.max(rect.x, cx));
  const closestY = Math.min(rect.y + rect.height, Math.max(rect.y, cy));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}

export function circleOverlapsAnyWall(cx, cy, radius, walls = []) {
  return walls.some((wall) => circleRectOverlap(cx, cy, radius, wall));
}

// 맵 좌표 수정, 대쉬/넉백, 지연 프레임 등으로 이미 벽 안에 들어간 캐릭터가 있으면 일반
// 충돌 로직은 현재 좌표까지 충돌로 판단해 어느 방향으로도 못 나오는 경우가 있다. 겹친 벽의
// 확장 경계 네 곳 중 이동량이 가장 작고 다른 벽과 겹치지 않는 위치로 밀어내 복구한다.
export function resolveCircleFromWalls(cx, cy, radius, walls = [], arenaSize) {
  const clampX = (x) => arenaSize ? Math.min(arenaSize.width - radius, Math.max(radius, x)) : x;
  const clampY = (y) => arenaSize ? Math.min(arenaSize.height - radius, Math.max(radius, y)) : y;
  let x = clampX(cx);
  let y = clampY(cy);

  for (let attempt = 0; attempt < Math.min(12, walls.length + 1); attempt += 1) {
    const wall = walls.find((candidate) => circleRectOverlap(x, y, radius, candidate));
    if (!wall) break;
    const candidates = [
      { x: clampX(wall.x - radius), y },
      { x: clampX(wall.x + wall.width + radius), y },
      { x, y: clampY(wall.y - radius) },
      { x, y: clampY(wall.y + wall.height + radius) },
    ].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    const safe = candidates.find((candidate) => !circleOverlapsAnyWall(candidate.x, candidate.y, radius, walls));
    if (!safe) break;
    x = safe.x;
    y = safe.y;
  }
  return { x, y };
}
