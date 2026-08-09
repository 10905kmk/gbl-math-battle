import assert from 'node:assert';
import { callGeminiWithRotation, requestWeaponEvaluation, requestToolCalls } from './aiClient.js';

// callGeminiWithRotation — 429면 다음 키로 재시도, 그 외 에러는 즉시 던짐. 실제 fetch 없이
// pool/requestFn을 직접 주입해서 로테이션 로직만 검증한다(DI 패턴 —
// shapes/weaponRenderer.js의 drawWeaponGroup(Konva, ...)와 같은 이유).
{
  const calls = [];
  const requestFn = async (key) => {
    calls.push(key);
    if (key === 'bad-key') {
      const err = new Error('rate limited');
      err.status = 429;
      throw err;
    }
    return `ok-from-${key}`;
  };
  const result = await callGeminiWithRotation(requestFn, ['bad-key', 'good-key']);
  assert.strictEqual(result, 'ok-from-good-key');
  assert.deepStrictEqual(calls, ['bad-key', 'good-key']);
}
console.log('callGeminiWithRotation retries the next key on 429: OK');

// 회귀 테스트: 503("high demand" 일시적 과부하)도 429와 같이 다음 키로 재시도해야 한다 —
// 실제 라이브 호출에서 4개 중 2개가 503으로 통째로 실패하는 걸 확인한 뒤 추가함.
{
  const calls = [];
  const requestFn = async (key) => {
    calls.push(key);
    if (key === 'overloaded-key') {
      const err = new Error('model overloaded');
      err.status = 503;
      throw err;
    }
    return `ok-from-${key}`;
  };
  const result = await callGeminiWithRotation(requestFn, ['overloaded-key', 'good-key']);
  assert.strictEqual(result, 'ok-from-good-key');
  assert.deepStrictEqual(calls, ['overloaded-key', 'good-key']);
}
console.log('callGeminiWithRotation retries the next key on 503: OK');

{
  const requestFn = async () => {
    const err = new Error('bad request');
    err.status = 400;
    throw err;
  };
  await assert.rejects(() => callGeminiWithRotation(requestFn, ['only-key']), /bad request/);
}
console.log('callGeminiWithRotation propagates non-429 errors immediately: OK');

{
  await assert.rejects(
    () => callGeminiWithRotation(async () => 'unused', []),
    /gemini API 키가 없습니다/,
  );
}
console.log('callGeminiWithRotation throws a clear error when the key pool is empty: OK');

// requestWeaponEvaluation — 실제 네트워크 없이 global.fetch를 모킹해서 응답 파싱만 검증.
{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: JSON.stringify({ min: 100, max: 900, attackRange: 'ranged', attackRangeDistance: 400 }) }] },
      }],
    }),
  });
  const result = await requestWeaponEvaluation('fake-key', { parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] });
  global.fetch = origFetch;
  assert.deepStrictEqual(result, { min: 100, max: 900, attackRange: 'ranged', attackRangeDistance: 400 });
}
console.log('requestWeaponEvaluation parses a well-formed Gemini response: OK');

{
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => requestWeaponEvaluation('fake-key', { parts: [] }), (err) => err.status === 429);
  global.fetch = origFetch;
}
console.log('requestWeaponEvaluation attaches the HTTP status to the thrown error: OK');

{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ min: 'not-a-number', max: 900, attackRange: 'melee', attackRangeDistance: 150 }) }] } }] }),
  });
  await assert.rejects(() => requestWeaponEvaluation('fake-key', { parts: [] }), /min\/max/);
  global.fetch = origFetch;
}
console.log('requestWeaponEvaluation rejects a non-numeric min/max response: OK');

// 방어: attackRange가 'melee'/'ranged'가 아닌 이상한 값이면 조용히 'melee'로, attackRangeDistance가
// 숫자가 아니면 RANGE_DISTANCE_MIN으로 대체한다(min/max와 달리 안전한 기본값이 있으므로 던지지 않음).
{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ min: 100, max: 900, attackRange: 'weird', attackRangeDistance: 'huge' }) }] } }],
    }),
  });
  const result = await requestWeaponEvaluation('fake-key', { parts: [] });
  global.fetch = origFetch;
  assert.strictEqual(result.attackRange, 'melee', "알 수 없는 attackRange 값은 'melee'로 대체");
  assert.strictEqual(result.attackRangeDistance, 150, '숫자가 아닌 attackRangeDistance는 RANGE_DISTANCE_MIN으로 대체');
}
console.log('requestWeaponEvaluation defends against malformed attackRange/attackRangeDistance: OK');

// requestToolCalls — 복합 명령의 모든 함수 호출과 설명을 한 번의 응답으로 받는다.
{
  const origFetch = global.fetch;
  const requestBodies = [];
  global.fetch = async (url, opts) => {
    requestBodies.push(JSON.parse(opts.body));
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [
        { functionCall: { name: 'addPart', args: { shapeId: 'triangle', x: 100, y: 100 } } },
        { functionCall: { name: 'addPart', args: { shapeId: 'bar', x: 100, y: 220 } } },
        { text: '삼각형과 막대를 추가했어요.' },
      ] } }] }),
    };
  };
  const result = await requestToolCalls('fake-key', { parts: [] }, '창을 만들어줘', ['triangle', 'bar'], { width: 480, height: 480 });
  global.fetch = origFetch;
  assert.strictEqual(requestBodies.length, 1, '복합 명령도 Gemini를 한 번만 호출해야 함');
  assert.deepStrictEqual(result.toolCalls, [
    { op: 'addPart', shapeId: 'triangle', x: 100, y: 100 },
    { op: 'addPart', shapeId: 'bar', x: 100, y: 220 },
  ]);
  assert.strictEqual(result.reply, '삼각형과 막대를 추가했어요.');
}
console.log('requestToolCalls returns all operations and text from one Gemini call: OK');

{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [] } }] }),
  });
  const result = await requestToolCalls('fake-key', { parts: [] }, '아무 말', [], { width: 480, height: 480 });
  global.fetch = origFetch;
  assert.deepStrictEqual(result.toolCalls, []);
  assert.strictEqual(result.reply, '(응답 텍스트가 없어요)', '텍스트 파트도 toolCalls도 전혀 없으면 기본 안내 문구로 대체되어야 함');
}
console.log('requestToolCalls falls back to a placeholder reply when Gemini returns no text: OK');

console.log('aiClient.rotation.test.mjs: OK');
