# 부스 QR 체크인 — 설계 문서

## 배경

이 저장소(GBL 수학 도형 무기 온라인 베틀)는 학교 행사("GBL2026")의 여러 부스 중
하나(M8)에서 운영되는 개별 게임이다. 행사 전체는 별도의 중앙 허브 서버
(`https://34-227-8-239.sslip.io`, 이 저장소와 무관한 외부 시스템)가 참가자 계정
(Firebase `uid` 기반)과 부스 방문 이력을 관리한다. 허브는 다음 API를 제공한다
(HAR 캡처 분석 기준):

- `POST /api/auth/boothadmin {password}` → `{bid, is_created, role}` — 부스
  비밀번호로 로그인, 해당 부스의 `bid` 획득
- `GET /api/user/{uid}` → `{name, profile_image, history, ...}` — 참가자 프로필 조회
- `POST /api/booth/adduser {uid, bid, password}` → 방문 체크인 등록

지금까지는 참가자가 각 게임 기기에서 이름을 직접 타이핑해 입장했다. 이번 기능은
**부스 입구에서 QR 배지를 스캔해 참가자를 식별하고, 비어 있는 게임 기기에 자동
배정**하는 흐름과, **게임이 끝난 뒤 그 방문자 목록을 허브에 일괄 등록**하는 흐름을
추가한다.

QR 페이로드 형식: `{"version":1,"uid":"<firebase-uid>"}`

부스 비밀번호는 `Y00DeJZsJZrCA4Qd`(M8)이며, 절대 브라우저로 노출하지 않는다
(HAR 분석 보고서 자체가 이 값의 평문 노출을 보안 위험으로 지적했다).

## 범위

**포함:**
- 새 관리자 전용 페이지(`frontend/admin/checkin.html`): 상시 카메라로 QR 스캔,
  참가자 확인, 빈 기기 자동 배정, 체크인 목록 관리(연결 해제 포함)
- 백엔드: 허브 API 프록시(`backend/lib/boothApi.js`, `backend/routes/checkin.js`),
  체크인 목록 상태 관리(`backend/socket/checkin.js`)
- `frontend/src/screens/name.js`: 배정된 이름을 입력 필드에 미리 채워주는 최소 변경
  (참가자가 수정 가능, 최종 제출값이 항상 우선)
- `frontend/admin/admin.js`: 체크인 화면 열기 버튼, 대기 중인 체크인 건수 + "목록
  소진" 버튼, 참가자별 "기기 초기화" 버튼(이름 입력 후 이탈한 참가자의 기기를
  재사용 가능하게 되돌림)

**제외 (이번 작업 범위 밖):**
- 허브 서버(`34-227-8-239.sslip.io`) 자체의 보안 개선 — 우리 소관 밖
- `GET /api/master` 연동 — 이번 흐름에 불필요
- 다수의 체크인 화면을 동시에 여러 창에서 운영하는 시나리오의 성능 최적화(기본
  브로드캐스트로 충분하다고 가정)
- 참가자 방문 이력(`history`) 표시 — 확인 모달엔 이름/프로필 사진만 사용

## A. 백엔드 — 허브 API 클라이언트 (`backend/lib/boothApi.js`)

```js
export async function login() // POST {BOOTH_API_URL}/api/auth/boothadmin {password: BOOTH_PASSWORD}
  // 성공 시 bid를 모듈 스코프 변수에 캐싱하고 반환. 실패 시 캐싱하지 않고 throw
  // (다음 호출에서 재시도 가능해야 함 — 허브가 일시적으로 다운됐을 수 있음).
export async function fetchUser(uid) // GET {BOOTH_API_URL}/api/user/{uid}
  // 404 등 실패 시 { ok:false, status, message } 형태로 반환(throw하지 않음 —
  // 라우트가 그대로 클라이언트에 전달하기 쉽도록).
export async function addUser(uid) // bid 캐시 없으면 login() 먼저 호출 후
  // POST {BOOTH_API_URL}/api/booth/adduser {uid, bid, password: BOOTH_PASSWORD}
```

환경변수(`backend/.env`, `.env.example`에는 플레이스홀더만 커밋):
```
BOOTH_API_URL=https://34-227-8-239.sslip.io
BOOTH_PASSWORD=Y00DeJZsJZrCA4Qd
```

## B. 백엔드 — REST 라우트 (`backend/routes/checkin.js`, `/api/checkin`에 마운트)

- `GET /api/checkin/user/:uid` → `boothApi.fetchUser(uid)` 프록시. 실패 시 502/404를
  그대로 전달.
- `POST /api/checkin/consume` → 서버가 들고 있는 체크인 목록(아래 C)을 순회하며
  `boothApi.addUser(uid)`를 **순차** 호출(허브 쪽 동시 요청 부하를 피하기 위해).
  각 uid의 성공/실패를 모아 `{results: [{uid, name, status, message}]}` 반환.
  성공한 항목만 목록에서 제거하고 `checkin:list`를 재브로드캐스트한다. 실패분은
  목록에 남아 버튼 재클릭으로 재시도 가능.

## C. 백엔드 — 체크인 상태 & 소켓 (`backend/socket/checkin.js`)

`backend/socket/session.js`가 소유한 `cohort.participants`를 직접 만지지 않고,
`session.js`가 아래 최소 인터페이스를 export해서 넘겨준다:

```js
// session.js에 추가로 export
export function findUnassignedParticipant() // name === null인 첫 참가자 엔트리 반환(없으면 null)
export function assignParticipantName(id, name) // 참가자 name 필드만 설정 + 관련 브로드캐스트
export function resetParticipant(id) // 해당 참가자의 name/createDone/weapon을 null로
  // 되돌림(battle 스테이지에서는 아무 것도 하지 않고 false 반환 — 기존 admin:forceFinish/
  // admin:reopenCreate와 동일한 가드 패턴) + 관련 브로드캐스트
```

`checkin.js` 자체 상태:
```js
// { deviceId, uid, name, profile_image, assignedAt }[]
const checkinList = [];
```

`registerCheckinHandlers(io, socket, sessionApi)`가 등록하는 이벤트:

- 연결 시 현재 `checkinList`를 해당 소켓에 즉시 전송(다른 상태들과 동일 패턴).
- `checkin:confirmAssign` `({uid, name, profile_image}, ack)`:
  1. 이미 `checkinList`에 같은 `uid`가 있으면 `ack({ok:false, reason:'already_checked_in'})`.
  2. `sessionApi.findUnassignedParticipant()`가 없으면 `ack({ok:false, reason:'no_device'})`.
  3. 있으면 `sessionApi.assignParticipantName(device.id, name)` 호출, 그 기기에만
     `io.to(device.id).emit('name:prefill', name)` 타겟 전송, `checkinList`에 항목
     추가, `io.emit('checkin:list', checkinList)` 브로드캐스트, `ack({ok:true})`.
- `checkin:unlink` `(uid)`: `checkinList`에서 해당 uid 제거 + 브로드캐스트(부스
  중도 이탈 대응).
- `admin:resetParticipant` `(participantId)`: `sessionApi.resetParticipant(id)` 호출 후
  성공했으면 `checkinList`에서 `deviceId === participantId`인 항목도 제거(연쇄
  정리 — 안 그러면 그 기기가 새 uid로 재배정됐을 때 옛 체크인 항목이 남아 중복
  등록됨) + `checkin:list` 브로드캐스트.
- `disconnect`: `connectedSockets`와 별개로, 해당 소켓의 `checkinList` 항목이
  있으면 제거 + 브로드캐스트(기존 `session.js`의 disconnect 정리 패턴과 동일한
  이유 — 새로고침도 기존 소켓 disconnect를 먼저 태우므로 옛 항목이 유령으로
  남지 않게 함).

`server.js`에서 `registerCheckinHandlers(io, socket, sessionApi)` 호출을
`registerSessionHandlers` 뒤에 추가.

## D. 프론트엔드 — 체크인 화면 (`frontend/admin/checkin.html` + `checkin.js`)

`display.html`/`dev-battle.html`과 동일한 패턴(독립 Preact 앱, 자체 importmap).
QR 디코딩은 `jsqr`(`https://esm.sh/jsqr@1`)를 importmap에 추가해 사용.

- `getUserMedia({video:{facingMode:'environment'}})`로 카메라 스트림 획득 →
  `<video>`에 연결. 권한 거부/기기 없음 시 안내 메시지만 표시, 스캔 루프는
  시작하지 않는다.
- `requestAnimationFrame` 루프: 비디오 프레임을 오프스크린 `<canvas>`에 그리고
  `jsQR()`로 디코딩. 스캔 중(모달 열림 등)에는 루프를 일시정지한다.
- QR 텍스트를 `JSON.parse` → `{version, uid}` 형태 검증 실패 시 조용히 무시하고
  계속 스캔. 유효하면 일시정지하고 `GET /api/checkin/user/:uid` 호출.
  - 실패(404/네트워크 오류) → 에러 토스트, 스캔 재개.
- 성공하면 확인 모달: `profile_image` + `name` 표시, "본인이 맞나요?" [예]/[아니오].
  - [아니오] → 그냥 스캔 재개.
  - [예] → `checkin:confirmAssign` emit(ack 콜백):
    - `ok:true` → 성공 토스트, 스캔 재개.
    - `reason:'no_device'` → "빈 기기가 없습니다" 에러 토스트, 스캔 재개(합의된
      동작 — 관리자가 기기를 정리한 뒤 같은 QR을 다시 스캔).
    - `reason:'already_checked_in'` → "이미 체크인된 사용자입니다" 토스트, 스캔 재개.
- 화면 하단: 현재 `checkin:list`를 실시간 표(이름/uid)로 표시, 각 행에 "연결 해제"
  버튼 → `checkin:unlink` emit(부스 중도 이탈 대응).

## E. 프론트엔드 — 참가자 이름 화면 (`frontend/src/screens/name.js`)

`NameScreen`이 `socket`의 `name:prefill` 이벤트를 구독한다. 이미 `submitted`된
상태면 무시. 아니면 `setName(prefilledName)`으로 입력 필드를 미리 채운다 — 일반
텍스트 입력이라 참가자가 자유롭게 수정 가능하며, 최종적으로 폼 제출 시 보내는
값(`participant:name`)이 항상 서버의 최종 진실이다(체크인 배정값을 덮어씀).

## F. 프론트엔드 — 관리자 대시보드 (`frontend/admin/admin.js`)

- 상단바에 "체크인 화면 열기" 버튼 추가 — `openDisplay`/`openDevBattle`과 동일한
  `window.open('/admin/checkin.html', 'gbl-checkin', ...)` 패턴.
- `checkin:list` 구독 → 대기 중인 체크인 건수 표시 + "체크인 목록 소진 (N건)"
  버튼 → `POST /api/checkin/consume` 호출, 결과(성공/실패 건수)를 알림으로 표시.
  0건일 때는 버튼 비활성화.
- `ParticipantCard`에 "기기 초기화" 버튼 추가(확인 다이얼로그 포함, 기존
  `kick`/`reopen`과 같은 패턴) → `admin:resetParticipant` emit. `battle` 단계에서는
  버튼을 숨기거나 비활성화(서버 가드와 일치).

## 예외 처리 요약

| 상황 | 처리 |
|---|---|
| 카메라 권한 거부/없음 | 안내 메시지, 스캔 루프 미시작 |
| QR 파싱 실패/형식 불일치 | 조용히 무시, 계속 스캔 |
| `/api/checkin/user/:uid` 실패 | 에러 토스트, 스캔 재개 |
| 이미 체크인된 uid 재스캔 | "이미 체크인됨" 토스트, 스캔 재개 |
| 빈 기기 없음 | "빈 기기 없음" 에러 토스트, 스캔 재개 (재시도는 관리자 수동) |
| `/api/checkin/consume` 부분 실패 | 성공분만 제거, 실패분은 목록에 남아 재시도 가능 |
| `boothApi.login()` 실패 | 캐싱 안 함(다음 호출 재시도), 라우트는 502 반환 |
| 이름 입력 후 기기 방치 이탈 | 관리자가 "기기 초기화" → 이름 초기화 + 체크인 항목 연쇄 제거 |
| 체크인 항목 있는 기기가 완전히 연결 종료 | `disconnect` 핸들러에서 체크인 항목 자동 정리 |

## 테스트

기존 컨벤션(`node:assert` + 플레인 `.test.mjs`, 별도 러너 없이 `node x.test.mjs`로
직접 실행)을 따른다.

- `backend/lib/boothApi.test.mjs`: `fetch`를 목(mock)으로 주입해 URL 조립, bid
  캐싱, 로그인 실패 시 미캐싱, `fetchUser`/`addUser` 에러 처리를 검증.
- `backend/socket/checkin.test.mjs`: `findUnassignedParticipant`/`resetParticipant`
  연동, 중복 uid 거부, `disconnect`/`admin:resetParticipant` 시 `checkinList`
  연쇄 정리를 순수 모듈 상태로 검증(실제 소켓 없이 mock io/socket 사용, 기존
  `session.js` 테스트 방식과 동일).
- 카메라·실제 QR 스캔·실제 허브 API 연동은 수동 테스트 대상(자동화된 브라우저
  검증 없이 코드 검증 후 실기기로 확인).
