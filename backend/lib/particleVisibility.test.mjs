import assert from 'node:assert';
import {
  clearSkillEffects,
  drawSkillEffects,
  isEffectVisibleToViewer,
  isMineVisibleToViewer,
  isPlayerHiddenByCloak,
  isTimedVisualActive,
} from '../../frontend/src/screens/battle/skillEffects.js';

const emptyLayer = {};
assert.doesNotThrow(
  () => drawSkillEffects({}, emptyLayer, { selfId: 'me', players: {}, effects: [], mines: [], blackholes: [], pearls: [] }, 10_000),
  '빈 프레임에서도 만료 노드 정리가 예외 없이 실행되어야 함',
);
clearSkillEffects(emptyLayer);

// 실제로 한 프레임에 생성된 범위 원이 endsAt을 지난 다음 프레임에서 destroy되는지 검증한다.
class FakeCircle {
  constructor() { this.destroyed = false; }
  x() {}
  y() {}
  visible() {}
  moveToTop() {}
  scale() {}
  opacity() {}
  rotation() {}
  destroy() { this.destroyed = true; }
}
const effectLayer = { added: [], add(node) { this.added.push(node); } };
const effectRoom = {
  selfId: 'me',
  players: { me: { id: 'me', x: 100, y: 100 } },
  effects: [{ id: 'range-ring', type: 'shockwave', playerId: 'me', radius: 200, endsAt: 10_500 }],
  mines: [], blackholes: [], pearls: [],
};
drawSkillEffects({ Circle: FakeCircle }, effectLayer, effectRoom, 10_000);
assert.strictEqual(effectLayer.added.length, 1, '활성 범위 파티클 생성');
assert.strictEqual(effectLayer.added[0].destroyed, false);
drawSkillEffects({ Circle: FakeCircle }, effectLayer, effectRoom, 10_500);
assert.strictEqual(effectLayer.added[0].destroyed, true, '발동 종료 프레임에서 누적 원 파티클 제거');
clearSkillEffects(effectLayer);

assert.strictEqual(isMineVisibleToViewer({ ownerId: 'me' }, 'me'), true, '지뢰는 설치자에게 보임');
assert.strictEqual(isMineVisibleToViewer({ ownerId: 'other' }, 'me'), false, '지뢰는 상대에게 숨김');
assert.strictEqual(isEffectVisibleToViewer({ type: 'cloakSelf', ownerId: 'me' }, 'me'), true, '투명망토 안내는 사용자에게 보임');
assert.strictEqual(isEffectVisibleToViewer({ type: 'cloakSelf', ownerId: 'other' }, 'me'), false, '투명망토 안내는 상대에게 숨김');
assert.strictEqual(
  isPlayerHiddenByCloak({ id: 'other', status: { cloakUntil: 20_000 } }, 'me', 10_000),
  true,
  '투명망토 발동 중인 상대 캐릭터 전체를 숨김',
);
assert.strictEqual(
  isPlayerHiddenByCloak({ id: 'me', status: { cloakUntil: 20_000 } }, 'me', 10_000),
  false,
  '사용자 본인 화면에서는 자기 위치를 확인 가능',
);
assert.strictEqual(
  isPlayerHiddenByCloak({ id: 'other', status: { cloakUntil: 10_000 } }, 'me', 10_000),
  false,
  '발동 종료 시 상대 화면에 다시 표시',
);
assert.strictEqual(
  isEffectVisibleToViewer(
    { type: 'shield', playerId: 'other' },
    'me',
    { other: { id: 'other', status: { cloakUntil: 20_000 } } },
    10_000,
  ),
  false,
  '투명한 상대를 따라다니는 다른 파티클도 위치를 노출하지 않음',
);
assert.strictEqual(
  isEffectVisibleToViewer(
    { type: 'shockwave', playerId: 'other', x: 10, y: 10 },
    'me',
    { other: { id: 'other', status: { cloakUntil: 20_000 } } },
    10_000,
  ),
  false,
  '시전자를 따라가는 범위 효과도 투명 상태 동안 상대 화면에서 숨김',
);
assert.strictEqual(
  isEffectVisibleToViewer(
    { type: 'mineBoom', x: 10, y: 10 },
    'me',
    { other: { id: 'other', status: { cloakUntil: 20_000 } } },
    10_000,
  ),
  true,
  'playerId 없는 월드 효과는 그대로 보임',
);

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

assert.strictEqual(isTimedVisualActive({ endsAt: 10_001 }, 10_000), true, '종료 전 파티클은 표시');
assert.strictEqual(isTimedVisualActive({ endsAt: 10_000 }, 10_000), false, '종료 시각부터 파티클 제거');
assert.strictEqual(isTimedVisualActive({ endsAt: 9_999 }, 10_000), false, '만료된 서버 스냅샷도 표시하지 않음');
assert.strictEqual(isTimedVisualActive({}, 10_000), true, '구형 영구 시각 객체는 호환 유지');

console.log('only placed mines and cloak-self particles are hidden from opponents: OK');
