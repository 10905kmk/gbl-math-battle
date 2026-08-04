// backend/lib/aiClient.js — Gemini 연동: 무기 채팅 해석 + 무기 채점
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';

export const DAMAGE_MIN = 1;
export const DAMAGE_MAX = 10000;
const GEMINI_MODEL = 'gemini-2.0-flash';

seedCache(SAMPLES);

function getKeyPool() {
  return (process.env.GEMINI_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

let keyIndex = 0;
function nextKey(pool) {
  const key = pool[keyIndex % pool.length];
  keyIndex += 1;
  return key;
}

// 키 풀을 순환하며 요청. 429(rate limit)면 다음 키로 재시도, 그 외 에러는 즉시 던짐.
async function callGeminiWithRotation(requestFn) {
  const pool = getKeyPool();
  if (pool.length === 0) {
    const err = new Error('GEMINI_API_KEYS not configured');
    throw err;
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

// TODO(후속 태스크): 실제 Gemini fetch 호출 + 프롬프트 구성(few-shot 예시 포함) 구현.
// 지금은 데모/영상 촬영이 급해서 MOCK_AI 경로만 완성하고 이 함수는 스텁으로 둔다.
// evaluateWeapon()이 이 함수를 호출하는 건 MOCK_AI가 아닐 때뿐이고, 이 함수가 던지면
// weaponEvaluate.js 라우트가 이미 fallbackDamage()로 안전하게 폴백하도록 되어 있어서(Task 8),
// 지금 스텁 상태로 둬도 다른 경로가 깨지지 않는다. 나중에 구현할 때 prompt 문구는
// SAMPLES(few-shot 예시)를 "- {parts} → 데미지 N (note)" 형태로 나열하고,
// "절대값이 아니라 범위(min,max)로 답해라. max-min은 1000 이내로 좁게" 지시를 포함시킬 것.
async function requestDamageRange() {
  throw new Error('requestDamageRange not implemented yet — real Gemini call is a follow-up task');
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

// TODO(후속 태스크): 실제 Gemini function-calling 연동 구현. 지금은 데모/영상 촬영이 급해서
// MOCK_AI 경로(mockInterpretCommand)만 완성하고 실제 호출은 스텁으로 둔다.
// weaponChat.js 라우트(Task 8)는 interpretCommand가 던지면 502로 응답하도록 이미 되어 있어서,
// 스텁 상태로 둬도 다른 경로가 깨지지 않는다 (MOCK_AI=false로 실행하면 채팅이 매번 에러 표시만 됨).
//
// 나중에 구현할 때 필요한 tool 스키마(5개, Gemini function-calling 형식)와 시스템 프롬프트 요지:
//   - addPart(shapeId, x, y, rotation?, scale?) — 새 부품 추가
//   - movePart(partId, x, y) — 이동
//   - rotatePart(partId, rotation) — 회전
//   - scalePart(partId, scale) — 크기조절
//   - removePart(partId) — 삭제
//   시스템 프롬프트에는 사용 가능한 shapeId 목록, 캔버스 크기, 현재 weaponState.parts,
//   "부품은 최대 10개까지" 제약을 포함시킬 것. 응답은 functionCall 파트들 + 텍스트 reply 파트를
//   한 응답 안에서 함께 받는다(멀티스텝 루프 불필요).
async function requestToolCalls() {
  throw new Error('requestToolCalls not implemented yet — real Gemini call is a follow-up task');
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
