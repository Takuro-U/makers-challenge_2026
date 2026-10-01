import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { handleConnection } from './connection.js';
import { startHeartbeat } from './heartbeat.js';
import { serveStatic } from './static.js';

const port = Number(process.env.PORT ?? 3000);

const server = createServer(serveStatic);

const wss = new WebSocketServer({ server, path: '/ws' });
startHeartbeat(wss);
wss.on('connection', handleConnection);

server.listen(port, () => {
  console.log(`backend listening on :${port}`);
});
