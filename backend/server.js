import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import resultRoutes from './routes/result.js';
import checkinRoutes from './routes/checkin.js';
import adminRoutes from './routes/admin.js';
import weaponChatRoutes from './routes/weaponChat.js';
import weaponEvaluateRoutes from './routes/weaponEvaluate.js';
import { registerSessionHandlers } from './socket/session.js';
import { registerBattleHandlers } from './socket/battle.js';
import { registerDevBattleHandlers } from './socket/devBattle.js';
import { registerCheckinHandlers, initCheckinIo } from './socket/checkin.js';
import { initErrorLog } from './lib/errorLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const CERTS_DIR = path.join(__dirname, 'certs');

const app = express();
app.use(express.json());

// 카메라(getUserMedia)는 브라우저가 HTTPS(또는 localhost)가 아니면 아예 API 자체를
// 노출하지 않는다 — iPad(Safari/Chrome 둘 다 WebKit이라 chrome://flags 우회가 안 통함)에서
// 부스 QR 체크인 화면을 쓰려면 진짜 HTTPS가 필요하다. mkcert로 만든 로컬 CA 인증서를
// backend/certs/에 두면(README 없음 — 아래 주석이 생성 커맨드) 이 라우트로 CA 인증서를
// 내려받아 기기에 설치할 수 있다. Content-Type을 명시해야 iOS Safari가 "프로필 설치"로
// 인식한다(기본 정적 서빙 mime 추론에 맡기면 그냥 텍스트로 열려버림).
//
// 인증서 재생성 커맨드(LAN IP가 바뀌면 다시 실행):
//   mkcert -install
//   cd backend/certs && mkcert -cert-file server-cert.pem -key-file server-key.pem <LAN-IP> localhost 127.0.0.1
//   cp "$(mkcert -CAROOT)/rootCA.pem" backend/certs/rootCA.pem
app.get('/rootCA.pem', (req, res) => {
  const caPath = path.join(CERTS_DIR, 'rootCA.pem');
  if (!fs.existsSync(caPath)) {
    return res.status(404).send('로컬 HTTPS 인증서가 아직 생성되지 않았습니다.');
  }
  res.type('application/x-x509-ca-cert');
  res.sendFile(caPath);
});

app.use(express.static(path.join(__dirname, '../frontend')));
// shapes/는 레포 루트의 frontend/backend 형제 폴더(프론트/백엔드 공통 순수 로직) — 백엔드는
// 그냥 파일시스템 import로 쓰지만, 브라우저 쪽 상대 import(예: CanvasEditor.js의
// '../../../../shapes/registry.js')가 실제로 뜨려면 이 경로도 정적 서빙해야 한다.
app.use('/shapes', express.static(path.join(__dirname, '../shapes')));
// tools/는 개발자 전용 보조 도구(맵 좌표 피커, few-shot 빌더) — 부스 당일 참가자에게 노출되는
// 경로가 아니지만, few-shot 빌더는 CanvasEditor.js/shapes/의 실제 렌더링 로직을 ES 모듈로
// 그대로 재사용하므로(중복 구현 방지) file://로 직접 열면 CORS에 막혀 동작하지 않는다 —
// 이 서버를 통해 http://localhost:3000/tools/...로 열어야 한다.
app.use('/tools', express.static(path.join(__dirname, '../tools')));

app.use('/api/result', resultRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/weapon/chat', weaponChatRoutes);
app.use('/api/weapon/evaluate', weaponEvaluateRoutes);
app.use('/api/checkin', checkinRoutes);

const server = http.createServer(app);
// Cloudflare Tunnel(무료 quick tunnel)이 프록시 과정에서 "/socket.io/"의 끝 슬래시를
// 지워버리는 현상이 있다("/socket.io"로 도착). engine.io는 path 옵션 값(끝 슬래시가
// 항상 강제로 붙는다 — 옵션으로 뗄 수 없음, engine.io의 _computePath 구현이 그렇게
// 고정돼 있다)과 요청 경로를 완전 문자열 일치로 비교하므로, 슬래시가 빠지면 그 즉시
// 매칭에 실패해 체크인 화면(터널로 접속하는 쪽)의 소켓 연결이 아예 안 된다.
// Socket.IO(engine.io)가 http.Server의 'request' 이벤트에 대해 유일한 리스너로
// 등록되는 구조라(자신이 처리 못하는 요청만 원래 리스너로 위임) 보통의 Express
// 미들웨어로는 이 판정보다 먼저 개입할 방법이 없다 — 그래서 http.Server.emit 자체를
// 감싸서 'request' 이벤트가 실제로 전파되기 직전에 req.url을 정규화한다(Socket.IO의
// 리스너 등록보다 반드시 먼저 걸어야 하므로 new Server(...) 호출 전에 적용).
function normalizeSocketIoTrailingSlash(server) {
  const originalEmit = server.emit.bind(server);
  server.emit = (event, ...args) => {
    if (event === 'request') {
      const req = args[0];
      if (req.url === '/socket.io' || req.url.startsWith('/socket.io?')) {
        req.url = req.url.replace('/socket.io', '/socket.io/');
      }
    }
    return originalEmit(event, ...args);
  };
}
normalizeSocketIoTrailingSlash(server);
const io = new Server(server);
initErrorLog(io);
initCheckinIo(io);

io.on('connection', (socket) => {
  registerSessionHandlers(io, socket);
  registerBattleHandlers(io, socket);
  registerDevBattleHandlers(socket);
  registerCheckinHandlers(socket);
});

server.listen(PORT, () => {
  console.log(`GBL local server listening on http://localhost:${PORT}`);
});

// HTTPS는 별도 포트의 부가 리스너다 — 기존 게임 기기(부스 노트북)는 계속 http로 붙고,
// 카메라가 필요한 체크인 화면(iPad 등)만 이 포트로 접속한다. 같은 io 인스턴스를
// io.attach()로 두 서버 모두에 붙이므로 cohort/checkinList 등 상태는 완전히 공유된다
// (그 상태 자체가 io 객체가 아니라 각 모듈의 모듈 스코프에 있기 때문).
const certPath = path.join(CERTS_DIR, 'server-cert.pem');
const keyPath = path.join(CERTS_DIR, 'server-key.pem');
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsServer = https.createServer(
    { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
    app,
  );
  // http 쪽과 같은 이유로, io.attach()가 'request' 리스너를 다시 갈아끼우기 전에
  // 정규화를 걸어둔다.
  normalizeSocketIoTrailingSlash(httpsServer);
  io.attach(httpsServer);
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`GBL local server also listening on https://localhost:${HTTPS_PORT} (camera-capable devices)`);
  });
} else {
  console.log('backend/certs/에 인증서가 없어 HTTPS 리스너를 건너뜁니다(카메라 필요 없는 기기는 영향 없음).');
}
