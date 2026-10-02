/**
 * Tiempo real (sección 19). Servidor WebSocket adjunto al mismo HTTP server.
 *
 * El servidor solo EMITE señales de cambio (p.ej. "el inventario cambió"); los
 * datos siguen viajando por la API REST autenticada. Así el frontend se
 * actualiza sin refrescar manualmente, sin exponer datos sensibles por el WS.
 */
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

export type RealtimeEvent =
  | { type: "hello"; time: string }
  | { type: "printers:changed"; reason?: string; at: string };

export interface Realtime {
  broadcast(event: RealtimeEvent): void;
  clientCount(): number;
  close(): void;
}

export function createRealtime(server: Server, path = "/ws"): Realtime {
  // maxPayload acota el tamaño de frame que un cliente puede enviar (el server
  // solo emite señales; no necesita recibir nada grande).
  const wss = new WebSocketServer({ server, path, maxPayload: 64 * 1024 });

  // Latido: marca cada socket como "vivo", y un temporizador termina los que no
  // responden al ping. Sin esto, conexiones medio-abiertas (laptop suspendida,
  // VPN caída) quedarían en `wss.clients` para siempre y cada broadcast les
  // escribiría en vano, acumulando memoria y trabajo.
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("connection", (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.send(JSON.stringify({ type: "hello", time: new Date().toISOString() }));
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      try {
        client.ping();
      } catch {
        client.terminate();
      }
    }
  }, 30_000);
  heartbeat.unref?.();

  console.log(`[realtime] WebSocket en ws://<host>${path}`);

  return {
    broadcast(event) {
      const data = JSON.stringify(event);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(data);
      }
    },
    clientCount() {
      return wss.clients.size;
    },
    close() {
      clearInterval(heartbeat);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
