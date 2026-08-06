// backend/lib/aiClient.js — Gemini 연동: 무기 채팅 해석 + 무기 채점
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';
import { getApiKeys } from './apiKeys.js';
import { RANGE_DISTANCE_MIN, RANGE_DISTANCE_MAX, classifyWeaponRangeFallback } from '../../shapes/attackGeometry.js';
import { computeWeaponBounds } from '../../shapes/weaponRenderer.js';
import { getShapeById } from '../../shapes/registry.js';

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

// 키 풀을 순환하며 요청. 429(rate limit) 또는 503(일시적 과부하, "high demand" — 실제
// 라이브 호출에서 실측됨)이면 다음 키로 재시도, 그 외 에러는 즉시 던짐. 503은 특정 키의
// 문제가 아니라 모델 자체의 일시적 과부하라 같은 키로 재시도해도 될 수 있지만, 이미 있는
// "다음 키로 재시도" 경로를 그대로 재사용하는 쪽이 새 백오프 로직을 따로 만드는 것보다
// 간단하고, 결과적으로 몇 번의 재시도 기회를 준다는 점은 동일하다.
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
      if (err.status !== 429 && err.status !== 503) throw err;
    }
  }
  throw lastError;
}

function summarizeParts(parts) {
  return parts
    .map((p) => `${p.shapeId}(x:${p.x},y:${p.y},rotation:${p.rotation},scale:${p.scale})`)
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
export async function requestWeaponEvaluation(apiKey, weaponState) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildEvaluationPrompt(weaponState) }] }],
      generationConfig: {
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

  const { min, max, attackRange, attackRangeDistance } = await callGeminiWithRotation((apiKey) =>
    requestWeaponEvaluation(apiKey, weaponState),
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
    '',
    '응답은 항상 다음 두 가지를 "함께" 포함해야 한다 — 함수 호출만 하고 아래 2번을 생략하는 것은',
    '틀린 응답이다:',
    '1. 필요한 함수 호출(들)',
    '2. 무엇을 했는지 알려주는 한 문장짜리 한국어 텍스트 (예: "오른쪽에 삼각형을 추가했어요.",',
    '   "죄송해요, 그건 지금 못 해요.") — 함수 호출이 없는 경우에도 이 텍스트는 반드시 있어야 한다.',
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
async function callGeminiChat(apiKey, contents, weaponState, availableShapeIds, canvasSize) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildChatSystemInstruction(weaponState, availableShapeIds, canvasSize) }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
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

// 한 번의 요청-실행-응답 왕복으로 끝내지 않고, 모델이 텍스트만 있는(함수 호출 없는) 턴을
// 낼 때까지 계속 돈다 — "삼각형 추가하고 오른쪽으로 옮겨줘"처럼 모델이 한 번에 하나씩만
// 함수를 부르는 스타일이어도 전부 반영되게 한다. 모델이 비정상적으로 함수 호출만 계속
// 반복하는 경우(버그/루프)에도 API 호출이 무한정 나가지 않도록 상한을 둔다 — 이 앱의
// 명령은 "삼각형 추가해줘" 수준으로 단순해서 실제로는 1~2턴이면 끝나므로 5는 넉넉한 여유.
const MAX_TOOL_CALL_TURNS = 5;

// 사용자의 자연어 명령을 Gemini function calling으로 해석해 toolCalls로 변환한다.
//
// 함수 호출이 있는 턴마다 표준 function calling 왕복 패턴을 따른다: 그 턴의 functionCall들을
// 모델 턴으로 그대로 돌려주고, "실행 결과"를 user 턴(functionResponse)으로 보내 다음 턴을
// 받는다 — 실제 결과를 모르는 채로(함수 호출 시점에) 설명 텍스트까지 한번에 쓰라고 프롬프트로
// 강요하는 것보다 모델 입장에서도 더 자연스럽고, 실전에서 텍스트가 자주 빠지던 문제(요청
// 몇 개를 실제로 보내서 확인함: "방금 만든 거 지워줘" -> functionCall만 오고 텍스트 없음)도
// 이 왕복이 근본적으로 줄여준다. 실제 반영/좌표 clamp는 이 함수의 호출자(weaponChat.js의
// applyToolCalls)가 하므로, 여기서 모델에게 돌려주는 "결과"는 좌표까지 정확할 필요 없이
// "성공적으로 반영했다"는 확인이면 된다.
export async function requestToolCalls(apiKey, weaponState, message, availableShapeIds, canvasSize) {
  let contents = [{ role: 'user', parts: [{ text: message }] }];
  const allToolCalls = [];

  for (let turn = 0; turn < MAX_TOOL_CALL_TURNS; turn += 1) {
    let parts;
    try {
      parts = await callGeminiChat(apiKey, contents, weaponState, availableShapeIds, canvasSize);
    } catch (err) {
      // 첫 턴 실패는 그대로 던진다 — callGeminiWithRotation이 이 함수 전체를 다른 키로
      // 재시도한다(기존 동작과 동일). 이미 함수 호출을 하나 이상 확정한 뒤(왕복 중) 실패하면
      // 그 결과를 버리지 않고 지금까지 모은 toolCalls를 그대로 살려 반환한다 — 사용자가
      // 명령한 도형 조작 자체가 텍스트 생성 실패 때문에 무효화되면 안 된다.
      if (turn === 0) throw err;
      return { toolCalls: allToolCalls, reply: describeToolCalls(allToolCalls) || '(응답 텍스트가 없어요)' };
    }

    const { toolCalls, text } = extractToolCallsAndText(parts);
    if (toolCalls.length === 0) {
      // 함수 호출이 없는 턴 — 최종 응답으로 보고 루프를 끝낸다.
      return { toolCalls: allToolCalls, reply: text || describeToolCalls(allToolCalls) || '(응답 텍스트가 없어요)' };
    }

    allToolCalls.push(...toolCalls);
    contents = [
      ...contents,
      { role: 'model', parts },
      {
        // Gemini REST API는 role:'function'을 거부한다(실측: "Role 'function' is not
        // supported... valid role: ...USER...") — functionResponse도 그냥 user 턴으로 보낸다.
        role: 'user',
        parts: toolCalls.map((call) => ({
          functionResponse: { name: call.op, response: { status: 'ok' } },
        })),
      },
    ];
  }

  // MAX_TOOL_CALL_TURNS를 넘도록 계속 함수만 호출하면(비정상) 더 왕복하지 않고 안전하게
  // 종료한다 — 지금까지 모은 toolCalls는 전부 살리고 텍스트만 설명으로 대체한다.
  return { toolCalls: allToolCalls, reply: describeToolCalls(allToolCalls) || '(응답 텍스트가 없어요)' };
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
