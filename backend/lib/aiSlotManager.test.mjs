import assert from 'node:assert';
import {
  AI_SLOT_CAPACITY,
  getAiSlotStatus,
  resetAiSlotsForTests,
  runInAiSlot,
} from './aiSlotManager.js';

resetAiSlotsForTests();

const releases = [];
const started = [];
const jobs = Array.from({ length: 5 }, (_, index) =>
  runInAiSlot('key-a', () => new Promise((resolve) => {
    started.push(index);
    releases[index] = resolve;
  })),
);

await new Promise((resolve) => setImmediate(resolve));
assert.strictEqual(AI_SLOT_CAPACITY, 2);
assert.deepStrictEqual(started, [0, 1], '한 키에서는 처음 두 요청만 동시에 실행');
let status = getAiSlotStatus(['key-a']);
assert.strictEqual(status.slots[0].active, 2);
assert.strictEqual(status.slots[0].queued, 3);

releases[0]('done-0');
await new Promise((resolve) => setImmediate(resolve));
assert.deepStrictEqual(started, [0, 1, 2], '첫 슬롯이 끝나면 FIFO의 다음 요청을 실행');

releases[1]('done-1');
await new Promise((resolve) => setImmediate(resolve));
assert.deepStrictEqual(started, [0, 1, 2, 3]);

releases[2]('done-2');
releases[3]('done-3');
await new Promise((resolve) => setImmediate(resolve));
assert.deepStrictEqual(started, [0, 1, 2, 3, 4]);
releases[4]('done-4');
assert.deepStrictEqual(await Promise.all(jobs), ['done-0', 'done-1', 'done-2', 'done-3', 'done-4']);
await new Promise((resolve) => setImmediate(resolve));

status = getAiSlotStatus(['key-a', 'new-key']);
assert.strictEqual(status.slots.length, 2, '새 API 키는 실행 이력이 없어도 슬롯 목록에 즉시 표시');
assert.strictEqual(status.slots[0].completed, 5);
assert.strictEqual(status.slots[0].active, 0);
assert.strictEqual(status.slots[0].queued, 0);
assert.strictEqual(status.slots[1].active, 0);

await assert.rejects(() => runInAiSlot('key-a', async () => {
  const error = new Error('quota');
  error.status = 429;
  throw error;
}), /quota/);
status = getAiSlotStatus(['key-a']);
assert.strictEqual(status.slots[0].failed, 1);
assert.strictEqual(status.slots[0].lastErrorStatus, 429);

console.log('aiSlotManager limits each key to two concurrent FIFO jobs and reports live status: OK');
