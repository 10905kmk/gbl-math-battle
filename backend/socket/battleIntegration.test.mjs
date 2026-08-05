import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { getBattleRoom, stopBattleRoom } from './battle.js';

const handlers = {};
const emitted = [];
const resultsSentTo = {};

function makeSocket(id) {
  return {
    id,
    on: (ev, fn) => { handlers[id] = handlers[id] || {}; handlers[id][ev] = fn; },
    emit: () => {},
  };
}
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: (id) => ({
    emit: (ev, payload) => {
      resultsSentTo[id] = resultsSentTo[id] || [];
      resultsSentTo[id].push([ev, payload]);
    },
  }),
};

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
console.log('battle room initialized from participants: OK');

// battle:input 핸들러가 등록돼 있는지 확인 (registerBattleHandlers는 registerSessionHandlers와
// 별개로 server.js가 호출하지만, 여기선 핸들러 자체를 직접 불러서 크래시 여부만 검증)
{
  const { registerBattleHandlers } = await import('./battle.js');
  const battleHandlers = {};
  const testSocket = { id: 'p1', on: (ev, fn) => { battleHandlers[ev] = fn; } };
  registerBattleHandlers(io, testSocket);

  // 빈 payload/undefined/null이 와도 크래시하지 않아야 함
  assert.doesNotThrow(() => battleHandlers['battle:input'](undefined), 'input이 undefined');
  assert.doesNotThrow(() => battleHandlers['battle:input'](null), 'input이 null');
  assert.doesNotThrow(() => battleHandlers['battle:input']({}), 'input이 빈 객체');
  console.log('battle:input tolerates malformed payload: OK');

  // 정상 입력은 실제로 반영되는지도 같이 확인
  battleHandlers['battle:input']({ right: true });
  assert.strictEqual(getBattleRoom().players.p1.input.right, true);
  battleHandlers['battle:input'](undefined);
  assert.strictEqual(getBattleRoom().players.p1.input.right, false, 'undefined는 전부 false로 취급');

  // 연결이 끊기면 해당 참가자는 죽은 것으로 처리되어야 함(무적 유령 방지)
  battleHandlers['disconnect']();
  assert.strictEqual(getBattleRoom().players.p1.alive, false, '연결 끊긴 참가자는 alive=false');
  console.log('disconnect marks player as not alive: OK');
}

// 라운드를 강제로 즉시 종료시켜서(제한시간을 과거로 이동) onEnd -> stage:change('result')까지
// 실제로 연쇄되는지 확인 — 이게 콜백 주입 방식(순환 import 회피)의 핵심 동작이라 직접 검증한다.
{
  const activeRoom = getBattleRoom();
  activeRoom.endsAt = Date.now() - 1;

  await new Promise((resolve) => setTimeout(resolve, 150)); // 다음 틱(50ms)이 지나가길 대기

  assert.strictEqual(getBattleRoom(), null, '라운드 종료 후 battleRoom은 null이어야 함(stopBattleRoom)');

  const stageChanges = emitted.filter(([ev]) => ev === 'stage:change').map(([, s]) => s);
  assert.deepStrictEqual(stageChanges, ['learn', 'create', 'battle', 'result']);

  // p1은 앞서 disconnect 처리돼서 alive=false였지만, 그래도 결과 통지 대상에는 포함되어야 한다
  // (io.to(id).emit은 room.players 전체를 순회하지, 생존자만 순회하지 않으므로).
  assert.ok(resultsSentTo.p1, 'p1(연결 끊김 처리된 참가자)에게도 battle:result가 전달되어야 함');
  assert.strictEqual(resultsSentTo.p1[0][1].win, false, '죽은 p1은 패배 처리');
  assert.ok(resultsSentTo.p2 && resultsSentTo.p2[0][0] === 'battle:result', 'p2에게 battle:result가 전달되어야 함');
  assert.strictEqual(resultsSentTo.p2[0][1].win, true, '생존자 4명은 동점으로 전원 승리 처리');
  console.log('battle end -> stage change to result: OK');
}

stopBattleRoom();
console.log('battleIntegration.test.mjs: OK');
