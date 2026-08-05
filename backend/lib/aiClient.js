// backend/lib/aiClient.js — Gemini 연동: 무기 채팅 해석 + 무기 채점
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';
import { getApiKeys } from './apiKeys.js';

export const DAMAGE_MIN = 1;
export const DAMAGE_MAX = 10000;
// 'gemini-2.0-flash'는 무료 티어 할당량이 0으로 막혀 있는 계정이 있어(429 RESOURCE_EXHAUSTED,
// limit: 0) 'gemini-flash-latest'로 바꿈 — 실제 키로 라이브 검증 중 발견, 두 모델 다 같은
// generateContent 엔드포인트/요청 형식을 쓰므로 다른 코드는 안 바뀐다.
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

seedCache(SAMPLES);

let keyIndex = 0;
function nextKey(pool) {
  const key = pool[keyIndex % pool.length];
  keyIndex += 1;
  return key;
}

// 키 풀을 순환하며 요청. 429(rate limit)면 다음 키로 재시도, 그 외 에러는 즉시 던짐.
// pool은 기본으로 apiKeys.json의 gemini 키 배열을 쓰지만, 파라미터로 받을 수 있게 해서
// 테스트가 실제 키 파일 없이도 가짜 키 배열을 주입해 로테이션 로직만 따로 검증할 수 있다
// (shapes/weaponRenderer.js의 drawWeaponGroup(Konva, ...)와 같은 이유의 의존성 주입).
export async function callGeminiWithRotation(requestFn, pool = getApiKeys('gemini')) {
  if (pool.length === 0) {
    throw new Error('gemini API 키가 없습니다 — backend/config/apiKeys.json의 "gemini" 배열을 채워주세요');
  }
  let lastError;
  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const key = nextKey(pool);
    try {
      return await requestFn(key);
    } catch (err) {
      lastError = err;
      if (err.status !== 429) throw err;
    }
  }
  throw lastError;
}

function summarizeParts(parts) {
  return parts
    .map((p) => `${p.shapeId}(x:${p.x},y:${p.y},rotation:${p.rotation},scale:${p.scale})`)
    .join(', ');
}

function buildDamagePrompt(weaponState) {
  const examples = SAMPLES.map((s) => `- ${summarizeParts(s.parts)} → 데미지 ${s.damage} (${s.note})`).join('\n');
  return [
    '너는 수학 도형으로 만든 무기의 전투력을 채점하는 심판이다.',
    `데미지는 ${DAMAGE_MIN}~${DAMAGE_MAX} 범위의 정수다. 아래는 참고용 예시다:`,
    examples,
    '',
    `채점할 무기: ${summarizeParts(weaponState.parts)}`,
    '',
    '절대값이 아니라 (min, max) 범위로 답하라. max - min은 1000 이내로 좁게 잡아라.',
  ].join('\n');
}

// 완성된 무기 하나를 Gemini에게 채점받아 데미지 범위(min,max)를 받아온다.
export async function requestDamageRange(apiKey, weaponState) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildDamagePrompt(weaponState) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            min: { type: 'INTEGER' },
            max: { type: 'INTEGER' },
          },
          required: ['min', 'max'],
        },
      },
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini damage request failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);
  if (!Number.isFinite(parsed.min) || !Number.isFinite(parsed.max)) {
    throw new Error('Gemini damage response missing numeric min/max');
  }
  return { min: parsed.min, max: parsed.max };
}

// 완성된 무기를 AI에게 채점받는다. 같은(또는 거의 같은) 무기는 항상 같은 damage를 반환한다.
export async function evaluateWeapon(weaponState) {
  const key = cacheKey(weaponState);
  const cached = getCached(key);
  if (cached !== undefined) {
    return { damage: cached, cached: true };
  }

  if (process.env.MOCK_AI === 'true') {
    const damage = seededPick(key, DAMAGE_MIN, DAMAGE_MAX);
    setCached(key, damage);
    return { damage, cached: false };
  }

  const { min, max } = await callGeminiWithRotation((apiKey) => requestDamageRange(apiKey, weaponState));
  const damage = seededPick(key, Math.max(DAMAGE_MIN, min), Math.min(DAMAGE_MAX, max));
  setCached(key, damage);
  return { damage, cached: false };
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
        scale: { type: 'NUMBER' },
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
    description: '기존 부품의 크기를 바꾼다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partId: { type: 'STRING' },
        scale: { type: 'NUMBER' },
      },
      required: ['partId', 'scale'],
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

function buildChatSystemInstruction(weaponState, availableShapeIds, canvasSize) {
  return [
    '너는 수학 도형 무기 제작을 도와주는 도우미다. 사용자의 자연어 명령을 아래 함수 호출로 변환하라.',
    `사용 가능한 shapeId: ${availableShapeIds.join(', ')}`,
    `캔버스 크기: ${canvasSize.width}x${canvasSize.height} (x/y는 이 범위 안)`,
    `현재 부품 목록: ${JSON.stringify(weaponState.parts)}`,
    '부품은 최대 10개까지만 추가할 수 있다.',
    '함수 호출과 함께, 사용자에게 보여줄 짧은 한국어 응답 텍스트도 반드시 함께 답하라.',
  ].join('\n');
}

// 사용자의 자연어 명령을 Gemini function calling으로 해석해 toolCalls로 변환한다.
export async function requestToolCalls(apiKey, weaponState, message, availableShapeIds, canvasSize) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildChatSystemInstruction(weaponState, availableShapeIds, canvasSize) }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini chat request failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const toolCalls = [];
  let reply = '';
  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({ op: part.functionCall.name, ...part.functionCall.args });
    } else if (part.text) {
      reply += part.text;
    }
  }
  return { toolCalls, reply: reply || '(응답 텍스트가 없어요)' };
}

function mockInterpretCommand(message) {
  return {
    toolCalls: [{ op: 'addPart', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }],
    reply: `(MOCK) "${message}" 명령을 반영했어요.`,
  };
}

export async function interpretCommand({ weaponState, message, availableShapeIds, canvasSize }) {
  if (process.env.MOCK_AI === 'true') {
    return mockInterpretCommand(message);
  }
  return callGeminiWithRotation((apiKey) =>
    requestToolCalls(apiKey, weaponState, message, availableShapeIds, canvasSize),
  );
}
