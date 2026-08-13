// 부스 QR 체크인(checkin.js)이 쓰는 session.js의 세 헬퍼 — 별도 파일에서 검증한다
// (reopenCreate 테스트와 같은 이유: cohort는 모듈 싱글턴이라 stage를 옮기는 테스트는
// 파일을 분리해야 서로 간섭하지 않는다. node --test는 파일마다 별도 프로세스).
//
// battle 단계 가드를 검증하려면 실제로 battle 단계까지 들어가야 하는데, 그러면
// session.js가 startBattleRoom(setInterval 틱 루프)을 실제로 돌린다 — 파일 끝에서
// stopBattleRoom()으로 반드시 정리해야 프로세스가 매달리지 않는다(session.createDone.test.mjs
// 와 동일한 패턴).
import assert from 'node:assert';
import {
  registerSessionHandlers,
  findUnassignedParticipant,
  assignParticipantName,
  resetParticipant,
} from './session.js';
import { stopBattleRoom } from './battle.js';

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
const targeted = [];
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: (id) => ({ emit: (ev, payload) => targeted.push([id, ev, payload]) }),
};

const latestParticipants = () => emitted.filter(([ev]) => ev === 'admin:participants').at(-1)?.[1] ?? [];
const entryOf = (id) => latestParticipants().find((p) => p.id === id);

// participant:join을 s1 -> s2 순서로 보내므로 cohort.participants도 이 순서로 쌓인다.
// findUnassignedParticipant는 배열의 첫 매치를 반환하므로, 이후 어느 소켓 id가 먼저
// 배정되는지는 이 순서로 결정적이다(테스트 전체가 이 순서에 의존한다).
for (const id of ['s1', 's2']) registerSessionHandlers(io, makeSocket(id));
for (const id of ['s1', 's2']) handlers[id]['participant:join']();
handlers.s1['admin:startSession'](); // -> name stage, 둘 다 name === null

// findUnassignedParticipant: 이름 없는 첫 참가자(s1)를 찾는다
{
  const found = findUnassignedParticipant();
  assert.strictEqual(found?.id, 's1');
  console.log('findUnassignedParticipant finds the first nameless entry: OK');
}

// assignParticipantName: 이름을 설정하고 브로드캐스트한다
{
  const ok = assignParticipantName(io, 's1', '26_10905김민규');
  assert.strictEqual(ok, true);
  assert.strictEqual(entryOf('s1').name, '26_10905김민규');
  console.log('assignParticipantName sets name and broadcasts: OK');
}

// findUnassignedParticipant: 방금 배정된 s1은 더 이상 대상이 아니고 s2가 남는다
{
  const remaining = findUnassignedParticipant();
  assert.strictEqual(remaining?.id, 's2', '이미 이름이 배정된 s1은 더 이상 대상이 아니어야 함');
  assert.strictEqual(entryOf('s1').name, '26_10905김민규', '이전에 배정한 s1의 이름은 유지되어야 함');
  console.log('findUnassignedParticipant skips already-named devices: OK');
}

// assignParticipantName: 존재하지 않는 id는 무시하고 false 반환
{
  const ok = assignParticipantName(io, '존재하지-않는-id', '아무개');
  assert.strictEqual(ok, false);
  console.log('assignParticipantName ignores unknown id: OK');
}

// resetParticipant: name/createDone/weapon을 모두 지운다
{
  handlers.s1['create:done']({ damage: 4200, name: '창' });
  assert.strictEqual(entryOf('s1').createDone, true);

  const ok = resetParticipant(io, 's1');
  assert.strictEqual(ok, true);
  assert.strictEqual(entryOf('s1').name, null);
  assert.strictEqual(entryOf('s1').createDone, false);
  assert.strictEqual(entryOf('s1').weapon, null);
  console.log('resetParticipant clears name/createDone/weapon: OK');
}

// resetParticipant: battle 단계에서는 아무 것도 하지 않는다
{
  handlers.s1['admin:nextStage'](); // name -> learn
  handlers.s1['admin:nextStage'](); // learn -> create
  handlers.s1['create:done']({ damage: 1000, name: '창2' });
  handlers.s2['create:done']({ damage: 1000, name: '방패2' });
  handlers.s1['admin:nextStage'](); // create -> battle (startBattleRoom이 실제로 돈다)

  const before = entryOf('s1');
  const ok = resetParticipant(io, 's1');
  assert.strictEqual(ok, false, 'battle 단계에서는 초기화가 거부되어야 함');
  assert.deepStrictEqual(entryOf('s1'), before, 'battle 단계에서는 상태가 바뀌면 안 됨');
  console.log('resetParticipant is rejected during battle stage: OK');
}

stopBattleRoom();
console.log('session.checkinHelpers.test.mjs: all scenarios OK');
