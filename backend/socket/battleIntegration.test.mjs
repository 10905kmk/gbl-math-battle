import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { getBattleRoom, stopBattleRoom } from './battle.js';

const handlers = {};
function makeSocket(id) {
  return {
    id,
    on: (ev, fn) => { handlers[id] = handlers[id] || {}; handlers[id][ev] = fn; },
    emit: () => {},
  };
}
const emitted = [];
const io = { emit: (ev, payload) => emitted.push([ev, payload]), to: () => ({ emit: () => {} }) };

for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`p${i}`));
}

for (let i = 1; i <= 5; i += 1) {
  handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts: [] });
}

handlers.p1['admin:startSession'](); // -> learn
handlers.p1['admin:nextStage'](); // -> create
handlers.p1['admin:nextStage'](); // -> battle (startBattleRoom 트리거되어야 함)

const room = getBattleRoom();
assert.ok(room, 'battle room이 생성되어 있어야 함');
assert.strictEqual(Object.keys(room.players).length, 5);
assert.strictEqual(room.players.p1.hitDamage, 5, 'damage=1000 -> round(1000/200)=5');
assert.strictEqual(room.players.p5.hitDamage, 25, 'damage=5000 -> round(5000/200)=25');
assert.strictEqual(room.status, 'active');

stopBattleRoom();
console.log('battleIntegration.test.mjs: OK');
