# 결과물 영구 저장 — 설계 문서

- 브랜치: `feature/result-storage` (base: 확정 예정 — 실행 단계에서 사용자 확인 후 결정)
- 관련 문서: `docs/초안.md` 3장(시스템 아키텍처), 7-④ 결과 화면, 8번 미결 사항("결과물 이미지 저장 여부 및 저장 방식")
- 작성일: 2026-08-05

## 배경

`docs/초안.md`는 완성된 결과(도형/스탯/이미지)를 Supabase에 저장해 부스가 끝나도 결과가 남도록 설계했지만, 실제 저장 트리거·스키마·mock 폴백은 구현되지 않았다. `backend/routes/result.js`(`POST /api/result`)와 `backend/lib/supabaseClient.js`(`saveResult`)는 초기 스캐폴드 커밋에 자리만 잡혀 있고, 실제로 호출하는 코드가 없다.

## 스코프

**이번 스펙에 포함**
1. 대전 종료 시점에 서버가 각 참가자의 결과(무기+승패)를 자동으로 저장
2. Supabase `results` 테이블 스키마 (마이그레이션 SQL)
3. Supabase 미설정 시에도 개발/데모가 막히지 않는 mock 폴백
4. 저장 실패가 결과 화면 진입을 막지 않도록 하는 에러 처리

**이번 스펙에서 명시적으로 제외 (별도 스펙 예정)**
- 결과 확인용 외부 페이지(`result-page/`, Vercel 배포, id로 조회)
- 현장 결과 화면(`ResultScreen`)의 QR코드 표시 — 외부 페이지가 없으므로 QR 자리 자체를 만들지 않음 (기존 `result.js`의 빈 `qr-slot`은 그대로 둔다)
- Supabase Storage(오브젝트 스토리지)를 통한 이미지 저장 — 이미지는 DB 컬럼에 base64로 저장
- 참가자 이름/닉네임 수집 — 현재 참가자 데이터에 이름이 없으므로 스키마에도 포함하지 않음
- 실제 Supabase 프로젝트 생성(가입, 프로젝트 생성, URL/서비스 키 발급) — 브라우저에서 사용자가 직접 해야 하는 외부 작업이라 코드 스펙 범위 밖. 이 문서는 그 작업에 필요한 SQL과 `.env` 값 자리만 제공한다.

## 저장 흐름

```
대전 종료 (stepSimulation이 winners 확정)
  → battle.js의 startBattleRoom이 onEnd(winners) 호출          [기존 로직, 변경 없음]
  → session.js의 onEnd 콜백:
      cohort.participants 각각에 대해 saveResult(...) 호출
      (Promise.allSettled로 병렬 처리, 개별 실패는 콘솔에만 기록)
  → goToStage(io, 'result')                                     [기존 로직, 변경 없음]
```

핵심 이유: 서버가 이미 갖고 있는 `cohort.participants`(각자의 완성된 무기)와 `winners`(승패)만으로 저장이 끝나므로, 참가자 소켓이 결과 화면 도달 전에 끊겨도(연결 끊김 케이스, 이미 대전 시스템에서 처리 중) 저장은 영향받지 않는다. 클라이언트가 자기 승패를 직접 보고하는 방식은 신뢰성이 떨어져 채택하지 않는다.

**저장 실패는 절대 stage 전환을 막지 않는다** — `saveResult` 호출은 각각 try/catch로 감싸고, 실패해도 `goToStage(io, 'result')`는 그대로 진행한다. 부스 운영 중 저장 실패로 참가자가 결과 화면을 못 보는 상황은 저장 성공보다 나쁘다.

## 데이터 모델

**Supabase 테이블** (`backend/lib/supabase/schema.sql`로 저장, 사용자가 Supabase SQL Editor에서 직접 실행):

```sql
create table results (
  id uuid primary key default gen_random_uuid(),
  weapon_name text,
  weapon_image text,       -- Konva 캔버스 toDataURL() 결과, base64 그대로
  weapon_stats jsonb,      -- { attack, defense }
  weapon_damage integer,
  win boolean,
  created_at timestamptz not null default now()
);
```

**`saveResult(result)` 입력 형태** (`backend/lib/supabaseClient.js`, 기존 함수 시그니처 유지):

```js
{
  weapon_name: weapon.name,
  weapon_image: weapon.image,
  weapon_stats: weapon.stats,
  weapon_damage: weapon.damage,
  win: boolean,
}
```

`session.js`가 `cohort.participants`의 `weapon` 객체(`create.js`가 만드는 `{ name, image, stats, damage, parts }`)에서 필요한 필드만 뽑아 이 형태로 변환해 전달한다. `parts`(캔버스 원본 좌표 데이터)는 저장 대상이 아니다 — 스펙 범위(요약 보관)를 벗어난다.

## Mock 폴백

`SUPABASE_URL`이 설정되지 않은 경우, `saveResult`는 에러를 던지는 대신 콘솔에 경고를 남기고 로컬에서 생성한 가짜 결과를 반환한다:

```js
export async function saveResult(result) {
  if (!supabase) {
    console.warn('[supabaseClient] SUPABASE_URL 미설정 — mock 저장으로 대체');
    return { id: crypto.randomUUID(), ...result, created_at: new Date().toISOString() };
  }
  const { data, error } = await supabase.from('results').insert(result).select().single();
  if (error) throw error;
  return data;
}
```

`weapon-crafting` 브랜치의 `aiClient.js` MOCK_AI 패턴과 동일한 이유: 실제 키 없이도 로컬 개발·통합 테스트·데모가 막히지 않아야 한다. 실제 Supabase 연동 전까지는 이 mock 경로로 전체 흐름(대전 종료 → 저장 호출 → 결과 화면 전환)을 검증한다.

## 변경/생성 파일

- `backend/lib/supabaseClient.js` — mock 폴백 추가 (기존 `saveResult` 시그니처 유지)
- `backend/lib/supabase/schema.sql` — 신규, 마이그레이션 SQL
- `backend/socket/session.js` — `onEnd` 콜백에서 `winners`를 사용해 참가자별 `saveResult` 호출 추가
- `backend/.env.example` — 이미 `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` 자리 있음, 변경 없음(참고용으로만 문서에 언급)
- `backend/routes/result.js` — 변경 없음 (이미 스캐폴드된 라우트를 그대로 재사용, 이번 스펙에서 호출하는 곳은 없지만 향후 result-page 스펙에서 조회용으로 쓰일 수 있어 유지)

## 테스트 전략

- `backend/lib/supabaseClient.test.mjs`: mock 폴백 경로(`SUPABASE_URL` 미설정 시 에러 없이 id 포함 객체 반환) 단위 테스트
- `backend/socket/battleIntegration.test.mjs` 확장: 대전 종료 시 각 참가자에 대해 저장이 시도되는지(예: `saveResult`를 모듈 모킹하거나, mock 폴백 결과를 스파이해서) 확인 — 저장이 실패하도록 강제해도 `stage:change`가 여전히 `'result'`로 전환되는지 회귀 테스트로 검증

## 미결 사항 (별도 스펙 대상)

- 결과 확인용 외부 페이지(`result-page/`, Vercel) + QR
- Supabase 프로젝트 실제 생성/키 발급 (사용자 작업)
