// 서버(backend/lib/battleSimulation.js)의 moveOne()과 같은 축의 이동 물리를 본인 캐릭터에
// 한해 클라이언트에서 미리 계산한다 — 서버 응답(battle:state, 20Hz)을 기다리지 않고 매
// 애니메이션 프레임 그려서 입력 지연 체감을 없앤다. 스킬로 인한 속도 배율(가속/감속/시간정지
// 등, backend/lib/skillEngine.js의 speedMultiplier)은 의도적으로 재현하지 않는다 — 그 상태가
// 걸린 짧은 동안만 예측이 살짝 어긋났다가 reconcileSelfPosition이 다음 상태 수신 시 자연스럽게
// 맞춰준다(docs/superpowers/specs/2026-08-10-battle-movement-prediction-design.md 참고).
import { circleOverlapsAnyWall, resolveCircleFromWalls } from '../../../../shapes/collision.js';

// 서버 moveSpeed 단위 기준(틱당 픽셀) — 이 값으로 dtMs 기반 속도로 환산한다.
const SERVER_TICK_MS = 50;
// 탭이 백그라운드로 갔다가 돌아오거나 브라우저가 rAF를 멈췄다 재개하면 frame.timeDiff가
// 수 초~수십 초로 튈 수 있다 — 그대로 쓰면 한 프레임에 맵을 가로지르는 순간이동이 생긴다
// (Opus 리뷰 Important #1, 2026-08-11). 서버 두 틱 정도로 상한을 둔다.
const MAX_DT_MS = 100;

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
  const clampedDtMs = clamp(dtMs, 0, MAX_DT_MS);
  const effective = (moveSpeed / SERVER_TICK_MS) * clampedDtMs;
  const dx = move.x * effective;
  const dy = move.y * effective;

  const safeStart = resolveCircleFromWalls(pos.x, pos.y, radius, walls, arenaSize);
  let x = clamp(safeStart.x + dx, radius, arenaSize.width - radius);
  let y = clamp(safeStart.y + dy, radius, arenaSize.height - radius);

  if (circleOverlapsAnyWall(x, safeStart.y, radius, walls)) x = safeStart.x;
  if (circleOverlapsAnyWall(x, y, radius, walls)) y = safeStart.y;

  return { x, y };
}

// 오차 판정 임계값 — 작을수록 서버와 자주 미세 보정하고, 클수록(리스폰/대시/넉백 등) 슬라이딩
// 없이 즉시 순간이동한다. 원인별로 분기하지 않고 "오차 크기"만으로 판단한다(YAGNI).
const RECONCILE_IGNORE_PX = 4;
const RECONCILE_SNAP_PX = 150;
const RECONCILE_CORRECTION_RATE = 0.3;

export function reconcileSelfPosition(predicted, serverPos) {
  const dx = serverPos.x - predicted.x;
  const dy = serverPos.y - predicted.y;
  const dist = Math.hypot(dx, dy);
  if (dist < RECONCILE_IGNORE_PX) return predicted;
  if (dist >= RECONCILE_SNAP_PX) return { x: serverPos.x, y: serverPos.y };
  return {
    x: predicted.x + dx * RECONCILE_CORRECTION_RATE,
    y: predicted.y + dy * RECONCILE_CORRECTION_RATE,
  };
}

// reconcileSelfPosition은 논리 위치를 onState(20Hz) 시점에 즉시 갈아끼운다 — 그 즉시-갈아끼움을
// 화면에 그대로 그리면 60fps 렌더에서 프레임 하나짜리 순간이동으로 보인다. 그 순간이동분을
// "시각 오프셋"으로 잠깐 붙잡아 두었다가 이 함수로 매 프레임 지수감쇠시키면, 논리 위치(다음
// 예측의 기준점)는 즉시 정확한 채로 화면만 부드럽게 따라잡는다.
const OFFSET_HALF_LIFE_MS = 50;

export function decayRenderOffset(offset, dtMs) {
  const factor = 0.5 ** (dtMs / OFFSET_HALF_LIFE_MS);
  return { x: offset.x * factor, y: offset.y * factor };
}
