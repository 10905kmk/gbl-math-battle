import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';

const handlers = {};
function makeSocket(id) {
  // registerSessionHandlers는 등록 시점에 socket.emit('stage:change', ...)을 바로 호출한다
  // (신규 접속 동기화 기능) — 목 소켓에도 emit이 있어야 한다.
  return {
    id,
    on: (ev, fn) => { handlers[id] = handlers[id] || {}; handlers[id][ev] = fn; },
    emit: () => {},
  };
}
const emitted = [];
const io = { emit: (ev, payload) => emitted.push([ev, payload]) };

// 5개의 서로 다른 소켓을 등록
for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`s${i}`));
}

// 4명만 완료 — 아직 battle로 안 넘어가야 함
for (let i = 1; i <= 4; i += 1) {
  handlers[`s${i}`]['create:done']({ damage: 1000 * i });
}
assert.ok(!emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'), '4명만 완료 시 battle 전환 안 됨');

// 5번째 완료 — battle로 전환되어야 함
handlers['s5']['create:done']({ damage: 5000 });
assert.ok(emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'), '5명 전원 완료 시 battle 전환');

console.log('session.createDone.test.mjs: OK');
