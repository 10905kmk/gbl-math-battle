import assert from 'node:assert';
import { registerSessionHandlers, findUnassignedParticipant } from './session.js';
import {
  checkinList,
  initCheckinIo,
  registerCheckinHandlers,
  consumeCheckinList,
  _resetForTest,
} from './checkin.js';

process.env.BOOTH_API_URL = 'https://fake-hub.test';
process.env.BOOTH_PASSWORD = 'test-pw';

// 실제 socket.io 소켓은 같은 이벤트에 여러 리스너를 등록할 수 있다(EventEmitter) —
// 이 소켓엔 registerSessionHandlers와 registerCheckinHandlers가 둘 다 'disconnect'를
// 등록하므로, 마지막 등록만 남기는 { [ev]: fn } 형태로는 세션 쪽 정리 로직이 조용히
// 덮어써진다. 이벤트당 리스너 배열을 쌓고 fire()로 전부 호출해 실제 동작을 재현한다.
const handlers = {};
function makeSocket(id) {
  handlers[id] = {};
  return {
    id,
    on: (ev, fn) => {
      handlers[id][ev] = handlers[id][ev] || [];
      handlers[id][ev].push(fn);
    },
    emit: () => {},
  };
}
function fire(id, ev, ...args) {
  (handlers[id]?.[ev] ?? []).forEach((fn) => fn(...args));
}

const emitted = [];
const targeted = [];
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: (id) => ({ emit: (ev, payload) => targeted.push([id, ev, payload]) }),
};
initCheckinIo(io);

for (const id of ['s1', 's2']) {
  const socket = makeSocket(id);
  registerSessionHandlers(io, socket);
  registerCheckinHandlers(socket);
}
for (const id of ['s1', 's2']) fire(id, 'participant:join');
fire('s1', 'admin:startSession'); // -> name, s1/s2 둘 다 name === null

function ack() {
  let called = null;
  const fn = (response) => {
    called = response;
  };
  fn.result = () => called;
  return fn;
}

// checkin:confirmAssign은 "어느 소켓이 이벤트를 보냈는지"가 아니라 cohort.participants
// 안에서 이름이 없는 첫 기기를 찾아 배정한다 — s1이 participant:join을 먼저 보냈으므로
// (등록 순서, 위 for 루프 참고) 항상 s1부터 채워지고, 그다음 s2가 채워진다. 이 결정적
// 순서에 기대어 아래 시나리오를 이어서 검증한다.

// checkin:confirmAssign — 빈 기기(s1)에 배정 성공
{
  const respond = ack();
  fire('s1', 'checkin:confirmAssign', { uid: 'uid-1', name: '26_10905김민규', profile_image: 'https://example.com/a.png' }, respond);
  assert.deepStrictEqual(respond.result(), { ok: true });
  assert.strictEqual(checkinList.length, 1);
  assert.strictEqual(checkinList[0].deviceId, 's1');
  assert.strictEqual(checkinList[0].uid, 'uid-1');

  const prefills = targeted.filter(([, ev]) => ev === 'name:prefill');
  assert.deepStrictEqual(prefills, [['s1', 'name:prefill', '26_10905김민규']]);
  console.log('checkin:confirmAssign assigns to the first unnamed device and prefills its name: OK');
}

// checkin:confirmAssign — 이미 체크인된 uid는 거부(s2는 여전히 비어 있지만 중복이라 막힘)
{
  const respond = ack();
  fire('s2', 'checkin:confirmAssign', { uid: 'uid-1', name: '중복', profile_image: null }, respond);
  assert.deepStrictEqual(respond.result(), { ok: false, reason: 'already_checked_in' });
  assert.strictEqual(checkinList.length, 1, '중복 uid는 목록에 추가되면 안 됨');
  console.log('checkin:confirmAssign rejects a duplicate uid: OK');
}

// checkin:confirmAssign — 남은 빈 기기(s2)에 배정 성공
{
  const respond = ack();
  fire('s2', 'checkin:confirmAssign', { uid: 'uid-2', name: '아무개', profile_image: null }, respond);
  assert.deepStrictEqual(respond.result(), { ok: true });
  assert.strictEqual(checkinList.length, 2);
  assert.strictEqual(checkinList[1].deviceId, 's2');
  console.log('checkin:confirmAssign assigns the next unnamed device: OK');
}

// checkin:confirmAssign — 이제 s1/s2 둘 다 배정되어 빈 기기가 없으므로 거부
{
  const respond = ack();
  fire('s1', 'checkin:confirmAssign', { uid: 'uid-3', name: '자리없음', profile_image: null }, respond);
  assert.deepStrictEqual(respond.result(), { ok: false, reason: 'no_device' });
  assert.strictEqual(checkinList.length, 2);
  console.log('checkin:confirmAssign rejects when no device is available: OK');
}

// checkin:unlink — uid-1 항목만 목록에서 제거(uid-2/s2는 남는다)
{
  fire('s1', 'checkin:unlink', 'uid-1');
  assert.strictEqual(checkinList.length, 1);
  assert.strictEqual(checkinList[0].uid, 'uid-2');
  console.log('checkin:unlink removes only the targeted entry: OK');
}

// admin:resetParticipant — s2를 초기화하면 이름도 지워지고, 연결된 체크인 항목(uid-2)도
// 같이 사라진다 — s2는 다시 findUnassignedParticipant 대상이 된다.
{
  fire('s1', 'admin:resetParticipant', 's2');
  assert.strictEqual(checkinList.length, 0, '기기 초기화 시 체크인 항목도 같이 지워져야 함');
  assert.strictEqual(findUnassignedParticipant()?.id, 's2', '초기화된 기기는 다시 배정 대상이 되어야 함');
  console.log('admin:resetParticipant cascades into checkinList cleanup: OK');
}

// disconnect — 배정된 기기(s2)의 연결이 끊기면 그 체크인 항목도 같이 정리된다
{
  fire('s1', 'checkin:confirmAssign', { uid: 'uid-4', name: '누구2', profile_image: null }, ack());
  assert.strictEqual(checkinList.length, 1);
  assert.strictEqual(checkinList[0].deviceId, 's2');

  fire('s2', 'disconnect');
  assert.strictEqual(checkinList.length, 0, 'disconnect 시 그 기기의 체크인 항목이 정리되어야 함');
  console.log('disconnect cleans up the disconnected device checkin entry: OK');
}

// consumeCheckinList — 성공한 uid만 목록에서 제거, 실패분은 남는다
{
  _resetForTest();
  checkinList.push(
    { deviceId: 'dX', uid: 'uid-ok', name: '성공', profile_image: null, assignedAt: Date.now() },
    { deviceId: 'dY', uid: 'uid-fail', name: '실패', profile_image: null, assignedAt: Date.now() },
  );

  let call = 0;
  globalThis.fetch = async (url, opts) => {
    if (url.endsWith('/api/auth/boothadmin')) {
      return { ok: true, status: 200, json: async () => ({ bid: 'M8' }) };
    }
    call += 1;
    if (call === 1) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };

  const results = await consumeCheckinList();
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results.find((r) => r.uid === 'uid-ok').status, 'ok');
  assert.strictEqual(results.find((r) => r.uid === 'uid-fail').status, 'error');
  assert.strictEqual(checkinList.length, 1, '실패한 uid만 목록에 남아야 함');
  assert.strictEqual(checkinList[0].uid, 'uid-fail');
  console.log('consumeCheckinList removes only successfully-registered uids: OK');
}

console.log('checkin.test.mjs: all scenarios OK');
