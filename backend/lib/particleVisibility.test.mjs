import assert from 'node:assert';
import {
  isEffectVisibleToViewer,
  isMineVisibleToViewer,
} from '../../frontend/src/screens/battle/skillEffects.js';

assert.strictEqual(isMineVisibleToViewer({ ownerId: 'me' }, 'me'), true, '지뢰는 설치자에게 보임');
assert.strictEqual(isMineVisibleToViewer({ ownerId: 'other' }, 'me'), false, '지뢰는 상대에게 숨김');
assert.strictEqual(isEffectVisibleToViewer({ type: 'cloakSelf', ownerId: 'me' }, 'me'), true, '투명망토 안내는 사용자에게 보임');
assert.strictEqual(isEffectVisibleToViewer({ type: 'cloakSelf', ownerId: 'other' }, 'me'), false, '투명망토 안내는 상대에게 숨김');

const publicEffects = [
  'heal', 'shield', 'reflectAura', 'reflect', 'speedUp', 'lastStand',
  'poisonArm', 'poisoned', 'mark', 'shockwave', 'slowHell', 'timeStop',
  'cone', 'dash', 'blinkJump', 'recallJump', 'pullLine', 'recallMark',
  'mineBoom', 'frozenIce',
];
for (const type of publicEffects) {
  assert.strictEqual(isEffectVisibleToViewer({ type, ownerId: 'other' }, 'me'), true, `${type}는 본인·상대 모두에게 보임`);
}

// 추후 효과에 ownerOnly 값을 실수로 넣어도 cloakSelf가 아니면 공용으로 유지한다.
assert.strictEqual(isEffectVisibleToViewer({ type: 'futureEffect', ownerId: 'other', ownerOnly: true }, 'me'), true);

console.log('only placed mines and cloak-self particles are hidden from opponents: OK');
