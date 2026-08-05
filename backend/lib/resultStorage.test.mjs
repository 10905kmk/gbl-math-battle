import assert from 'node:assert';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
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
  const outcomes = await saveParticipantResults(participants, ['p1'], { p1: 120, p2: 45 }, fakeSaveFn);

  assert.strictEqual(calls.length, 2, '참가자 수만큼 saveFn이 호출되어야 함');
  assert.deepStrictEqual(calls[0], {
    weapon_name: '무기-p1', weapon_image: 'data:image/png;base64,AAA',
    weapon_stats: { attack: 10, defense: 5 }, weapon_damage: 500, win: true, score: 120,
  }, 'winners에 포함된 p1은 win:true, score는 scores[p1] 값, parts는 저장 대상에서 제외되어야 함');
  assert.strictEqual(calls[1].win, false, 'winners에 없는 p2는 win:false');
  assert.strictEqual(calls[1].score, 45);
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
    () => saveParticipantResults(participants, [], {}, fakeSaveFn),
    '일부 저장 실패가 전체를 throw하게 만들면 안 됨',
  );
}
console.log('saveParticipantResults tolerates partial failure: OK');

// 참가자가 0명이어도 안전하게 빈 배열 반환
{
  const outcomes = await saveParticipantResults([], [], {}, async () => { throw new Error('should not be called'); });
  assert.deepStrictEqual(outcomes, []);
  console.log('saveParticipantResults with no participants: OK');
}

// 회귀 테스트: winners/scores가 정상 형태가 아니어도(undefined 등) map() 콜백 안에서 던지면
// 안 된다. session.js가 이 함수를 await 없이 fire-and-forget으로 호출하므로, 여기서 던지면
// Promise.allSettled로도 못 잡는 unhandled rejection이 되어 서버가 죽는다(Opus 리뷰 Important #2).
{
  const calls = [];
  const fakeSaveFn = async (payload) => { calls.push(payload); return { id: 'saved' }; };
  const outcomes = await saveParticipantResults([makeParticipant('p1')], undefined, undefined, fakeSaveFn);
  assert.strictEqual(calls[0].win, false, 'winners가 배열이 아니면 아무도 승자가 아닌 것으로 취급');
  assert.strictEqual(calls[0].score, null, 'scores가 객체가 아니면 score는 null로 취급');
  assert.strictEqual(outcomes[0].status, 'fulfilled');
}
console.log('saveParticipantResults tolerates non-array winners and missing scores: OK');

// 회귀 테스트: 저장 실패한 참가자는 로컬 fallback 파일(JSONL)에 남아야 한다 — 콘솔 로그만으로는
// 부스 운영 중 아무도 안 보고 있으면 그날 저장이 통째로 유실된 걸 나중에야 알게 됨(Important #6).
{
  const fallbackPath = path.join(process.cwd(), '.test-scratch', 'results-fallback.test.jsonl');
  await rm(fallbackPath, { force: true });

  const fakeSaveFn = async (payload) => {
    if (payload.weapon_name === '무기-p1') throw new Error('insert failed');
    return { id: 'saved' };
  };
  const participants = [makeParticipant('p1'), makeParticipant('p2')];
  await saveParticipantResults(participants, ['p2'], { p1: 10 }, fakeSaveFn, fallbackPath);

  const content = await readFile(fallbackPath, 'utf8');
  const lines = content.trim().split('\n').map((line) => JSON.parse(line));
  assert.strictEqual(lines.length, 1, '실패한 p1 하나만 fallback 파일에 기록되어야 함');
  assert.strictEqual(lines[0].weapon_name, '무기-p1');
  assert.strictEqual(lines[0].win, false);
  assert.strictEqual(lines[0].score, 10);
  assert.ok(lines[0].failed_at, 'failed_at 타임스탬프가 있어야 함');

  await rm(fallbackPath, { force: true });
  await rm(path.dirname(fallbackPath), { recursive: true, force: true });
}
console.log('saveParticipantResults writes failed saves to fallback file: OK');

console.log('resultStorage.test.mjs: OK');
