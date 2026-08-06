import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { getBattleRoom, stopBattleRoom, startBattleRoom } from './battle.js';

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
  const parts = i === 1 ? [{ id: 'x1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }] : [];
  handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts });
}

handlers.p1['admin:startSession'](); // -> learn
handlers.p1['admin:nextStage'](); // -> create
handlers.p1['admin:nextStage'](); // -> battle (startBattleRoom 트리거되어야 함)

const room = getBattleRoom();
assert.ok(room, 'battle room이 생성되어 있어야 함');
assert.strictEqual(Object.keys(room.players).length, 5);
assert.strictEqual(room.players.p1.hitScore, 50, 'damage=1000 -> round(1000*0.05)=50');
assert.strictEqual(room.players.p5.hitScore, 250, 'damage=5000 -> round(5000*0.05)=250');
assert.strictEqual(room.status, 'active');
console.log('battle room initialized from participants: OK');

assert.deepStrictEqual(
  room.players.p1.weaponParts,
  [{ id: 'x1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }],
  'p1의 weapon.parts가 battleRoom.players.p1.weaponParts로 그대로 전달되어야 함',
);
assert.deepStrictEqual(room.players.p2.weaponParts, [], '무기 부품이 없으면 빈 배열이어야 함');
console.log('battle room carries weaponParts from participant weapon: OK');

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
  battleHandlers['battle:input']({ moveX: 1, moveY: 0, aimX: 1, aimY: 0 });
  assert.strictEqual(getBattleRoom().players.p1.input.moveX, 1);
  assert.strictEqual(getBattleRoom().players.p1.input.aimX, 1);
  battleHandlers['battle:input'](undefined);
  assert.strictEqual(getBattleRoom().players.p1.input.moveX, 0, 'undefined는 전부 0으로 취급');

  // battle:attack — 1회성 공격 요청. 페이로드 없이 emit되고 attackRequested만 세팅한다.
  assert.strictEqual(getBattleRoom().players.p1.attackRequested, false, '초기값은 false');
  battleHandlers['battle:attack']();
  assert.strictEqual(getBattleRoom().players.p1.attackRequested, true, 'battle:attack 수신 시 attackRequested가 true로 세팅됨');
  console.log('battle:attack sets attackRequested: OK');

  // 연결이 끊기면 해당 참가자는 조작 불가 상태로 처리되어야 한다(더 이상 "죽는" 개념은 없음).
  battleHandlers['disconnect']();
  assert.strictEqual(getBattleRoom().players.p1.connected, false, '연결 끊긴 참가자는 connected=false');
  console.log('disconnect marks player as not connected: OK');
}

// 라운드를 강제로 즉시 종료시켜서(제한시간을 과거로 이동) onEnd -> stage:change('result')까지
// 실제로 연쇄되는지 확인 — 이게 콜백 주입 방식(순환 import 회피)의 핵심 동작이라 직접 검증한다.
// console.warn을 라운드 종료 직전에 스파이해서, 대전 종료 시 결과 저장이 참가자 수만큼
// 실제로 시도됐는지까지 같은 블록에서 증거로 남긴다(SUPABASE_URL 미설정 -> mock 폴백 경로가
// 참가자마다 한 번씩 warn을 남기므로, warn 횟수 == 저장 시도 횟수).
{
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };

  const activeRoom = getBattleRoom();
  activeRoom.endsAt = Date.now() - 1;

  await new Promise((resolve) => setTimeout(resolve, 150)); // 다음 틱(50ms)이 지나가길 대기

  console.warn = origWarn;

  assert.strictEqual(getBattleRoom(), null, '라운드 종료 후 battleRoom은 null이어야 함(stopBattleRoom)');

  const stageChanges = emitted.filter(([ev]) => ev === 'stage:change').map(([, s]) => s);
  assert.deepStrictEqual(stageChanges, ['learn', 'create', 'battle', 'result']);

  // p1은 앞서 disconnect 처리돼서 connected=false였지만, 아무도 서로 공격하지 않아 전원 점수가
  // 0으로 동점이다 — 탈락 개념이 없으므로 연결이 끊긴 참가자도 자기 점수 그대로 판정에
  // 포함되어 전원 공동 승리 처리된다(HP 기반 시절엔 반대로 "죽었으니 패배"였다).
  assert.ok(resultsSentTo.p1, 'p1(연결 끊김 처리된 참가자)에게도 battle:result가 전달되어야 함');
  assert.strictEqual(resultsSentTo.p1[0][1].win, true, '연결이 끊겨도 점수는 유지되어 동점 공동 승리에 포함됨');
  assert.ok(resultsSentTo.p2 && resultsSentTo.p2[0][0] === 'battle:result', 'p2에게 battle:result가 전달되어야 함');
  assert.strictEqual(resultsSentTo.p2[0][1].win, true, '아무도 공격하지 않아 전원 0점 동점으로 전원 승리 처리');
  console.log('battle end -> stage change to result: OK');

  // 실제로 저장이 시도됐다는 증거 — no-op 재확인이 아니라 mock 저장 경고 횟수를 직접 센다.
  assert.strictEqual(
    warnings.filter((w) => w.includes('mock 저장')).length,
    5,
    '참가자 5명 각각에 대해 결과 저장이 시도되어야 함',
  );
  console.log('battle end triggers result storage for every participant: OK');
}

// 회귀 테스트: 대전 도중 참가자가 연결을 끊어도(session.js의 disconnect 핸들러가
// cohort.participants에서 그 참가자를 제거함) 결과 저장은 대전 시작 시점 스냅샷 기준으로
// 여전히 전원에 대해 시도되어야 한다 — 안 그러면 연결이 끊긴 참가자는 결과를 영영 잃는다
// (Opus 리뷰 Important #3).
{
  handlers.p1['admin:reset']();
  for (let i = 1; i <= 5; i += 1) {
    handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts: [] });
  }
  handlers.p1['admin:startSession'](); // -> learn
  handlers.p1['admin:nextStage'](); // -> create
  handlers.p1['admin:nextStage'](); // -> battle

  assert.ok(getBattleRoom(), '재시작된 battle room이 있어야 함');

  // session.js의 disconnect 핸들러 — cohort.participants에서 p3를 제거한다.
  handlers.p3['disconnect']();

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };

  const room2 = getBattleRoom();
  room2.endsAt = Date.now() - 1;
  await new Promise((resolve) => setTimeout(resolve, 150));

  console.warn = origWarn;

  assert.strictEqual(
    warnings.filter((w) => w.includes('mock 저장')).length,
    5,
    '대전 도중 연결이 끊긴 p3를 포함해 대전 시작 시점 참가자 5명 전원에 대해 저장이 시도되어야 함',
  );
  console.log('disconnect during battle does not lose result storage: OK');
}

// 회귀 테스트: battle.js의 onEnd 콜백이 최종 점수 스냅샷을 정확히 전달하는지 직접 확인
// (Opus 리뷰 Important I4 — 기존 통합 테스트는 저장 "시도 횟수"만 셌지, session.js로 넘어가는
// scores 값 자체가 종료 시점 점수와 정확히 일치하는지는 검증하지 않았음).
{
  let onEndArgs = null;
  startBattleRoom(io, [{ id: 'sc1', weapon: { damage: 1000 } }, { id: 'sc2', weapon: { damage: 2000 } }], {
    onEnd: (winners, scores) => { onEndArgs = { winners, scores }; },
  });
  const scoreRoom = getBattleRoom();
  scoreRoom.players.sc1.score = 42;
  scoreRoom.players.sc2.score = 7;
  scoreRoom.endsAt = Date.now() - 1;
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.ok(onEndArgs, 'onEnd이 호출되어야 함');
  assert.deepStrictEqual(onEndArgs.scores, { sc1: 42, sc2: 7 }, 'onEnd의 scores가 종료 시점 점수 스냅샷과 정확히 일치해야 함');
  assert.deepStrictEqual(onEndArgs.winners, ['sc1'], 'sc1(42점)이 sc2(7점)보다 높으므로 단독 승자');
  console.log('battle.js onEnd callback delivers accurate score snapshot: OK');
}

stopBattleRoom();
console.log('battleIntegration.test.mjs: OK');
