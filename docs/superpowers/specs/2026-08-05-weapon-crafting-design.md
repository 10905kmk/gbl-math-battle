# 무기 제작 UI + AI 채점 일관성 — 설계 문서

- 브랜치: `feature/weapon-crafting`
- 관련 문서: `docs/초안.md` (7-② 제작 화면, 8번 미결 사항)
- 작성일: 2026-08-05

## 배경

기존 `docs/초안.md` 7-②와 `frontend/src/screens/create.js`는 "도형 그리드 선택 → 텍스트 설명 입력 → AI가 통짜로 무기 생성" 흐름이었다. 팀 카톡 대화(2026-08-05, 최주영)에서 구체화된 실제 방향은 다르다:

- 무기 제작은 **캔버스(좌) + AI 채팅(우)** 병렬 구조 (참고: `1-1-ai-social.vercel.app`)
- 완전 자동 생성이 아니라 **AI 채팅 명령 + 수동 편집(그림판처럼)** 하이브리드
- 스탯은 공식 계산이 아니라 **완성된 무기를 AI가 보고 데미지(1~10000)를 채점**하는 방식
- 캐릭터(6종)와 맵은 팀이 사전 제작 — 참가자가 만드는 건 무기뿐
- AI 제공자는 **Gemini 등, 무료 토큰 여러 개를 로테이션**하며 사용 예정 (예산/쿼터 제약이 실질적인 설계 조건)

기존 `create.js`의 2단계 텍스트 흐름은 이 설계로 완전히 대체된다.

## 스코프

**이번 스펙에 포함**
1. 무기 제작 UI (캔버스 + AI 채팅 + 수동 편집)
2. AI 채점 일관성 확보 (같은/거의 같은 무기 → 같은 점수 보장)
3. 제작 완료 → 대기 → 전원 완료 시 다음 단계 전환 (`session.js`의 `create:done` 구현)

**이번 스펙에서 명시적으로 제외 (별도 스펙 예정)**
- 대전 시스템 자체의 메커니즘/페어링 방식 (`docs/초안.md` 8번에 이미 "미정"으로 명시됨). 이번 작업은 전환만 구현하고 대전 화면 내용은 기존 플레이스홀더(`<p>대전 화면 (설계 예정)</p>`) 그대로 둔다.
- 맵/캐릭터 에셋 제작 파이프라인 (팀이 Manus 등으로 별도 제작)
- 결과물 PDF/이미지 다운로드
- CDN(esm.sh/Konva) 오프라인 대비 (기존 초안.md 8번의 별도 미해결 항목, 이번에 새로 다루지 않음)

## 데이터 모델

```js
// 무기 = 정규화된 도형 배치 목록. AI 채팅도, 수동 편집도, 채점도 모두 이 구조를 공유한다.
weapon = {
  parts: [
    { id: 'p1', shapeId: 'sierpinski', x: 120, y: 40, rotation: 0, scale: 0.6 },
    { id: 'p2', shapeId: 'triangle',   x: 120, y: 90, rotation: 90, scale: 1.2 },
  ],
}
```

- `shapeId`는 `shapes/shapes.js` + `shapes/fractals.js`에 등록된 id만 허용
- `x`/`y`는 캔버스 좌표계(픽셀), `rotation`은 도(degree), `scale`은 배율
- part 개수 상한 10개 (AI/수동 양쪽 모두 적용)
- part별 고유 `id`로 AI 툴 호출과 Konva 노드를 매칭

## 아키텍처

### 프론트: `frontend/src/screens/create.js` (전면 재작성)

- 좌측: Konva.js(CDN) 캔버스 — 도형 팔레트(클릭 추가) + 배치된 part들(드래그 이동, `Konva.Transformer`로 회전/크기조절, 삭제)
- 우측: AI 채팅 패널 (메시지 목록 + 입력창)
- 하단: "AI 평가받기" 버튼
- `weaponState`는 편집 중엔 **클라이언트가 로컬로 보유** — 드래그마다 서버 왕복 없음. 채팅 전송/평가받기 시점에만 현재 상태 전체를 서버로 전송

### 신규 도형 렌더링: `shapes/shapes.js`, `shapes/fractals.js`

- 현재는 `id/name/baseStats`만 있고 실제로 그릴 방법이 없음
- Konva 커스텀 `Shape`가 쓸 좌표 생성 함수 추가 (삼각형/사각형은 단순, 시에르핀스키/코흐눈꽃은 재귀 좌표 생성)
- `shapes/stats.js`는 AI 채점 실패 시 폴백용 결정론적 점수 계산으로 역할 유지

### 백엔드 신규 라우트

- `POST /api/weapon/chat` — `{ weaponState, message }` → AI 툴 호출 실행 → `{ weaponState: 갱신됨, reply }`
- `POST /api/weapon/evaluate` — `{ weaponState }` → `{ damage }` (최종 확정, 재평가 불가)

### `backend/lib/aiClient.js` 확장

- `interpretCommand({ weaponState, message })` — Gemini 네이티브 tool calling. 시스템 프롬프트로 `addPart`/`movePart`/`rotatePart`/`scalePart`/`removePart` 스키마 + 사용 가능 `shapeId` 목록 + 캔버스 크기 전달. 응답은 한 번의 호출에 담긴 function-call 파트들 + 텍스트 reply 파트. 멀티스텝 루프 없음 (AI가 툴 결과를 다시 보고 재판단할 필요 없는 단발성 명령 해석이므로)
- `evaluateWeapon({ weaponState })` — 아래 "채점 일관성" 절 참고
- **API 키 로테이션**: 환경변수에 콤마로 구분된 키 풀(예: `GEMINI_API_KEYS`), 요청마다 순환 선택. 429(rate limit) 응답 시 풀의 다음 키로 자동 재시도, 전부 소진되면 실패 처리

### 서버 측 검증 (chat 응답 적용 시)

- `shapeId`가 등록된 도형인지 확인, 아니면 해당 호출 무시
- `x`/`y`를 캔버스 범위 안으로 clamp
- 적용 후 part 개수가 10개를 넘으면 초과분 무시, reply에 안내 문구 추가

## AI 채점 일관성

목표: 완전히 같은 무기는 항상 완전히 같은 점수, 거의 같은 무기(살짝 드래그 차이)도 사실상 같은 점수가 나오게 해서 "왜 나만 다르지" 불만을 원천 차단. 동시에 로테이션 토큰 소모를 줄인다.

1. **정규화**: part들을 `shapeId` 기준 정렬 후, `x`/`y`는 10px 단위, `rotation`은 15° 단위로 반올림
2. **캐시 키**: 정규화된 배열을 해시 — 같은 무기(또는 거의 같은 무기)는 같은 키로 수렴
3. **캐시 조회**: 인메모리 `Map`. 있으면 그 값 즉시 반환 (AI 호출 없음)
4. **캐시 미스**: `evaluateWeapon()` 호출 — few-shot 샘플(팀이 사전 제작) + temperature 0 → AI는 **절대값이 아니라 범위**(예: 4500~5500)를 반환

   few-shot 샘플은 `backend/lib/weaponEvaluationSamples.js`에 아래 형식으로 둔다. 이 파일 하나가 (a) few-shot 프롬프트 콘텐츠, (b) 캐시 사전 시딩 데이터 두 용도로 같이 쓰인다.
   ```js
   export const SAMPLES = [
     { parts: [{ shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }], damage: 3000, note: '기본 삼각형 검' },
     { parts: [/* ... */], damage: 7200, note: '시에르핀스키 삼각+막대 창' },
   ];
   ```
   콘텐츠(실제 샘플 무기-데미지 쌍 값)는 팀이 채워 넣는 것이 이번 스펙 범위이고, 이 파일 형식/로딩 방식만 이번에 구현한다.
5. **결정론적 확정값**: 캐시 키를 시드로 범위 내 정수를 산출 (`min + hash(key) % (max - min + 1)`) — 같은 키는 항상 같은 시드 → 항상 같은 최종값
6. 캐시에 `{key: damage}` 저장
7. **사전 시딩**: 서버 시작 시, 팀이 미리 만든 few-shot 샘플 무기 파일을 캐시에 미리 로드. few-shot 프롬프트 콘텐츠와 캐시 시드 데이터를 같은 파일로 이중 사용 — 팀이 의도한 예시 무기는 AI 호출 없이 항상 팀이 정한 값 그대로 나감

캐시는 인메모리(서버 재시작 시 초기화)로 충분 — 현장 로컬 서버가 부스 시작부터 끝까지 한 번 켜져 있는 단발 이벤트이기 때문.

## 제작 완료 흐름

1. "AI 평가받기" 클릭 → `/api/weapon/evaluate` → `damage` 수신 즉시 확정 (재평가 불가, 뒤로 못 감)
2. 기존 create.js에 있던 "대기 중(N/5)" 화면으로 전환, `create:done` 소켓 이벤트 emit
3. `backend/socket/session.js`의 `create:done` 핸들러(현재 빈 TODO)를 이번에 구현 — 참가자별 완료 상태 추적, 전원 완료 시 `stage='battle'` broadcast
4. 대전 화면 자체 내용은 안 건드림 (기존 플레이스홀더 유지) — 전환 동작만 완성

## 에러 처리

- **AI 채팅 실패**(네트워크/레이트리밋/파싱) → `weaponState` 변경 없이 채팅창에 에러 표시, 재시도 가능
- **AI 채점 실패**(모든 키 소진 등) → `shapes/stats.js` 기반 결정론적 점수로 자동 대체, 참가자는 막히지 않고 진행됨
- part 상한 초과 → 조용히 clamp + reply 안내

## 테스트

- `MOCK_AI=true` 환경변수 — `aiClient.js`가 실제 API 호출 없이 고정 응답 반환. 로테이션 토큰 소모 없이 로컬 반복 개발/테스트
- 정규화/캐시키/시드확정값 함수는 순수함수 — 노드 스크립트로 직접 검증 (거의 같은 무기 → 같은 키/같은 점수인지)
- UI 흐름은 Playwright MCP로 스모크 테스트 (도형 배치 → 채팅 전송 → 평가받기 → damage 표시 확인)

## 미결 사항 (이번 스펙 밖, 참고용)

- 대전 시스템 메커니즘 자체 (별도 스펙)
- 결과물 PDF/이미지 다운로드 (별도 스펙)
- CDN 오프라인 대비 (`docs/초안.md` 8번 기존 항목)
- few-shot 샘플 무기-데미지 쌍 실제 콘텐츠 제작 (팀 작업, 이 스펙은 파일 형식만 정의)
