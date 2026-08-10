import assert from 'node:assert';
import { fallbackDamage, fallbackAttackRange, resolveAttackRangeSelection } from './weaponEvaluate.js';

const weapon = { parts: [{ id: 'p1', shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] };
const damage = fallbackDamage(weapon);
assert.ok(damage >= 1 && damage <= 10000, 'fallback damage must stay in [1, 10000]');
assert.strictEqual(typeof damage, 'number');

// 회귀 테스트: Opus 리뷰 Critical #1 — fallbackDamage가 evaluateWeapon 실패 시 catch 블록
// 안에서 다시 호출되는데, 예전엔 weaponState.parts에 바로 접근해서 undefined/null 입력에
// 또 throw했다(=서버 죽음, 이중 실패). 이제는 절대 던지지 않고 안전한 기본값을 반환해야 한다.
assert.strictEqual(fallbackDamage(undefined), 1, 'weaponState 자체가 undefined');
assert.strictEqual(fallbackDamage(null), 1, 'weaponState가 null');
assert.strictEqual(fallbackDamage({}), 1, 'parts 필드가 없음');
assert.strictEqual(fallbackDamage({ parts: null }), 1, 'parts가 null');
assert.strictEqual(fallbackDamage({ parts: [] }), 1, 'parts가 빈 배열');
assert.strictEqual(
  fallbackDamage({ parts: [{ shapeId: 'not-a-shape', x: 0, y: 0, rotation: 0, scale: 1 }] }),
  1,
  '존재하지 않는 shapeId는 기여분 없이 스킵',
);
assert.strictEqual(
  fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 'huge' }] }),
  fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] }),
  'scale이 숫자가 아니면 1로 취급(NaN 전파 방지)',
);
console.log('fallbackDamage never throws on malformed input: OK');

// 회귀 테스트: Opus 리뷰 Critical #2 — 자유 변형(scaleX/scaleY) 도입 후 클라이언트는 더
// 이상 옛 단일 scale 필드를 보내지 않는데, fallbackDamage가 여전히 scale만 읽고 있어서
// 부품을 아무리 키워도 폴백 데미지가 전혀 안 오르는 문제가 있었다. partScale()을 통해야
// 크기가 반영된다.
{
  const small = fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scaleX: 0.5, scaleY: 0.5 }] });
  const large = fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scaleX: 3, scaleY: 3 }] });
  assert.ok(large > small, 'scaleX/scaleY로 부품을 키우면 폴백 데미지도 커져야 함');

  // 옛 등비 scale 필드도 여전히 하위 호환으로 동작해야 한다(few-shot 샘플 등).
  const legacyLarge = fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 3 }] });
  assert.strictEqual(
    legacyLarge,
    fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scaleX: 3, scaleY: 3 }] }),
    '옛 등비 scale=3은 scaleX=scaleY=3과 같은 결과를 내야 함',
  );

  // 한쪽만 늘려도(길쭉하게) 반영되어야 한다 — sx*sy(면적) 기준.
  const stretched = fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scaleX: 4, scaleY: 1 }] });
  const baseline = fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }] });
  assert.ok(stretched > baseline, '한쪽 축만 늘려도(scaleX=4) 폴백 데미지가 커져야 함');
  console.log('fallbackDamage honors scaleX/scaleY (Opus 리뷰 Critical #2): OK');
}

// 회귀 테스트: Opus 리뷰 Important #4 — 예전엔 total*100이라 부품 5개부터 전부 10000으로
// 포화됐다(1개=2000, 5개 이상=전부 10000). sqrt 스케일로 바꿔서 부품 수가 늘어도
// 점수가 계속 구별돼야 한다.
function weaponWithParts(n) {
  return { parts: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 })) };
}
const damage1 = fallbackDamage(weaponWithParts(1));
const damage5 = fallbackDamage(weaponWithParts(5));
const damage10 = fallbackDamage(weaponWithParts(10));
assert.ok(damage1 < damage5, '부품이 많을수록 점수가 더 높아야 함(1개 < 5개)');
assert.ok(damage5 < damage10, '5개 < 10개 — 예전엔 5개부터 이미 최댓값이라 여기서 실패했음');
assert.ok(damage10 <= 10000);
console.log('fallbackDamage no longer saturates by 5 parts: OK');

assert.deepStrictEqual(
  resolveAttackRangeSelection('melee', 'ranged', 500),
  { attackRange: 'melee', attackRangeDistance: null },
  '사용자가 고른 근접 모드는 AI의 원거리 판정보다 우선해야 함',
);
assert.deepStrictEqual(
  resolveAttackRangeSelection('ranged', 'melee', null),
  { attackRange: 'ranged', attackRangeDistance: 150 },
  '사용자가 고른 원거리 모드는 AI의 근접 판정보다 우선하고 최소 사거리를 가져야 함',
);
assert.deepStrictEqual(
  resolveAttackRangeSelection(undefined, 'ranged', 9999),
  { attackRange: 'ranged', attackRangeDistance: 600 },
  '구버전 요청은 AI 판정을 유지하고 사거리를 안전하게 제한해야 함',
);

// fallbackAttackRange — 크래시 없이 항상 melee/ranged 중 하나를 반환
{
  const result = fallbackAttackRange(undefined);
  assert.strictEqual(result.attackRange, 'melee', 'weaponState가 undefined면 안전하게 근접');
  console.log('fallbackAttackRange tolerates undefined weaponState: OK');
}
{
  // 길쭉하게 뻗은 부품 배치 -> 원거리로 분류돼야 함
  const elongated = {
    parts: [
      { id: 'a', shapeId: 'square', x: 100, y: 100, rotation: 0, scale: 0.3 },
      { id: 'b', shapeId: 'square', x: 100, y: 400, rotation: 0, scale: 0.3 },
    ],
  };
  const result = fallbackAttackRange(elongated);
  assert.strictEqual(result.attackRange, 'ranged');
  assert.ok(result.attackRangeDistance >= 150 && result.attackRangeDistance <= 600);
  console.log('fallbackAttackRange classifies elongated weapons as ranged: OK');
}

console.log('weaponEvaluate.test.mjs: OK');
