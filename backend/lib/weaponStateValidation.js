import { isValidShapeId } from '../../shapes/registry.js';

export const MAX_PARTS = 25;

// 클라이언트가 보낸 weaponState는 지금까지 전혀 검증 없이 캐시 키 생성(normalize)이나 AI
// 프롬프트 구성에 그대로 들어갔다 — 빈 요청 본문({}), null parts, 500개 부품 같은 입력이
// evaluateWeapon()/normalize() 안에서 곧바로 throw하고, 그 예외를 받는 fallbackDamage()도
// 검증 없이 같은 필드에 접근하다 또 throw해서 처리되지 않은 예외로 서버 프로세스 자체가
// 죽었다(Opus 리뷰 Critical #1). 두 라우트(weaponEvaluate, weaponChat) 진입점에서 공통으로
// 쓴다.
export function validateWeaponState(weaponState) {
  if (weaponState === null || typeof weaponState !== 'object') {
    return { ok: false, error: 'weaponState is required' };
  }
  if (!Array.isArray(weaponState.parts)) {
    return { ok: false, error: 'weaponState.parts must be an array' };
  }
  if (weaponState.parts.length > MAX_PARTS) {
    return { ok: false, error: `weaponState.parts must have at most ${MAX_PARTS} items` };
  }
  for (const part of weaponState.parts) {
    if (!part || typeof part !== 'object') {
      return { ok: false, error: 'each part must be an object' };
    }
    if (!isValidShapeId(part.shapeId)) {
      return { ok: false, error: `invalid shapeId: ${part.shapeId}` };
    }
    for (const field of ['x', 'y', 'rotation']) {
      if (!Number.isFinite(Number(part[field]))) {
        return { ok: false, error: `part.${field} must be a finite number` };
      }
    }
    // 크기는 scaleX/scaleY(자유 변형) 또는 예전 형식인 등비 scale로 올 수 있다 — 셋 다
    // 선택 항목으로 두되(없으면 partScale()이 1로 흡수), 값이 있다면 숫자여야 한다.
    // 예전엔 scale을 필수로 요구했는데, 이제 클라이언트는 scaleX/scaleY만 보내므로
    // 그대로 두면 모든 제작 요청이 400으로 막힌다.
    for (const field of ['scale', 'scaleX', 'scaleY']) {
      if (part[field] !== undefined && part[field] !== null && !Number.isFinite(Number(part[field]))) {
        return { ok: false, error: `part.${field} must be a finite number` };
      }
    }
  }
  return { ok: true };
}
