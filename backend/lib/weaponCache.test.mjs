import assert from 'node:assert';
import { normalize, cacheKey, seededPick, getCached, setCached, seedCache, cacheSize } from './weaponCache.js';

// 살짝 다른(드래그 오차) 두 무기는 같은 키로 수렴해야 함
const a = { parts: [{ id: 'p1', shapeId: 'triangle', x: 101, y: 99, rotation: 2, scale: 1.01 }] };
const b = { parts: [{ id: 'p2', shapeId: 'triangle', x: 104, y: 96, rotation: 6, scale: 1.04 }] };

// normalize 자체도 직접 검증 — 10px/15도 단위로 반올림되는지
const normA = normalize(a);
assert.strictEqual(normA[0].x, 100);
assert.strictEqual(normA[0].y, 100);
assert.strictEqual(normA[0].rotation, 0);

// 음수 회전(반시계 드래그로 자연스럽게 발생)도 [0,360) 범위로 정규화되어야 함 (-30도 == 330도)
const negRotation = { parts: [{ id: 'p1', shapeId: 'triangle', x: 0, y: 0, rotation: -30, scale: 1 }] };
const posRotation = { parts: [{ id: 'p2', shapeId: 'triangle', x: 0, y: 0, rotation: 330, scale: 1 }] };
assert.strictEqual(normalize(negRotation)[0].rotation, 330);
assert.strictEqual(cacheKey(negRotation), cacheKey(posRotation), '-30도와 330도는 같은 캐시 키');

assert.strictEqual(cacheKey(a), cacheKey(b), '거의 같은 무기는 같은 캐시 키');

// 확실히 다른 무기는 다른 키
const c = { parts: [{ id: 'p3', shapeId: 'square', x: 101, y: 99, rotation: 2, scale: 1.01 }] };
assert.notStrictEqual(cacheKey(a), cacheKey(c));

// 크기 표현이 등비 scale(예전 형식)에서 scaleX/scaleY(자유 변형)로 바뀌었어도, 실제로
// 같은 크기라면 같은 키여야 한다 — 안 그러면 팀이 정해둔 few-shot 샘플(등비 scale)이
// 시딩해둔 점수가 참가자가 만든 똑같은 무기에 적용되지 않고 AI를 다시 호출하게 된다.
const legacyUniform = { parts: [{ id: 'p1', shapeId: 'square', x: 100, y: 100, rotation: 0, scale: 1.5 }] };
const explicitUniform = { parts: [{ id: 'p9', shapeId: 'square', x: 100, y: 100, rotation: 0, scaleX: 1.5, scaleY: 1.5 }] };
assert.strictEqual(cacheKey(legacyUniform), cacheKey(explicitUniform), '등비 scale과 같은 값의 scaleX/scaleY는 같은 키');

// 가로세로 비율이 다르면 눈에 보이는 무기가 다르므로 반드시 다른 키여야 한다 — 예전
// normalize는 scale 하나만 봐서 이 둘을 같은 무기로 취급했다.
const wide = { parts: [{ id: 'p1', shapeId: 'circle', x: 100, y: 100, rotation: 0, scaleX: 2.5, scaleY: 0.5 }] };
const tall = { parts: [{ id: 'p1', shapeId: 'circle', x: 100, y: 100, rotation: 0, scaleX: 0.5, scaleY: 2.5 }] };
assert.notStrictEqual(cacheKey(wide), cacheKey(tall), '가로로 넓은 타원과 세로로 긴 타원은 다른 무기');

// 크기를 아예 안 준 part도 기본 크기(1)로 수렴해야 한다(입력 경로마다 필드가 다를 수 있음).
const noScale = { parts: [{ id: 'p1', shapeId: 'star', x: 50, y: 50, rotation: 0 }] };
const oneScale = { parts: [{ id: 'p2', shapeId: 'star', x: 50, y: 50, rotation: 0, scaleX: 1, scaleY: 1 }] };
assert.strictEqual(cacheKey(noScale), cacheKey(oneScale));
console.log('cache keys treat legacy uniform scale and explicit per-axis scale consistently: OK');

// 시드 확정값은 같은 키에 항상 같은 값
const p1 = seededPick(cacheKey(a), 100, 200);
const p2 = seededPick(cacheKey(b), 100, 200);
assert.strictEqual(p1, p2);
assert.ok(p1 >= 100 && p1 <= 200);

// 캐시 get/set — 이제 값은 damage 하나가 아니라 attackRange/attackRangeDistance를 포함한 객체
const key = cacheKey(a);
assert.strictEqual(getCached(key), undefined);
setCached(key, { damage: 5000, attackRange: 'melee', attackRangeDistance: null });
assert.deepStrictEqual(getCached(key), { damage: 5000, attackRange: 'melee', attackRangeDistance: null });

// 사전 시딩 — attackRange가 melee인 샘플은 attackRangeDistance가 null로 채워져야 함
const before = cacheSize();
seedCache([{ parts: [{ id: 'x', shapeId: 'koch', x: 0, y: 0, rotation: 0, scale: 1 }], damage: 999, attackRange: 'melee' }]);
assert.strictEqual(cacheSize(), before + 1);
const seededKey = cacheKey({ parts: [{ id: 'x', shapeId: 'koch', x: 0, y: 0, rotation: 0, scale: 1 }] });
assert.deepStrictEqual(getCached(seededKey), { damage: 999, attackRange: 'melee', attackRangeDistance: null });
console.log('seedCache stores attackRange/attackRangeDistance alongside damage: OK');

// 여러 부품이 있을 때, 추가한 "순서"가 아니라 "내용"만으로 캐시 키가 결정되어야 한다
// (같은 shapeId/x/y 버킷에 rotation/scale만 다른 부품이 있을 때 정렬이 안정적이지 않으면
// 입력 순서에 따라 다른 캐시 키가 나올 수 있음 — 이건 그 회귀 방지 테스트)
const m1 = { parts: [
  { id: 'a', shapeId: 'square', x: 100, y: 100, rotation: 10, scale: 1 },
  { id: 'b', shapeId: 'square', x: 100, y: 100, rotation: 190, scale: 1 },
] };
const m2 = { parts: [
  { id: 'b', shapeId: 'square', x: 100, y: 100, rotation: 190, scale: 1 },
  { id: 'a', shapeId: 'square', x: 100, y: 100, rotation: 10, scale: 1 },
] };
assert.strictEqual(cacheKey(m1), cacheKey(m2), '부품 추가 순서와 무관하게 같은 캐시 키가 나와야 함');

// 회귀 테스트: max < min으로 뒤집혀 들어와도(나중에 실제 AI 응답이 범위를 뒤집어 줄 수 있음)
// 결과가 [min,max]를 벗어나면 안 된다 (Opus 리뷰 Important #14).
const flipped = seededPick(cacheKey(a), 200, 100);
assert.ok(flipped >= 100 && flipped <= 200, 'min/max가 뒤집혀도 결과는 정상 범위 안에 있어야 함');
assert.strictEqual(flipped, seededPick(cacheKey(a), 100, 200), '뒤집힌 인자와 정상 인자가 같은 결과를 내야 함');
console.log('seededPick tolerates flipped min/max: OK');

console.log('weaponCache.test.mjs: OK');
