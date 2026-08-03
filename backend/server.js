import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import weaponRoutes from './routes/weapon.js';
import resultRoutes from './routes/result.js';
import adminRoutes from './routes/admin.js';
import { registerSessionHandlers } from './socket/session.js';
import { registerBattleHandlers } from './socket/battle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/weapon', weaponRoutes);
app.use('/api/result', resultRoutes);
app.use('/api/admin', adminRoutes);

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  registerSessionHandlers(io, socket);
  registerBattleHandlers(io, socket);
});

server.listen(PORT, () => {
  console.log(`GBL local server listening on http://localhost:${PORT}`);
});
