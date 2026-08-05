import { isValidShapeId } from '../../shapes/registry.js';

export const MAX_PARTS = 10;

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
    for (const field of ['x', 'y', 'rotation', 'scale']) {
      if (!Number.isFinite(Number(part[field]))) {
        return { ok: false, error: `part.${field} must be a finite number` };
      }
    }
  }
  return { ok: true };
}
