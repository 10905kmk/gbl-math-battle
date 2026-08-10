import assert from 'node:assert';
import {
  callGeminiWithRotation,
  requestCompatibleToolCalls,
  requestCompatibleWeaponEvaluation,
} from './aiClient.js';

const originalFetch = global.fetch;

try {
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"min":100,"max":200,"attackRange":"ranged","attackRangeDistance":700}' } }],
      }),
    };
  };
  const evaluation = await requestCompatibleWeaponEvaluation('github', 'fake-github-key', { parts: [] });
  assert.strictEqual(captured.url, 'https://models.github.ai/inference/chat/completions');
  assert.strictEqual(captured.options.headers.Authorization, 'Bearer fake-github-key');
  assert.strictEqual(captured.body.model, 'openai/gpt-4.1-mini');
  assert.deepStrictEqual(evaluation, { min: 100, max: 200, attackRange: 'ranged', attackRangeDistance: 700 });

  // 회귀 테스트: GitHub/OpenRouter 쪽도 "Return only one valid JSON object" 지시를 가끔
  // 무시하고 설명 문구를 앞뒤에 붙인다 — Gemini 쪽과 같은 파싱 보강이 여기도 필요하다.
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'Here is the JSON: {"min":10,"max":20,"attackRange":"melee","attackRangeDistance":10}' } }],
    }),
  });
  const prefixed = await requestCompatibleWeaponEvaluation('github', 'fake-github-key', { parts: [] });
  assert.deepStrictEqual(prefixed, { min: 10, max: 20, attackRange: 'melee', attackRangeDistance: 10 });

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"min":10,"max":20,"attackRange":"ranged","attackRangeDistance":300}\n\nLet me know if you need changes.' } }],
    }),
  });
  const suffixed = await requestCompatibleWeaponEvaluation('github', 'fake-github-key', { parts: [] });
  assert.deepStrictEqual(suffixed, { min: 10, max: 20, attackRange: 'ranged', attackRangeDistance: 300 });

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '```json\n{"min":10,"max":20,"attackRange":"melee","attackRangeDistance":10}\n```' } }],
    }),
  });
  const fenced = await requestCompatibleWeaponEvaluation('github', 'fake-github-key', { parts: [] });
  assert.deepStrictEqual(fenced, { min: 10, max: 20, attackRange: 'melee', attackRangeDistance: 10 });

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'this is not json at all' } }] }),
  });
  await assert.rejects(() => requestCompatibleWeaponEvaluation('github', 'fake-github-key', { parts: [] }), SyntaxError);

  global.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: {
          content: '완성했어요.',
          tool_calls: [{ function: { name: 'addPart', arguments: '{"shapeId":"triangle","x":10,"y":20}' } }],
        } }],
      }),
    };
  };
  const toolResult = await requestCompatibleToolCalls(
    'openrouter',
    'fake-openrouter-key',
    { parts: [] },
    '삼각형 추가',
    ['triangle'],
    { width: 480, height: 480 },
  );
  assert.strictEqual(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.strictEqual(captured.body.tools[0].function.parameters.type, 'object');
  assert.deepStrictEqual(toolResult.toolCalls, [{ op: 'addPart', shapeId: 'triangle', x: 10, y: 20 }]);

  const attempts = [];
  const rotated = await callGeminiWithRotation(async (apiKey, signal, provider) => {
    attempts.push({ apiKey, provider, hasSignal: Boolean(signal) });
    if (provider === 'gemini') throw Object.assign(new Error('quota'), { status: 429 });
    return provider;
  }, [
    { provider: 'gemini', apiKey: 'gemini-test-key' },
    { provider: 'github', apiKey: 'github-test-key' },
  ]);
  assert.strictEqual(rotated, 'github');
  assert.deepStrictEqual(attempts.map(({ provider }) => provider), ['gemini', 'github']);
} finally {
  global.fetch = originalFetch;
}

console.log('multi-provider AI adapters and fallback rotation: OK');
