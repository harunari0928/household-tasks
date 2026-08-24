/**
 * クライアント間のリアルタイム同期（WebSocket）。
 *
 * **接続はタブ内で1本だけ**張り、購読者に配り分ける。画面ごとに接続を張ると
 * ブラウザの同時接続数を無駄に食うだけでなく、再接続やハートビートの実装が
 * 画面ごとに散らばるため。購読者が増えても接続は増えない。
 *
 * 再接続後は取りこぼしを埋めるために `reconnected` を配る。購読側は自分に
 * 関係するイベントと合わせてこれを見て、状態を取り直す。
 */
export type RealtimeEvent = { type: string } & Record<string, unknown>;

type EventListener = (event: RealtimeEvent) => void;
type StatusListener = (connected: boolean) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

const eventListeners = new Set<EventListener>();
const statusListeners = new Set<StatusListener>();

let socket: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** 一度でも繋がったあとの再接続かどうか（初回接続を「復旧」と誤報しないため） */
let hasConnected = false;
/** null = 接続を試みている最中（まだ「繋がった」も「切れた」も言えない） */
let connected: boolean | null = null;

function realtimeUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/kanban/ws`;
}

function emitEvent(event: RealtimeEvent) {
  for (const listener of [...eventListeners]) listener(event);
}

function setConnected(next: boolean) {
  if (connected === next) return;
  connected = next;
  for (const listener of [...statusListeners]) listener(next);
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const ws = new WebSocket(realtimeUrl());
  socket = ws;

  ws.onopen = () => {
    reconnectAttempts = 0;
    setConnected(true);
    // 切断中に起きた変更は届いていないので、購読側に取り直させる
    if (hasConnected) emitEvent({ type: 'reconnected' });
    hasConnected = true;
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as RealtimeEvent;
      if (data && typeof data.type === 'string') emitEvent(data);
    } catch {
      // 不正なメッセージは無視する
    }
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    setConnected(false);
    if (eventListeners.size > 0 || statusListeners.size > 0) scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose が続けて呼ばれるので、ここでは閉じるだけにする
    ws.close();
  };
}

/**
 * バックオフの待ち時間を待たずに繋ぎ直す。
 * スマホがスリープから戻ったときに最大30秒も古い画面を見せないため。
 */
function reconnectNow() {
  if (eventListeners.size === 0 && statusListeners.size === 0) return;
  if (socket) return; // 生きている接続がある（切れかけならその close で再接続される）
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  connect();
}

window.addEventListener('online', reconnectNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reconnectNow();
});

/** イベントを購読する。戻り値を呼ぶと購読を解除する（接続は共有のまま残る）。 */
export function subscribeRealtime(listener: EventListener): () => void {
  eventListeners.add(listener);
  connect();
  return () => {
    eventListeners.delete(listener);
  };
}

/**
 * 接続状態の変化を購読する。
 * 状態が確定済みなら購読開始時に1回通知する（接続中は通知しない。初回ロードで
 * いきなり「切断されました」と出さないため）。
 */
export function subscribeRealtimeStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  connect();
  if (connected !== null) listener(connected);
  return () => {
    statusListeners.delete(listener);
  };
}
