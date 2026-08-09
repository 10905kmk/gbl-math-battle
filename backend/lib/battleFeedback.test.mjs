import assert from 'node:assert';
import { hasLocalDamage } from '../../frontend/src/screens/battle/battleFeedback.js';

assert.strictEqual(hasLocalDamage([{ type: 'hit', targetId: 'me', damage: 5 }], 'me'), true, '일반 피격');
assert.strictEqual(hasLocalDamage([{ type: 'reflect', targetId: 'me', damage: 5 }], 'me'), true, '반사 피해');
assert.strictEqual(hasLocalDamage([{ type: 'hit', targetId: 'other', damage: 5 }], 'me'), false, '다른 사람의 피격은 내 효과 없음');
assert.strictEqual(hasLocalDamage([{ type: 'hit', targetId: 'me', damage: 0 }], 'me'), false, '피해 0은 효과 없음');
assert.strictEqual(hasLocalDamage(null, 'me'), false, '잘못된 이벤트 방어');

console.log('local damage feedback recognizes hit and reflect events only for self: OK');
