import { useEffect, useRef } from 'react';
import {
  subscribeRealtime,
  subscribeRealtimeStatus,
  type RealtimeEvent,
} from '../lib/realtime.js';

/**
 * 共有WebSocket（タブ内で1本）のイベントを購読する。
 * ハンドラは ref 経由で呼ぶので、毎レンダー新しい関数を渡しても再購読しない。
 */
export function useRealtimeEvent(handler: (event: RealtimeEvent) => void) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => subscribeRealtime((event) => handlerRef.current(event)), []);
}

/** 共有WebSocketの接続状態の変化を購読する（切断の通知などに使う）。 */
export function useRealtimeStatus(handler: (connected: boolean) => void) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => subscribeRealtimeStatus((isConnected) => handlerRef.current(isConnected)), []);
}
