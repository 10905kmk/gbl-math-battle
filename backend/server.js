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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/result', resultRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/weapon/chat', weaponChatRoutes);
app.use('/api/weapon/evaluate', weaponEvaluateRoutes);

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  registerSessionHandlers(io, socket);
  registerBattleHandlers(io, socket);
});

server.listen(PORT, () => {
  console.log(`GBL local server listening on http://localhost:${PORT}`);
});
