# 실제 Gemini 연동 + 다중 provider 키 저장소 설계

## 배경

`backend/lib/aiClient.js`의 `requestDamageRange`(무기 채점)와 `requestToolCalls`(무기 채팅)는 지금 둘 다 스텁이라 호출하면 무조건 throw한다 — "데모 촬영이 급해서 MOCK_AI 경로만 완성하고 실제 Gemini 호출은 후속 작업으로 미룬다"는 의도된 TODO였다. 이제 실제 Gemini API 키를 발급받아 테스트해보기 위해 이 스텁을 실제 구현으로 채운다.

동시에, API 키를 앞으로 여러 개(Gemini 키 로테이션용 여러 개 + 나중에 다른 provider도 몇 개) 쓸 예정이라, 지금처럼 `.env`에 쉼표로 구분한 문자열(`GEMINI_API_KEYS=key1,key2,key3`)로 넣는 방식은 provider가 늘어나면 감당이 안 된다. 이 참에 provider별 키 배열을 담는 JSON 설정 파일로 옮긴다.

## 1. 키 저장소

**파일**: `backend/config/apiKeys.json` (gitignore 대상, 실제 키가 들어감)
```json
{
  "gemini": ["key1", "key2", "key3"]
}
```

**템플릿(커밋됨)**: `backend/config/apiKeys.example.json`
```json
{
  "gemini": []
}
```

**로더**: `backend/lib/apiKeys.js` (신규 파일)
- `loadApiKeysFromFile(filePath)`: 순수 함수. 파일을 읽어 JSON 파싱, 실패(파일 없음/파싱 에러)하면 `{}` 반환 — 테스트에서 임의 경로를 주입해 직접 검증할 수 있도록 경로를 파라미터로 받는다.
- `getApiKeys(provider)`: 기본 경로(`backend/config/apiKeys.json`)로 `loadApiKeysFromFile`을 호출한 결과를 캐싱해두고, `result[provider]`가 문자열 배열이면 그중 빈 문자열이 아닌 것만 걸러 반환, 아니면 빈 배열 반환. provider 이름만 받는 범용 함수라 나중에 `getApiKeys('openai')`처럼 다른 provider가 추가돼도 로더 자체는 안 바뀐다.

**`.env`/`.env.example` 변경**: `GEMINI_API_KEYS` 줄을 지운다. `MOCK_AI`, `PORT`, `ADMIN_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`는 그대로 `.env`에 남긴다(이번 스코프는 "여러 개 쓸 API 키" 저장 방식 변경이지, Supabase 같은 단일 키까지 옮기는 게 아니다).

**`.gitignore`**: 루트 `.gitignore`에 `backend/config/apiKeys.json` 추가.

## 2. 무기 채점 연동 (`requestDamageRange`)

`gemini-2.0-flash`에 `generateContent` REST 호출(Node 내장 `fetch`, 새 의존성 추가 없음).

**프롬프트 구성**: `SAMPLES`(few-shot)를 "- {부품 요약} → 데미지 N (note)" 형태로 나열하고, 현재 채점 대상 `weaponState.parts`를 같은 형식으로 보여준 뒤 "절대값이 아니라 (min, max) 범위로 답하라. max-min은 1000 이내로 좁게. min/max는 [DAMAGE_MIN, DAMAGE_MAX] 범위 안."을 지시한다.

**구조화 출력**: `generationConfig.responseMimeType: "application/json"` + `responseSchema`로 `{min: number, max: number}`를 강제한다 — 자유 텍스트에서 정규식으로 숫자를 뽑는 것보다 훨씬 안정적이다.

**응답 파싱**: `data.candidates[0].content.parts[0].text`를 `JSON.parse`. `min`/`max`가 유한한 숫자가 아니면 에러를 던진다(호출부인 `evaluateWeapon`이 이미 실패 시 처리하지 않고 그대로 전파하며, 그 위의 라우트가 `fallbackDamage`로 폴백함).

## 3. 무기 채팅 연동 (`requestToolCalls`)

Gemini **function calling**을 쓴다. `weaponChat.js`의 `applyToolCalls`가 이미 처리하는 5개 연산을 그대로 `functionDeclarations`로 등록:
- `addPart(shapeId, x, y, rotation?, scale?)`
- `movePart(partId, x, y)`
- `rotatePart(partId, rotation)`
- `scalePart(partId, scale)`
- `removePart(partId)`

**요청 구성**: `systemInstruction`에 사용 가능한 `availableShapeIds`, `canvasSize`, 현재 `weaponState.parts`, "부품은 최대 10개까지" 제약을 담고, `contents`에 사용자 `message`를 담는다.

**응답 매핑**: `data.candidates[0].content.parts`를 순회하며 `functionCall` 파트는 `{ op: functionCall.name, ...functionCall.args }`로, `text` 파트는 이어붙여서 `reply`로 만든다. `reply`가 끝까지 빈 문자열이면 `'(응답 텍스트가 없어요)'`로 대체한다(채팅 UI가 항상 문자열을 보여줄 수 있도록).

## 4. 키 로테이션 (기존 로직 재사용, 테스트 가능하게 변경)

`callGeminiWithRotation(requestFn, pool)`으로 시그니처를 바꾼다 — `pool` 기본값은 `getApiKeys('gemini')`. 실제 호출부(`evaluateWeapon`, `interpretCommand`)는 인자를 안 넘기면 되고(기존과 동일하게 동작), 테스트는 가짜 키 배열을 직접 주입해 429 로테이션을 검증할 수 있다(이 세션에서 계속 써온 "테스트를 위한 파라미터 주입" 패턴 — `drawWeaponGroup(Konva, ...)`와 동일한 이유).

## 5. 에러 처리

- HTTP 응답이 `!res.ok`면 `Error`를 던지고 `err.status = res.status`를 붙인다 — 429면 로테이션, 그 외엔 즉시 전파(기존 `callGeminiWithRotation` 로직 그대로).
- 네트워크 에러(fetch 자체가 reject)나 JSON 파싱 실패도 그대로 던진다 — 이미 상위(`weaponEvaluate.js`/`weaponChat.js`)에 폴백/502 처리가 있으므로 여기서 추가로 안전망을 만들 필요 없다.

## 스코프 제외

- 실제 API 키 발급은 사용자가 [Google AI Studio](https://aistudio.google.com/apikey)에서 직접 진행 — 이 작업은 코드만 준비한다.
- `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`는 이번에 `apiKeys.json`으로 옮기지 않는다(단일 키라 배열 저장소가 필요 없음).
- Gemini 외 다른 provider(OpenAI 등) 연동 코드는 지금 만들지 않는다 — 로더만 provider 이름을 받는 범용 구조로 만들어서 나중에 키만 추가하면 되게 해둔다.
- 안전설정(safety settings)·토큰 한도 등 세부 생성 옵션 튜닝은 하지 않는다(기본값 사용).

## 테스트 범위

- `backend/lib/apiKeys.test.mjs`(신규): `loadApiKeysFromFile`이 존재하는 파일/없는 파일/깨진 JSON에 대해 올바르게 동작하는지, `getApiKeys`가 빈 문자열을 걸러내는지.
- `backend/lib/aiClient.test.mjs`/`aiClient.chat.test.mjs`(기존): MOCK_AI 경로는 그대로 유지, 통과해야 함.
- `backend/lib/aiClient.rotation.test.mjs`(신규): `global.fetch`를 모킹해서 `requestDamageRange`/`requestToolCalls`가 정상 응답을 올바르게 파싱하는지, 429 응답에서 `callGeminiWithRotation`이 다음 키로 재시도하는지, 그 외 에러는 즉시 전파하는지 확인.
