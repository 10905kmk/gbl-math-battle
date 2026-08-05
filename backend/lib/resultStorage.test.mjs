import assert from 'node:assert';
import { saveParticipantResults } from './resultStorage.js';

function makeParticipant(id, overrides) {
  return {
    id,
    weapon: { name: `무기-${id}`, image: 'data:image/png;base64,AAA', stats: { attack: 10, defense: 5 }, damage: 500, parts: [] },
    ...overrides,
  };
}

// 정상 케이스: 각 참가자마다 saveFn이 올바른 필드로 호출되고, win은 winners 포함 여부로 계산됨
{
  const calls = [];
  const fakeSaveFn = async (payload) => { calls.push(payload); return { id: 'saved-' + calls.length }; };
  const participants = [makeParticipant('p1'), makeParticipant('p2')];
  const outcomes = await saveParticipantResults(participants, ['p1'], fakeSaveFn);

  assert.strictEqual(calls.length, 2, '참가자 수만큼 saveFn이 호출되어야 함');
  assert.deepStrictEqual(calls[0], {
    weapon_name: '무기-p1', weapon_image: 'data:image/png;base64,AAA',
    weapon_stats: { attack: 10, defense: 5 }, weapon_damage: 500, win: true,
  }, 'winners에 포함된 p1은 win:true, parts는 저장 대상에서 제외되어야 함');
  assert.strictEqual(calls[1].win, false, 'winners에 없는 p2는 win:false');
  assert.strictEqual(outcomes.every((o) => o.status === 'fulfilled'), true);
  console.log('saveParticipantResults maps participants to saveFn calls: OK');
}

// 실패 케이스: 일부 참가자 저장이 실패해도 전체가 throw하지 않고, 나머지는 정상 처리됨
{
  const fakeSaveFn = async (payload) => {
    if (payload.weapon_name === '무기-p1') throw new Error('insert failed');
    return { id: 'saved' };
  };
  const participants = [makeParticipant('p1'), makeParticipant('p2')];
  await assert.doesNotReject(
    () => saveParticipantResults(participants, [], fakeSaveFn),
    '일부 저장 실패가 전체를 throw하게 만들면 안 됨',
  );
}
console.log('saveParticipantResults tolerates partial failure: OK');

// 참가자가 0명이어도 안전하게 빈 배열 반환
{
  const outcomes = await saveParticipantResults([], [], async () => { throw new Error('should not be called'); });
  assert.deepStrictEqual(outcomes, []);
  console.log('saveParticipantResults with no participants: OK');
}

console.log('resultStorage.test.mjs: OK');
