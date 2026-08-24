import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

/**
 * クライアント間のリアルタイム同期（WebSocket）。
 *
 * 画面の再描画トリガーを配るだけの一方向ブロードキャストで、
 * クライアントからのメッセージは受け取らない（更新は従来どおり REST）。
 * 受信側は種類に応じて自分でフェッチし直す。
 */
export const REALTIME_PATH = '/api/kanban/ws';

/** 死んだ接続を掃除する間隔。ping に pong が返らなければ切る。 */
const HEARTBEAT_INTERVAL_MS = 30_000;

const clients = new Set<WebSocket>();

export function broadcast(event: object) {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    try {
      client.send(data);
    } catch {
      // 送信中に切れた接続は heartbeat / close で片付く
    }
  }
}

export function attachRealtime(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: REALTIME_PATH });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);

    // モバイルのスリープや NAT のタイムアウトで、close が飛んでこないまま
    // 死ぬ接続がある。pong が返らない接続を切らないと clients に溜まり続ける。
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate(); // close イベント経由で後片付けされる
        return;
      }
      alive = false;
      ws.ping();
    }, HEARTBEAT_INTERVAL_MS);

    ws.on('close', () => {
      clients.delete(ws);
      clearInterval(heartbeat);
    });
    ws.on('error', () => {
      ws.terminate();
    });
  });

  return wss;
}
