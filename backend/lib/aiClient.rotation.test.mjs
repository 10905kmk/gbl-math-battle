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

// requestToolCalls — 함수 호출이 있는 턴은 functionResponse를 왕복으로 돌려주고, 텍스트만
// 있는(함수 호출 없는) 턴이 나오면 그걸 최종 reply로 쓴다. 1차 호출(functionCall만) ->
// 2차 호출(텍스트만)까지 실제로 2번 fetch되는지, contents가 왕복마다 올바르게 이어붙는지도
// 함께 확인한다.
{
  const origFetch = global.fetch;
  const requestBodies = [];
  let callCount = 0;
  global.fetch = async (url, opts) => {
    callCount += 1;
    requestBodies.push(JSON.parse(opts.body));
    if (callCount === 1) {
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ functionCall: { name: 'addPart', args: { shapeId: 'triangle', x: 100, y: 100 } } }] } }],
        }),
      };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '삼각형을 추가했어요.' }] } }] }) };
  };
  const result = await requestToolCalls('fake-key', { parts: [] }, '삼각형 추가해줘', ['triangle'], { width: 480, height: 480 });
  global.fetch = origFetch;
  assert.strictEqual(callCount, 2, '함수 호출 -> 텍스트로 끝나는 2턴이면 fetch도 정확히 2번이어야 함');
  assert.deepStrictEqual(result.toolCalls, [{ op: 'addPart', shapeId: 'triangle', x: 100, y: 100 }]);
  assert.strictEqual(result.reply, '삼각형을 추가했어요.');
  // 2차 요청의 contents에 1차 사용자 메시지 + 모델의 functionCall 턴 + functionResponse
  // (user 턴)가 순서대로 왕복돼서 들어갔는지 확인 — role:'function'은 Gemini REST API가
  // 거부해서(실측 확인됨) user 턴으로 보내야 한다.
  const secondContents = requestBodies[1].contents;
  assert.strictEqual(secondContents.length, 3);
  assert.strictEqual(secondContents[1].role, 'model');
  assert.ok(secondContents[1].parts[0].functionCall);
  assert.strictEqual(secondContents[2].role, 'user');
  assert.deepStrictEqual(secondContents[2].parts[0].functionResponse, { name: 'addPart', response: { status: 'ok' } });
}
console.log('requestToolCalls loops function-call turns until a text-only turn, wiring functionResponse back correctly: OK');

// 회귀 테스트: 모델이 명령 하나를 여러 턴에 걸쳐 함수 호출로 쪼개서 처리해도(예: 부품 추가 ->
// 이동을 각각 다른 턴에서 호출) 전부 모아서 toolCalls로 반환해야 한다 — 2턴 고정이 아니라
// 텍스트만 있는 턴이 나올 때까지 계속 도는지 확인.
{
  const origFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'addPart', args: { shapeId: 'triangle', x: 100, y: 100 } } }] } }] }) };
    }
    if (callCount === 2) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'movePart', args: { partId: 'p1', x: 200, y: 200 } } }] } }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '삼각형을 추가하고 옮겼어요.' }] } }] }) };
  };
  const result = await requestToolCalls('fake-key', { parts: [] }, '삼각형 추가하고 오른쪽 아래로 옮겨줘', ['triangle'], { width: 480, height: 480 });
  global.fetch = origFetch;
  assert.strictEqual(callCount, 3);
  assert.deepStrictEqual(result.toolCalls, [
    { op: 'addPart', shapeId: 'triangle', x: 100, y: 100 },
    { op: 'movePart', partId: 'p1', x: 200, y: 200 },
  ]);
  assert.strictEqual(result.reply, '삼각형을 추가하고 옮겼어요.');
}
console.log('requestToolCalls accumulates tool calls across more than two turns until a text-only turn: OK');

// 안전장치 회귀 테스트: 모델이 비정상적으로 함수 호출만 계속 반복해도(텍스트 턴이 절대 안 옴)
// 무한정 왕복하지 않고 MAX_TOOL_CALL_TURNS에서 멈춰야 한다.
{
  const origFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'removePart', args: { partId: `p${callCount}` } } }] } }] }) };
  };
  const result = await requestToolCalls('fake-key', { parts: [] }, '계속 지워줘', [], { width: 480, height: 480 });
  global.fetch = origFetch;
  assert.strictEqual(callCount, 5, '함수 호출만 계속 오면 MAX_TOOL_CALL_TURNS(5)에서 멈춰야 함');
  assert.strictEqual(result.toolCalls.length, 5);
  assert.strictEqual(
    result.reply,
    `${Array(5).fill('부품 제거').join(', ')}했어요.`,
    '텍스트 턴이 끝내 안 오면 지금까지의 toolCalls로 설명을 대체해야 함',
  );
}
console.log('requestToolCalls stops at MAX_TOOL_CALL_TURNS if the model never produces a text-only turn: OK');

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
