import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import resultRoutes from './routes/result.js';
import adminRoutes from './routes/admin.js';
import weaponChatRoutes from './routes/weaponChat.js';
import weaponEvaluateRoutes from './routes/weaponEvaluate.js';
import { registerSessionHandlers } from './socket/session.js';
import { registerBattleHandlers } from './socket/battle.js';
import { initErrorLog } from './lib/errorLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
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

const server = http.createServer(app);
const io = new Server(server);
initErrorLog(io);

io.on('connection', (socket) => {
  registerSessionHandlers(io, socket);
  registerBattleHandlers(io, socket);
});

server.listen(PORT, () => {
  console.log(`GBL local server listening on http://localhost:${PORT}`);
});
