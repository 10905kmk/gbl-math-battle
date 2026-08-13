# 부스 체크인 HTTPS 설정 가이드 (Windows 11 부스 서버용)

카메라(`getUserMedia`)는 브라우저가 HTTPS(또는 `localhost`)가 아니면 아예 API를
막아버린다. 부스 게임 자체는 계속 `http://<부스서버IP>:3000`으로 문제없이
돌아가지만, 체크인 화면(카메라 필요)만 `https://<부스서버IP>:3443`으로 접속해야
한다. 이 문서는 실제 부스 서버(Windows 11 노트북)의 LAN IP를 알게 됐을 때 그
서버에서 HTTPS가 동작하도록 인증서를 준비하는 절차다.

## 핵심 원리 요약

- `backend/server.js`는 `backend/certs/`에 `server-cert.pem`/`server-key.pem`이
  있으면 자동으로 3443 포트에 HTTPS 리스너를 추가로 띄운다(없으면 조용히
  건너뛰고 기존 http만 동작 — 안전).
- 이 인증서는 **특정 IP 주소 하나에 고정**된다(`mkcert ... <IP> ...`로 발급
  시점에 그 IP를 박아 넣음). 부스 서버의 실제 IP가 바뀌면 인증서도 다시 발급해야
  한다.
- 아이패드/기기에는 **CA(인증기관) 인증서**(`rootCA.pem`)를 한 번만 설치하면
  된다. 이후 **같은 CA로 발급한 인증서라면 서버 IP가 바뀌어도 기기 쪽은 아무
  것도 다시 할 필요 없다** — 서버 쪽 인증서 파일 3개만 새로 교체하면 끝.
  그래서 아래 방법 A(개발 머신을 "인증서 공장"으로 계속 쓰는 방법)를 권장한다.

## 방법 A — 개발 머신에서 발급받아 복사(권장, 기기 재설정 불필요)

이미 이 저장소를 작업한 개발 머신(Linux)에 mkcert CA가 만들어져 있다. 부스
서버의 실제 LAN IP를 알게 되면:

1. 개발 머신에서 그 IP로 인증서를 새로 발급한다:
   ```bash
   cd backend/certs
   mkcert -cert-file server-cert.pem -key-file server-key.pem <부스서버-IP> localhost 127.0.0.1
   ```
   (`rootCA.pem`은 이미 같은 폴더에 있으면 다시 복사할 필요 없다 — CA 자체는
   안 바뀌었으므로.)
2. `backend/certs/` 폴더 안의 **3개 파일**(`server-cert.pem`, `server-key.pem`,
   `rootCA.pem`)을 그대로 Windows 11 부스 서버의 같은 경로(`backend/certs/`)에
   복사한다(USB, 파일 공유 등 아무 방법이나 가능 — 이 폴더는 `.gitignore`
   대상이라 git으로는 안 넘어간다).
3. 아이패드는 **이미 이 CA를 신뢰하도록 설정돼 있다면 추가 작업 없음** — 새
   IP의 인증서도 같은 CA가 서명했으므로 그대로 통한다.

## 방법 B — Windows 11에서 직접 발급(개발 머신 접근이 어려울 때)

1. mkcert를 설치한다(관리자 권한 필요 없음, 아래 둘 중 하나):
   - [mkcert GitHub Releases](https://github.com/FiloSottile/mkcert/releases)에서
     `mkcert-vX.X.X-windows-amd64.exe`를 받아 `mkcert.exe`로 이름을 바꿔 아무
     폴더에나 둔다.
   - 또는 `winget install FiloSottile.mkcert` / `choco install mkcert` /
     `scoop install mkcert` (있는 도구 아무거나).
2. PowerShell에서 부스 서버의 LAN IP 확인:
   ```powershell
   ipconfig
   ```
   `IPv4 주소` 항목이 그 값이다(예: `192.168.0.42`).
3. 인증서 발급:
   ```powershell
   mkcert -install
   cd backend\certs
   mkcert -cert-file server-cert.pem -key-file server-key.pem <IPv4-주소> localhost 127.0.0.1
   copy "$(mkcert -CAROOT)\rootCA.pem" rootCA.pem
   ```
4. 이 경우 **CA가 방법 A의 CA와 다른 새 CA**이므로, 아이패드에 이 새
   `rootCA.pem`을 다시 설치해야 한다(아래 "기기에 CA 설치하기" 참고). 방법 A로
   이미 아이패드 설정을 마쳤다면, 굳이 이 방법을 쓸 필요 없이 방법 A를 계속
   쓰는 편이 훨씬 편하다.

## Windows 방화벽에서 3443 포트 열기

포트 3000이 이미 다른 기기에서 접속 가능했다면 방화벽 규칙이 있을 텐데, 새
포트(3443)는 별도로 허용해야 할 수 있다. PowerShell(관리자 권한)에서:

```powershell
New-NetFirewallRule -DisplayName "GBL Booth HTTPS" -Direction Inbound -LocalPort 3443 -Protocol TCP -Action Allow
```

또는 제어판 → Windows Defender 방화벽 → 고급 설정 → 인바운드 규칙 → 새 규칙 →
포트 → TCP 3443 → 연결 허용.

## 서버 재시작 & 확인

```powershell
cd backend
npm run start
```

콘솔에 아래 두 줄이 모두 보이면 정상이다:

```
GBL local server listening on http://localhost:3000
GBL local server also listening on https://localhost:3443 (camera-capable devices)
```

(인증서 파일이 없으면 두 번째 줄 대신 "인증서가 없어 HTTPS 리스너를
건너뜁니다" 메시지가 뜬다 — 그러면 `backend/certs/`에 파일 3개가 제대로
들어갔는지 다시 확인.)

## 기기에 CA 설치하기 (최초 1회, 기기당)

1. 그 기기 브라우저에서 `http://<부스서버-IP>:3000/rootCA.pem` 접속.
2. **iPad**: Safari가 "구성 프로파일 다운로드" 안내를 띄우면 허용 → 설정 →
   일반 → VPN 및 기기 관리 → 다운로드된 프로파일 탭 → 설치(암호 입력) → 설치
   재확인 → **설정 → 일반 → 정보 → 인증서 신뢰 설정**에서 이 CA의 "루트
   인증서 전체 신뢰"를 켠다(이 마지막 단계를 빠뜨리면 여전히 경고가 뜬다).
   - 학교 관리(MDM) 아이패드라면 1번 단계에서 다운로드 프롬프트 자체가 안 뜰
     수 있다 — 그럴 땐 터널 방식(별도 안내)으로 전환.
3. **Windows(Chrome/Edge)**: 다운로드된 `rootCA.pem`을 더블클릭 → 인증서 설치
   → 로컬 컴퓨터 → "다음 저장소에 모든 인증서 저장" → "신뢰할 수 있는 루트
   인증 기관" 선택 → 마침.

설치 후 `https://<부스서버-IP>:3443/admin/checkin.html`로 접속하면 경고 없이
바로 열리고, 카메라 권한 요청이 정상적으로 뜬다.

## 폴백 — CA 설치가 막힌 기기(학교 관리 아이패드 등)를 위한 터널 방식

MDM으로 프로파일 설치 자체가 막혀 있으면 위 방법은 아예 시도조차 안 될 수 있다.
이 경우 **Cloudflare Tunnel**로 로컬 서버를 임시 공개 HTTPS 주소로 노출시키면,
Cloudflare가 이미 모든 브라우저가 신뢰하는 진짜 인증서로 서비스해주므로 기기
쪽 설정이 아예 필요 없다.

### 준비

1. [cloudflared 다운로드 페이지](https://github.com/cloudflare/cloudflared/releases/latest)에서
   `cloudflared-windows-amd64.exe`를 받아 `cloudflared.exe`로 이름을 바꿔 아무
   폴더에나 둔다(관리자 권한, 설치 절차 필요 없음).
2. 그 폴더를 PATH에 추가하거나, 아래 명령을 그 폴더에서 직접 실행한다.

### 실행

```powershell
cloudflared tunnel --url http://localhost:3000
```

(`backend/package.json`에 `npm run tunnel`로도 등록해 뒀다 — `cloudflared`가
PATH에 잡혀 있으면 그냥 `npm run tunnel`로 실행 가능.)

콘솔에 아래처럼 임시 URL이 뜬다:

```
Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):
https://<임의문자열>.trycloudflare.com
```

그 뒤에 `/admin/checkin.html`을 붙여서 접속하면 된다(예:
`https://retain-bonus-socks-dive.trycloudflare.com/admin/checkin.html`). 카메라
권한 요청이 바로 뜬다 — 인증서 경고도, 기기 설정도 없다.

### 실제로 검증된 사항

- **HTTP(3000) 쪽을 그대로 가리키면 된다** — HTTPS(3443, mkcert 인증서) 쪽을
  가리킬 필요 없다. 터널 자체가 이미 진짜 HTTPS를 제공하므로 로컬 인증서가
  이중으로 개입할 이유가 없다(오히려 자체서명 인증서를 또 거치면 설정이
  복잡해진다).
- **소켓 통신(체크인 목록 실시간 갱신 등)은 polling 트랜스포트로 정상 동작한다**
  — 무료 quick tunnel은 구조상(HTTP/2 프록시) 웹소켓 업그레이드가 안 되지만,
  Socket.IO가 자동으로 polling으로 남아서 계속 통신한다. 실제 연결 테스트로
  확인함 — 체감 지연은 거의 없다.
- **`backend/server.js`에 이미 필요한 처리가 들어있다** — Cloudflare Tunnel이
  `/socket.io/` 요청의 끝 슬래시를 지워버리는 현상이 있어서(`/socket.io/` →
  `/socket.io`) 서버가 그 요청을 못 알아보는 문제가 있었는데, 이미 고쳐져 있다
  (`server.js`의 `normalizeSocketIoTrailingSlash` 참고). 별도 조치 불필요.

### 주의

- 계정 없는 "quick tunnel"은 Cloudflare 스스로 "테스트용, 프로덕션 사용
  비권장"이라고 명시한다 — 하루짜리 부스 이벤트에는 적합하지만, `cloudflared`
  프로세스가 죽으면 URL도 같이 사라진다(재실행하면 새 URL이 발급됨 — 이전
  URL은 못 씀).
- 인터넷 연결이 필요하다(로컬 LAN만으로는 안 됨) — 학교 와이파이가 이 트래픽을
  막고 있지 않은지 미리 확인해두면 좋다.
- `cloudflared` 프로세스를 켜둔 콘솔 창을 닫으면 터널도 끊긴다 — 부스 운영
  중에는 그 창을 계속 띄워둘 것.
