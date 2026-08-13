// admin:setDeviceNumber — 세션 시작 전 기기 관리를 쉽게 하기 위한 기기 번호 기능.
// 접속 순서대로 자동 배정되고, 관리자가 덮어쓸 수 있으며, 라운드 리셋을 거쳐도
// 유지되어야 한다(기기 자체에 대한 정보이지 라운드 정보가 아니므로).
import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';

const handlers = {};
function makeSocket(id) {
  return {
    id,
    on: (ev, fn) => {
      handlers[id] = handlers[id] || {};
      handlers[id][ev] = fn;
    },
    emit: () => {},
  };
}

const emitted = [];
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: (id) => ({ emit: () => {} }),
};

const latestParticipants = () => emitted.filter(([ev]) => ev === 'admin:participants').at(-1)?.[1] ?? [];
const entryOf = (id) => latestParticipants().find((p) => p.id === id);
const participantEmitCount = () => emitted.filter(([ev]) => ev === 'admin:participants').length;

for (const id of ['s1', 's2', 's3']) registerSessionHandlers(io, makeSocket(id));

// 접속 순서대로 1, 2, 3...이 자동 배정된다
{
  for (const id of ['s1', 's2', 's3']) handlers[id]['participant:join']();
  assert.strictEqual(entryOf('s1').deviceNumber, 1);
  assert.strictEqual(entryOf('s2').deviceNumber, 2);
  assert.strictEqual(entryOf('s3').deviceNumber, 3);
  console.log('device numbers auto-assign in join order: OK');
}

// 관리자가 번호를 덮어쓸 수 있다
{
  handlers.s1['admin:setDeviceNumber']('s3', 10);
  assert.strictEqual(entryOf('s3').deviceNumber, 10);
  console.log('admin:setDeviceNumber overwrites the number: OK');
}

// 유효하지 않은 값(정수가 아님/0 이하)은 무시된다
{
  const before = participantEmitCount();
  handlers.s1['admin:setDeviceNumber']('s1', 0);
  handlers.s1['admin:setDeviceNumber']('s1', -3);
  handlers.s1['admin:setDeviceNumber']('s1', 1.5);
  handlers.s1['admin:setDeviceNumber']('s1', '5');
  assert.strictEqual(entryOf('s1').deviceNumber, 1, '무효한 값은 반영되면 안 됨');
  assert.strictEqual(participantEmitCount(), before, '무효한 값은 브로드캐스트도 하지 않아야 함');
  console.log('admin:setDeviceNumber ignores non-positive-integer values: OK');
}

// 이미 다른 기기가 쓰는 번호는 거부된다(중복 방지)
{
  const before = participantEmitCount();
  handlers.s1['admin:setDeviceNumber']('s1', 2); // s2가 이미 2번
  assert.strictEqual(entryOf('s1').deviceNumber, 1, '중복 번호는 반영되면 안 됨');
  assert.strictEqual(entryOf('s2').deviceNumber, 2, '기존 소유자는 그대로여야 함');
  assert.strictEqual(participantEmitCount(), before, '중복 거부는 브로드캐스트하지 않아야 함');
  console.log('admin:setDeviceNumber rejects a number already in use: OK');
}

// 존재하지 않는 참가자 id는 조용히 무시된다
{
  const before = participantEmitCount();
  handlers.s1['admin:setDeviceNumber']('존재하지-않는-id', 99);
  assert.strictEqual(participantEmitCount(), before);
  console.log('admin:setDeviceNumber ignores unknown participant id: OK');
}

// 라운드 리셋(admin:startSession)을 거쳐도 기기 번호는 유지된다
{
  handlers.s1['admin:startSession']();
  assert.strictEqual(entryOf('s1').name, null, '라운드 필드는 초기화되어야 함');
  assert.strictEqual(entryOf('s1').deviceNumber, 1, '기기 번호는 라운드 리셋과 무관하게 유지되어야 함');
  assert.strictEqual(entryOf('s2').deviceNumber, 2);
  assert.strictEqual(entryOf('s3').deviceNumber, 10);
  console.log('device numbers survive admin:startSession: OK');
}

// 새로 접속하는 기기는 기존 번호와 겹치지 않는 다음 번호를 받는다
{
  registerSessionHandlers(io, makeSocket('s4'));
  handlers.s4['participant:join']();
  assert.strictEqual(entryOf('s4').deviceNumber, 4, 'nextDeviceNumber 카운터는 계속 증가해야 함(재사용 없음)');
  console.log('a newly-joined device gets the next never-reused number: OK');
}

console.log('session.deviceNumber.test.mjs: all scenarios OK');
