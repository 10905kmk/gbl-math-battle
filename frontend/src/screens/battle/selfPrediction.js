// 서버(backend/lib/battleSimulation.js)의 moveOne()과 같은 축의 이동 물리를 본인 캐릭터에
// 한해 클라이언트에서 미리 계산한다 — 서버 응답(battle:state, 20Hz)을 기다리지 않고 매
// 애니메이션 프레임 그려서 입력 지연 체감을 없앤다. 스킬로 인한 속도 배율(가속/감속/시간정지
// 등, backend/lib/skillEngine.js의 speedMultiplier)은 의도적으로 재현하지 않는다 — 그 상태가
// 걸린 짧은 동안만 예측이 살짝 어긋났다가 reconcileSelfPosition이 다음 상태 수신 시 자연스럽게
// 맞춰준다(docs/superpowers/specs/2026-08-10-battle-movement-prediction-design.md 참고).
import { circleOverlapsAnyWall, resolveCircleFromWalls } from '../../../../shapes/collision.js';

// 서버 moveSpeed 단위 기준(틱당 픽셀) — 이 값으로 dtMs 기반 속도로 환산한다.
const SERVER_TICK_MS = 50;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// 서버 normalizeIfLong과 동일한 규칙 — 대각선 입력이 자동으로 √2배 빨라지지 않게 한다.
function normalizeIfLong(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  if (len <= 1) return { x, y };
  return { x: x / len, y: y / len };
}

export function predictSelfMove(pos, input, moveSpeed, walls, arenaSize, radius, dtMs) {
  const move = normalizeIfLong(input?.moveX ?? 0, input?.moveY ?? 0);
  const effective = (moveSpeed / SERVER_TICK_MS) * dtMs;
  const dx = move.x * effective;
  const dy = move.y * effective;

  const safeStart = resolveCircleFromWalls(pos.x, pos.y, radius, walls, arenaSize);
  let x = clamp(safeStart.x + dx, radius, arenaSize.width - radius);
  let y = clamp(safeStart.y + dy, radius, arenaSize.height - radius);

  if (circleOverlapsAnyWall(x, safeStart.y, radius, walls)) x = safeStart.x;
  if (circleOverlapsAnyWall(x, y, radius, walls)) y = safeStart.y;

  return { x, y };
}
