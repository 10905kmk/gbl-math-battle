import assert from 'node:assert';

process.env.MOCK_AI = 'true';
const { interpretCommand } = await import('./aiClient.js');

const weapon = { parts: [] };
const result = await interpretCommand({
  weaponState: weapon,
  message: '삼각형 하나 추가해줘',
  availableShapeIds: ['triangle', 'square', 'sierpinski', 'koch'],
  canvasSize: { width: 480, height: 480 },
});

assert.ok(Array.isArray(result.toolCalls));
assert.ok(result.toolCalls.length > 0);
assert.strictEqual(result.toolCalls[0].op, 'addPart');
assert.strictEqual(typeof result.reply, 'string');

console.log('aiClient.chat.test.mjs: OK');
