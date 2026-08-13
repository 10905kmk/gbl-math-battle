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
// roomName -> Set(socketId). 실제 socket.io처럼 각 소켓은 자기 id와 같은 이름의 room에
// 자동으로 속해 있다(device-id로 타겟팅하는 name:prefill이 여기 기대어 동작한다) — 그 외
// room(예: 'checkin-admin')은 socket.join()을 호출해야만 멤버가 된다.
const rooms = {};
function makeSocket(id) {
  handlers[id] = {};
  rooms[id] = rooms[id] || new Set([id]);
  return {
    id,
    on: (ev, fn) => {
      handlers[id][ev] = handlers[id][ev] || [];
      handlers[id][ev].push(fn);
    },
    emit: () => {},
    join: (room) => {
      rooms[room] = rooms[room] || new Set();
      rooms[room].add(id);
    },
  };
}
function fire(id, ev, ...args) {
  (handlers[id]?.[ev] ?? []).forEach((fn) => fn(...args));
}

const emitted = [];
const targeted = [];
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: (room) => ({
    emit: (ev, payload) => {
      for (const socketId of rooms[room] ?? []) targeted.push([socketId, ev, payload]);
    },
  }),
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

// admin:resetParticipant — s2를 초기화하면 세션 쪽 이름(findUnassignedParticipant 대상이
// 되는 것)은 리셋되지만, checkinList는 방문 기록이라 건드리지 않는다 — uid-2 항목은
// 그대로 남는다(deviceId는 참고 정보로만 남는다).
{
  const before = checkinList.length;
  fire('s1', 'admin:resetParticipant', 's2');
  assert.strictEqual(checkinList.length, before, 'checkinList는 방문 기록이라 기기 초기화로 지워지면 안 됨');
  assert.ok(checkinList.some((entry) => entry.uid === 'uid-2'), 'uid-2 체크인 항목이 그대로 남아 있어야 함');
  assert.strictEqual(findUnassignedParticipant()?.id, 's2', '초기화된 기기는 다시 배정 대상이 되어야 함(세션 상태는 리셋됨)');
  console.log('admin:resetParticipant resets session state but leaves checkinList untouched: OK');
}

// disconnect — checkinList는 방문 기록이라 소켓 연결이 끊겨도(와이파이 순단 등으로 인한
// 재연결 포함) 지워지지 않는다. 위 시나리오에서 s2가 리셋되어 다시 배정 대상이 됐으므로,
// 새 uid로 s2에 배정한 뒤 disconnect를 흉내내 그 항목이 살아남는지 확인한다.
{
  fire('s1', 'checkin:confirmAssign', { uid: 'uid-4', name: '누구2', profile_image: null }, ack());
  const before = checkinList.length;
  assert.ok(checkinList.some((entry) => entry.uid === 'uid-4' && entry.deviceId === 's2'));

  fire('s2', 'disconnect');
  assert.strictEqual(checkinList.length, before, 'disconnect 시 checkinList 항목이 지워지면 안 됨');
  assert.ok(checkinList.some((entry) => entry.uid === 'uid-4'), 'uid-4 체크인 항목이 disconnect 후에도 그대로 남아 있어야 함');
  console.log('disconnect leaves checkinList entries untouched: OK');
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

// consumeCheckinList — 순회 도중(await 사이) checkinList가 다른 이벤트로 바뀌어도, 소진
// 종료 시 그 변화를 덮어쓰지 않는다. entry A의 addUser 호출을 흉내낸 fetch mock 안에서
// "동시에 다른 소켓 이벤트가 목록을 건드린 것처럼" 동기적으로 checkinList를 직접 조작한다:
// - C를 새로 push(같은 순간 다른 관리자가 confirmAssign으로 새 참가자를 체크인한 상황)
// - B를 splice로 제거(같은 순간 다른 관리자가 unlink/disconnect로 B를 지운 상황)
// 옛 버그 코드라면 마지막에 `checkinList.length = 0; checkinList.push(...remaining)`으로
// batch 스냅샷 기준 remaining(= [B], A는 성공해서 제외)을 통째로 덮어써 C가 사라지고 B가
// 되살아난다. 고친 코드는 "성공한 uid만" 현재 checkinList에서 걷어내므로 C는 살아남고
// B는 이미 없던 대로 없다.
{
  _resetForTest();
  checkinList.push(
    { deviceId: 'dA', uid: 'uid-conc-a', name: 'A', profile_image: null, assignedAt: Date.now() },
    { deviceId: 'dB', uid: 'uid-conc-b', name: 'B', profile_image: null, assignedAt: Date.now() },
  );

  globalThis.fetch = async (url, opts) => {
    if (url.endsWith('/api/auth/boothadmin')) {
      return { ok: true, status: 200, json: async () => ({ bid: 'M8' }) };
    }
    const body = JSON.parse(opts.body);
    if (body.uid === 'uid-conc-a') {
      // A의 addUser await 도중, 실제로는 다른 소켓 이벤트 핸들러가 하는 일을
      // 동기적으로 흉내낸다 — 이 fetch 호출 자체가 그 "동시성 창"을 대표한다.
      checkinList.push({ deviceId: 'dC', uid: 'uid-conc-c', name: 'C(동시추가)', profile_image: null, assignedAt: Date.now() });
      const bIndex = checkinList.findIndex((entry) => entry.uid === 'uid-conc-b');
      if (bIndex !== -1) checkinList.splice(bIndex, 1);
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };

  const results = await consumeCheckinList();
  assert.strictEqual(results.length, 2, 'batch 스냅샷 기준으로 A/B 둘 다 처리 결과가 나와야 함');
  assert.strictEqual(results.find((r) => r.uid === 'uid-conc-a').status, 'ok');
  assert.strictEqual(results.find((r) => r.uid === 'uid-conc-b').status, 'error');

  assert.strictEqual(checkinList.length, 1, '동시 추가/제거를 반영해 정확히 C 한 건만 남아야 함');
  assert.strictEqual(checkinList[0].uid, 'uid-conc-c', '소진 도중 새로 추가된 항목(C)이 살아남아야 함');
  assert.ok(
    !checkinList.some((entry) => entry.uid === 'uid-conc-b'),
    '소진 도중 다른 곳에서 이미 제거된 항목(B)이 되살아나면 안 됨',
  );
  console.log('consumeCheckinList preserves concurrent additions and does not resurrect concurrent removals: OK');
}

// checkin:subscribe — checkin:list 브로드캐스트는 구독('checkin-admin' room에 join)한
// 소켓에만 도달해야 한다. 구독하지 않은 소켓(참가자 게임 기기를 흉내낸다)에는 실명/uid가
// 담긴 이 목록이 절대 가면 안 된다.
{
  targeted.length = 0;
  _resetForTest();

  const adminSocket = makeSocket('admin-sock');
  registerCheckinHandlers(adminSocket);
  fire('admin-sock', 'checkin:subscribe'); // 관리자 화면 — 구독함

  const playerSocket = makeSocket('player-sock');
  registerCheckinHandlers(playerSocket);
  // player-sock은 구독하지 않는다 — 참가자 게임 기기 시뮬레이션

  checkinList.push({ deviceId: 'dZ', uid: 'uid-broadcast-test', name: '구독테스트', profile_image: null, assignedAt: Date.now() });
  fire('admin-sock', 'checkin:unlink', 'uid-broadcast-test'); // removeByUid -> broadcastList()

  const listBroadcasts = targeted.filter(([, ev]) => ev === 'checkin:list');
  assert.strictEqual(listBroadcasts.length, 1, 'checkin:list 브로드캐스트는 구독한 소켓 하나에만 가야 함');
  assert.strictEqual(listBroadcasts[0][0], 'admin-sock', '구독한 소켓(admin-sock)에만 도달해야 함');
  assert.ok(
    !listBroadcasts.some(([socketId]) => socketId === 'player-sock'),
    '구독하지 않은 소켓(player-sock, 참가자 기기)에는 도달하면 안 됨',
  );
  console.log('checkin:list broadcast only reaches sockets that called checkin:subscribe: OK');
}

console.log('checkin.test.mjs: all scenarios OK');
