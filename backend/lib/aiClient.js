// backend/lib/aiClient.js — Gemini 연동: 무기 채팅 해석 + 무기 채점
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';
import { getAllApiCredentials } from './apiKeys.js';
import { runInAiSlot } from './aiSlotManager.js';
import { RANGE_DISTANCE_MIN, RANGE_DISTANCE_MAX, classifyWeaponRangeFallback } from '../../shapes/attackGeometry.js';
import { computeWeaponBounds } from '../../shapes/weaponRenderer.js';
import { getShapeById, partScale, SCALE_MIN, SCALE_MAX } from '../../shapes/registry.js';

export const DAMAGE_MIN = 1;
export const DAMAGE_MAX = 10000;
// 'gemini-2.0-flash'는 무료 티어 할당량이 0으로 막혀 있는 계정이 있어(429 RESOURCE_EXHAUSTED,
// limit: 0) 'gemini-flash-latest'로 바꿈 — 실제 키로 라이브 검증 중 발견, 두 모델 다 같은
// generateContent 엔드포인트/요청 형식을 쓰므로 다른 코드는 안 바뀐다.
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_COMPATIBLE_PROVIDERS = {
  github: {
    endpoint: 'https://models.github.ai/inference/chat/completions',
    model: process.env.GITHUB_MODELS_MODEL || 'openai/gpt-4.1-mini',
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini',
  },
};
// 전체 요청 시간은 키 개수에 따라 정한다. 각 키는 아래 시간까지만 기다린 뒤 다음 키로 넘어간다.
export const AI_REQUEST_TIMEOUT_MS = null;
export const AI_ATTEMPT_TIMEOUT_MS = 10_000;

seedCache(SAMPLES);

let keyIndex = 0;
function nextKey(pool) {
  const key = pool[keyIndex % pool.length];
  keyIndex += 1;
  return key;
}

// 키 풀을 순환하며 요청. 429(rate limit) 또는 503(일시적 과부하, "high demand" — 실제
// 라이브 호출에서 실측됨)이면 다음 키로 재시도, 그 외 에러는 즉시 던짐. 503은 특정 키의
// 문제가 아니라 모델 자체의 일시적 과부하라 같은 키로 재시도해도 될 수 있지만, 이미 있는
// "다음 키로 재시도" 경로를 그대로 재사용하는 쪽이 새 백오프 로직을 따로 만드는 것보다
// 간단하고, 결과적으로 몇 번의 재시도 기회를 준다는 점은 동일하다.
// pool은 기본으로 apiKeys.json의 gemini 키 배열을 쓰지만, 파라미터로 받을 수 있게 해서
// 테스트가 실제 키 파일 없이도 가짜 키 배열을 주입해 로테이션 로직만 따로 검증할 수 있다
// (shapes/weaponRenderer.js의 drawWeaponGroup(Konva, ...)와 같은 이유의 의존성 주입).
export async function callGeminiWithRotation(
  requestFn,
  pool = getAllApiCredentials(),
  { requestTimeoutMs = AI_REQUEST_TIMEOUT_MS, attemptTimeoutMs = AI_ATTEMPT_TIMEOUT_MS } = {},
) {
  if (pool.length === 0) {
    throw new Error('gemini API 키가 없습니다 — backend/config/apiKeys.json의 "gemini" 배열을 채워주세요');
  }
  // 한 키가 응답하지 않는 경우에도 다음 키를 실제로 시도하되, 전체 대기시간은 제한한다.
  // 키 개수만큼 10초가 계속 늘어나지 않도록 deadline을 공유한다.
  // requestTimeoutMs를 명시한 테스트/호출만 전체 제한을 둔다. 기본 동작은 등록된 키를
  // 하나도 건너뛰지 않고 각 키를 최대 attemptTimeoutMs 동안 순서대로 시도한다.
  const deadline = Number.isFinite(requestTimeoutMs) ? Date.now() + requestTimeoutMs : Infinity;
  let lastError;
  let attempted = 0;
  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const rawCredential = nextKey(pool);
    const credential = typeof rawCredential === 'string'
      ? { provider: 'gemini', apiKey: rawCredential }
      : rawCredential;
    attempted += 1;
    try {
      return await runInAiSlot(credential, () => {
        const executionRemainingMs = deadline - Date.now();
        if (executionRemainingMs <= 0) {
          const timeoutError = new Error('AI request deadline exceeded while queued');
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }
        const signal = AbortSignal.timeout(Math.max(1, Math.min(attemptTimeoutMs, executionRemainingMs)));
        return requestFn(credential.apiKey, signal, credential.provider);
      });
    } catch (err) {
      lastError = err;
      // HTTP 상태(400/401/403/429/5xx), 시간 초과, 네트워크 오류, JSON/응답 형식 오류를
      // 구분하지 않고 다음 키로 넘긴다. 참가자 화면에는 모든 키가 실패한 뒤에만 오류가 간다.
    }
  }
  if (lastError && typeof lastError === 'object') lastError.attemptedApiKeys = attempted;
  throw lastError;
}

function summarizeParts(parts) {
  return parts
    .map((p) => {
      const { sx, sy } = partScale(p);
      // 가로/세로가 같으면 굳이 두 값을 다 적지 않는다 — few-shot 예시가 짧을수록 모델이
      // 형식을 헷갈리지 않고, 등비 샘플과 자유 변형 무기를 같은 문장 형식으로 비교하게 된다.
      const scaleText = sx === sy ? `scale:${sx}` : `scaleX:${sx},scaleY:${sy}`;
      return `${p.shapeId}(x:${p.x},y:${p.y},rotation:${p.rotation},${scaleText})`;
    })
    .join(', ');
}

function buildEvaluationPrompt(weaponState) {
  const examples = SAMPLES.map(
    (s) => `- ${summarizeParts(s.parts)} → 데미지 ${s.damage}, ${s.attackRange === 'ranged' ? '원거리' : '근접'} (${s.note})`,
  ).join('\n');
  return [
    '너는 수학 도형으로 만든 무기의 전투력을 채점하는 심판이다.',
    `데미지는 ${DAMAGE_MIN}~${DAMAGE_MAX} 범위의 정수다. 아래는 참고용 예시다:`,
    examples,
    '',
    `채점할 무기: ${summarizeParts(weaponState.parts)}`,
    '',
    '절대값이 아니라 (min, max) 범위로 답하라. max - min은 1000 이내로 좁게 잡아라.',
    '',
    'attackRange 판단 기준은 "모양이 길쭉한가"가 아니라 "손에서 놓고 날아가는 무기인가"다:',
    '- ranged: 화살/총알처럼 발사되거나, 표창/부메랑/다트처럼 던져서(투척) 날아가는 무기.',
    '  뭉툭하고 안 길쭉한 모양이어도(예: 작은 도형 여러 개를 모아 만든 표창 모양) 던지는',
    '  용도로 보이면 ranged로 판단하라 — 모양의 길쭉함이 기준이 아니다.',
    '- melee: 검/방패/도끼처럼, 또는 창처럼 길더라도 손에서 놓지 않고 직접 부딪혀 싸우는 무기.',
    `"ranged"라면 사거리(attackRangeDistance)도 ${RANGE_DISTANCE_MIN}~${RANGE_DISTANCE_MAX} 범위의`,
    '정수로 함께 판단하라(짧은 사거리 무기처럼 보이면 낮은 값, 긴 사거리 무기처럼 보이면 높은',
    `값). "melee"라면 attackRangeDistance는 ${RANGE_DISTANCE_MIN}으로 고정해서 답하라.`,
  ].join('\n');
}

// 완성된 무기 하나를 Gemini에게 채점받아 데미지 범위(min,max)와 근접/원거리 판정을 받아온다.
export async function requestWeaponEvaluation(apiKey, weaponState, signal) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildEvaluationPrompt(weaponState) }] }],
      generationConfig: {
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            min: { type: 'INTEGER' },
            max: { type: 'INTEGER' },
            attackRange: { type: 'STRING', enum: ['melee', 'ranged'] },
            attackRangeDistance: { type: 'INTEGER' },
          },
          required: ['min', 'max', 'attackRange', 'attackRangeDistance'],
        },
      },
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini weapon evaluation request failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);
  if (!Number.isFinite(parsed.min) || !Number.isFinite(parsed.max)) {
    throw new Error('Gemini weapon evaluation response missing numeric min/max');
  }
  // attackRange/attackRangeDistance는 min/max와 달리 안전한 기본값이 있으므로(멀쩡한 데미지
  // 평가 자체를 무효화할 정도는 아님), 이상한 값이 와도 던지지 않고 조용히 대체한다.
  const attackRange = parsed.attackRange === 'ranged' ? 'ranged' : 'melee';
  const attackRangeDistance = Number.isFinite(parsed.attackRangeDistance) ? parsed.attackRangeDistance : RANGE_DISTANCE_MIN;
  return { min: parsed.min, max: parsed.max, attackRange, attackRangeDistance };
}

function stripJsonFence(text) {
  return String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function compatibleHeaders(provider, apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'github') {
    headers.Accept = 'application/vnd.github+json';
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  }
  return headers;
}

async function callOpenAiCompatible(provider, apiKey, body, signal) {
  const config = OPENAI_COMPATIBLE_PROVIDERS[provider];
  if (!config) throw new Error(`unsupported AI provider: ${provider}`);
  const res = await fetch(config.endpoint, {
    method: 'POST',
    signal,
    headers: compatibleHeaders(provider, apiKey),
    body: JSON.stringify({ model: config.model, ...body }),
  });
  if (!res.ok) {
    const err = new Error(`${provider} AI request failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function requestCompatibleWeaponEvaluation(provider, apiKey, weaponState, signal) {
  const data = await callOpenAiCompatible(provider, apiKey, {
    messages: [
      { role: 'system', content: 'Return only one valid JSON object. Do not use markdown.' },
      { role: 'user', content: `${buildEvaluationPrompt(weaponState)}\n\nJSON keys: min, max, attackRange, attackRangeDistance` },
    ],
    temperature: 0.2,
    max_tokens: 256,
  }, signal);
  const parsed = JSON.parse(stripJsonFence(data.choices?.[0]?.message?.content));
  if (!Number.isFinite(parsed.min) || !Number.isFinite(parsed.max)) {
    throw new Error(`${provider} weapon evaluation response missing numeric min/max`);
  }
  return {
    min: parsed.min,
    max: parsed.max,
    attackRange: parsed.attackRange === 'ranged' ? 'ranged' : 'melee',
    attackRangeDistance: Number.isFinite(parsed.attackRangeDistance)
      ? parsed.attackRangeDistance
      : RANGE_DISTANCE_MIN,
  };
}

function requestWeaponEvaluationForProvider(provider, apiKey, weaponState, signal) {
  return provider === 'gemini'
    ? requestWeaponEvaluation(apiKey, weaponState, signal)
    : requestCompatibleWeaponEvaluation(provider, apiKey, weaponState, signal);
}

// 완성된 무기를 AI에게 채점받는다. 같은(또는 거의 같은) 무기는 항상 같은 damage/attackRange를 반환한다.
export async function evaluateWeapon(weaponState) {
  const key = cacheKey(weaponState);
  const cached = getCached(key);
  if (cached !== undefined) {
    return { ...cached, cached: true };
  }

  if (process.env.MOCK_AI === 'true') {
    const damage = seededPick(key, DAMAGE_MIN, DAMAGE_MAX);
    const bounds = computeWeaponBounds(weaponState?.parts);
    const { attackRange, attackRangeDistance } = classifyWeaponRangeFallback(bounds);
    const result = { damage, attackRange, attackRangeDistance };
    setCached(key, result);
    return { ...result, cached: false };
  }

  const { min, max, attackRange, attackRangeDistance } = await callGeminiWithRotation((apiKey, signal, provider) =>
    requestWeaponEvaluationForProvider(provider, apiKey, weaponState, signal),
  );
  const damage = seededPick(key, Math.max(DAMAGE_MIN, min), Math.min(DAMAGE_MAX, max));
  const result = { damage, attackRange, attackRangeDistance };
  setCached(key, result);
  return { ...result, cached: false };
}

const TOOL_DECLARATIONS = [
  {
    name: 'addPart',
    description: '무기에 새 도형 부품을 추가한다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        shapeId: { type: 'STRING' },
        x: { type: 'NUMBER' },
        y: { type: 'NUMBER' },
        rotation: { type: 'NUMBER' },
        scaleX: { type: 'NUMBER', description: '가로 배율 (1이 기본 크기)' },
        scaleY: { type: 'NUMBER', description: '세로 배율 (1이 기본 크기)' },
      },
      required: ['shapeId', 'x', 'y'],
    },
  },
  {
    name: 'movePart',
    description: '기존 부품을 새 위치로 옮긴다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partId: { type: 'STRING' },
        x: { type: 'NUMBER' },
        y: { type: 'NUMBER' },
      },
      required: ['partId', 'x', 'y'],
    },
  },
  {
    name: 'rotatePart',
    description: '기존 부품을 회전시킨다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partId: { type: 'STRING' },
        rotation: { type: 'NUMBER' },
      },
      required: ['partId', 'rotation'],
    },
  },
  {
    name: 'scalePart',
    description:
      '기존 부품의 크기를 바꾼다. 가로(scaleX)와 세로(scaleY)를 따로 줄 수 있다 — 한쪽만 크게 하면 길쭉하게 늘어난다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partId: { type: 'STRING' },
        scaleX: { type: 'NUMBER', description: '가로 배율 (1이 기본 크기)' },
        scaleY: { type: 'NUMBER', description: '세로 배율 (1이 기본 크기)' },
      },
      required: ['partId'],
    },
  },
  {
    name: 'removePart',
    description: '기존 부품을 제거한다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partId: { type: 'STRING' },
      },
      required: ['partId'],
    },
  },
];

function summarizeEditableParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return '없음';
  return parts.map((part) => {
    const { sx, sy } = partScale(part);
    return `${part.id}|${part.shapeId}|${part.x}|${part.y}|${part.rotation ?? 0}|${sx}|${sy}`;
  }).join(';');
}

function buildChatSystemInstruction(weaponState, availableShapeIds, canvasSize) {
  return [
    '역할: 자연어를 수학 도형 무기 편집 함수로 변환하는 도우미.',
    `shapeId=${availableShapeIds.join(',')}`,
    `캔버스=${canvasSize.width}x${canvasSize.height}; 부품 최대=25; scaleX/scaleY=${SCALE_MIN}~${SCALE_MAX}(기본 1).`,
    '현재 부품 형식=id|shapeId|x|y|rotation|scaleX|scaleY; 항목 구분=;',
    `현재 부품=${summarizeEditableParts(weaponState.parts)}`,
    '규칙: 필요한 모든 함수 호출과 짧은 한국어 설명(함수 없음/불가 시에도)을 한 응답에 함께 제공.',
    '복합 명령도 호출을 한꺼번에 제공. 새 부품은 addPart에 최종 위치·회전·크기를 직접 지정.',
    '길쭉한 칼날·자루·손잡이는 새 도형 대신 scaleX/scaleY 비율을 활용(예: bar scaleY=2.5).',
    '기본 설명은 1~2문장. 수학 질문에는 짧게 설명하고 수식은 인라인 $...$, 블록 $$...$$ LaTeX 사용.',
  ].join('\n');
}

// toolCalls만 있고 텍스트가 없을 때 쓰는 결정론적 대체 문구 — 프롬프트 지시("함수 호출과
// 텍스트를 항상 함께 답하라")를 강화해도 LLM이 100% 지키지는 않는다(특히 function calling
// 모드에서는 텍스트를 그냥 생략하는 경우가 실제로 잦다). "(응답 텍스트가 없어요)"라는 의미
// 없는 placeholder보다, 실제로 어떤 함수가 호출됐는지(toolCalls)로 직접 설명을 만들어주는
// 쪽이 모델의 협조 여부와 무관하게 항상 정확하다.
const OP_LABELS = {
  addPart: (call) => `${getShapeById(call.shapeId)?.name ?? call.shapeId} 추가`,
  movePart: () => '부품 이동',
  rotatePart: () => '부품 회전',
  scalePart: () => '부품 크기 조절',
  removePart: () => '부품 제거',
};

function describeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  const phrases = toolCalls.map((call) => (OP_LABELS[call.op] ? OP_LABELS[call.op](call) : call.op));
  return `${phrases.join(', ')}했어요.`;
}

// generateContent 한 번 호출 — contents를 그대로 넘기고 candidates[0]의 parts를 돌려준다.
// 첫 턴/왕복 턴 둘 다 이 함수 하나로 처리한다(요청 바디 구성이 똑같고 contents만 다름).
async function callGeminiChat(apiKey, contents, weaponState, availableShapeIds, canvasSize, signal) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildChatSystemInstruction(weaponState, availableShapeIds, canvasSize) }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini chat request failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts ?? [];
}

function extractToolCallsAndText(parts) {
  const toolCalls = [];
  let text = '';
  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({ op: part.functionCall.name, ...part.functionCall.args });
    } else if (part.text) {
      text += part.text;
    }
  }
  return { toolCalls, text };
}

// 사용자의 자연어 명령을 Gemini function calling으로 해석해 toolCalls로 변환한다.
// 현재 상태와 모든 제작 규칙은 그대로 전달하되 한 응답에서 필요한 호출을 전부 받는다.
// 설명 텍스트를 빼먹어도 실제 호출 목록으로 정확한 짧은 안내를 만들 수 있으므로, 설명만
// 받으려고 Gemini를 다시 호출하지 않는다.
export async function requestToolCalls(apiKey, weaponState, message, availableShapeIds, canvasSize, signal) {
  const contents = [{ role: 'user', parts: [{ text: message }] }];
  const parts = await callGeminiChat(apiKey, contents, weaponState, availableShapeIds, canvasSize, signal);
  const { toolCalls, text } = extractToolCallsAndText(parts);
  return { toolCalls, reply: text || describeToolCalls(toolCalls) || '(응답 텍스트가 없어요)' };
}

function normalizeJsonSchema(value) {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === 'type' && typeof item === 'string' ? item.toLowerCase() : normalizeJsonSchema(item),
  ]));
}

export async function requestCompatibleToolCalls(provider, apiKey, weaponState, message, availableShapeIds, canvasSize, signal) {
  const tools = TOOL_DECLARATIONS.map((declaration) => ({
    type: 'function',
    function: {
      name: declaration.name,
      description: declaration.description,
      parameters: normalizeJsonSchema(declaration.parameters),
    },
  }));
  const data = await callOpenAiCompatible(provider, apiKey, {
    messages: [
      { role: 'system', content: buildChatSystemInstruction(weaponState, availableShapeIds, canvasSize) },
      { role: 'user', content: message },
    ],
    tools,
    tool_choice: 'auto',
    temperature: 0.2,
    max_tokens: 2048,
  }, signal);
  const response = data.choices?.[0]?.message ?? {};
  const toolCalls = (response.tool_calls ?? []).map((call) => {
    let args = {};
    try {
      args = JSON.parse(call.function?.arguments || '{}');
    } catch {
      throw new Error(`${provider} returned invalid function arguments`);
    }
    return { op: call.function?.name, ...args };
  });
  return {
    toolCalls,
    reply: response.content || describeToolCalls(toolCalls) || '(응답 텍스트가 없어요)',
  };
}

function requestToolCallsForProvider(provider, apiKey, weaponState, message, availableShapeIds, canvasSize, signal) {
  return provider === 'gemini'
    ? requestToolCalls(apiKey, weaponState, message, availableShapeIds, canvasSize, signal)
    : requestCompatibleToolCalls(provider, apiKey, weaponState, message, availableShapeIds, canvasSize, signal);
}

function mockInterpretCommand(message) {
  return {
    toolCalls: [{ op: 'addPart', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 }],
    reply: `(MOCK) "${message}" 명령을 반영했어요.`,
  };
}

export async function interpretCommand({ weaponState, message, availableShapeIds, canvasSize }) {
  if (process.env.MOCK_AI === 'true') {
    return mockInterpretCommand(message);
  }
  return callGeminiWithRotation((apiKey, signal, provider) =>
    requestToolCallsForProvider(provider, apiKey, weaponState, message, availableShapeIds, canvasSize, signal),
  );
}
