import assert from 'node:assert';
import { DEFAULT_MAP } from './battleMap.js';

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// arenaSize — {width, height} 양의 숫자쌍
assert.ok(isFiniteNumber(DEFAULT_MAP.arenaSize.width), 'arenaSize.width는 유한한 숫자여야 함');
assert.ok(isFiniteNumber(DEFAULT_MAP.arenaSize.height), 'arenaSize.height는 유한한 숫자여야 함');
assert.ok(DEFAULT_MAP.arenaSize.width > 0 && DEFAULT_MAP.arenaSize.height > 0, 'arenaSize는 양수여야 함');
console.log('DEFAULT_MAP.arenaSize shape: OK');

// imagePath — 문자열
assert.strictEqual(typeof DEFAULT_MAP.imagePath, 'string', 'imagePath는 문자열이어야 함');
console.log('DEFAULT_MAP.imagePath shape: OK');

// walls — {x, y, width, height} 객체 배열
assert.ok(Array.isArray(DEFAULT_MAP.walls), 'walls는 배열이어야 함');
DEFAULT_MAP.walls.forEach((w, i) => {
  assert.ok(isFiniteNumber(w.x), `walls[${i}].x는 유한한 숫자여야 함`);
  assert.ok(isFiniteNumber(w.y), `walls[${i}].y는 유한한 숫자여야 함`);
  assert.ok(isFiniteNumber(w.width) && w.width > 0, `walls[${i}].width는 양의 숫자여야 함`);
  assert.ok(isFiniteNumber(w.height) && w.height > 0, `walls[${i}].height는 양의 숫자여야 함`);
});
console.log('DEFAULT_MAP.walls shape: OK');

// spawnPoints — {x, y} 객체 배열, 최소 1개 이상
assert.ok(Array.isArray(DEFAULT_MAP.spawnPoints), 'spawnPoints는 배열이어야 함');
assert.ok(DEFAULT_MAP.spawnPoints.length > 0, 'spawnPoints는 최소 1개 이상이어야 함');
DEFAULT_MAP.spawnPoints.forEach((p, i) => {
  assert.ok(isFiniteNumber(p.x), `spawnPoints[${i}].x는 유한한 숫자여야 함`);
  assert.ok(isFiniteNumber(p.y), `spawnPoints[${i}].y는 유한한 숫자여야 함`);
});
console.log('DEFAULT_MAP.spawnPoints shape: OK');

console.log('battleMap.test.mjs: OK');
