import assert from 'node:assert';
import { initErrorLog, logError, getErrorLog } from './errorLog.js';

// 초기엔 빈 배열
assert.deepStrictEqual(getErrorLog(), []);

// io 초기화 전에도 logError는 죽지 않아야 한다(유닛 테스트/미초기화 상태 방어)
logError('test', new Error('before init'));
assert.strictEqual(getErrorLog().length, 1);
assert.strictEqual(getErrorLog()[0].context, 'test');
assert.strictEqual(getErrorLog()[0].message, 'before init');
console.log('logError works before initErrorLog is called: OK');

// initErrorLog 이후엔 새 에러가 io.emit('admin:error', ...)로 브로드캐스트되어야 한다
const emitted = [];
initErrorLog({ emit: (ev, payload) => emitted.push([ev, payload]) });
logError('weaponChat', new Error('boom'));
assert.strictEqual(emitted.length, 1);
assert.strictEqual(emitted[0][0], 'admin:error');
assert.strictEqual(emitted[0][1].context, 'weaponChat');
assert.strictEqual(emitted[0][1].message, 'boom');
assert.ok(emitted[0][1].timestamp);
console.log('logError broadcasts admin:error after initErrorLog: OK');

// MAX_ENTRIES(20) 캡 — 최신이 앞에 오고 오래된 건 잘려나가야 한다
for (let i = 0; i < 25; i += 1) {
  logError('bulk', new Error(`err-${i}`));
}
const log = getErrorLog();
assert.strictEqual(log.length, 20, '최대 20개까지만 유지되어야 함');
assert.strictEqual(log[0].message, 'err-24', '최신 항목이 맨 앞이어야 함');
console.log('getErrorLog caps at MAX_ENTRIES and keeps newest first: OK');

// err가 Error 인스턴스가 아니어도(문자열 등) 죽지 않아야 한다
logError('weird', 'just a string');
assert.strictEqual(getErrorLog()[0].message, 'just a string');
console.log('logError tolerates non-Error values: OK');

console.log('errorLog.test.mjs: OK');
