import assert from 'node:assert';
import { markDisplayPosition } from '../../frontend/src/screens/battle/skillEffects.js';

const camera = { x: 100, y: 200 };
const viewport = { width: 800, height: 600 };

{
  const visible = markDisplayPosition({ x: 500, y: 500 }, camera, viewport);
  assert.deepStrictEqual(
    { x: visible.x, y: visible.y, offscreen: visible.offscreen },
    { x: 500, y: 500, offscreen: false },
    '화면 안의 사형선고 대상은 실제 위치에 표시',
  );
}

{
  const right = markDisplayPosition({ x: 1400, y: 500 }, camera, viewport);
  assert.strictEqual(right.offscreen, true);
  assert.strictEqual(right.x, camera.x + viewport.width - 58, '오른쪽 화면 밖 대상은 오른쪽 가장자리');
  assert.ok(right.y >= camera.y + 58 && right.y <= camera.y + viewport.height - 58);
}

{
  const upperLeft = markDisplayPosition({ x: -500, y: -500 }, camera, viewport);
  assert.strictEqual(upperLeft.offscreen, true);
  assert.ok(upperLeft.x >= camera.x + 58 && upperLeft.x <= camera.x + viewport.width - 58);
  assert.ok(upperLeft.y >= camera.y + 58 && upperLeft.y <= camera.y + viewport.height - 58);
  assert.ok(upperLeft.angle < -90, '화면 좌상단 방향 각도');
}

console.log('death-mark indicator follows offscreen target direction along viewport edge: OK');
