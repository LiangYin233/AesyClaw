/** plugin_webui WebSocket handler — auth, message dispatch, and heartbeat. */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { createScopedLogger, subscribeToLogEntries, type PluginContext } from '@aesyclaw/sdk';
import { dispatchMessage } from './dispatcher';
import type { WsMessage } from './types';
import type { WebuiAuthManager } from '../auth';

const logger = createScopedLogger('plugin_webui:ws');
const HEARTBEAT_INTERVAL_MS = 30_000;

export function createWebSocketServer(
  httpServer: Server,
  ctx: PluginContext,
  auth: WebuiAuthManager,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url;
    if (!url?.startsWith('/api/ws')) {
      socket.destroy();
      return;
    }

    const authResult = auth.validateRequest(request);
    if (!authResult.ok) {
      logger.warn('WebSocket 连接鉴权失败', { status: authResult.status });
      if (authResult.retryAfterSeconds !== undefined) {
        socket.write(
          `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${authResult.retryAfterSeconds}\r\n\r\n`,
        );
      } else {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      }
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    logger.info('WebSocket 客户端已连接');

    const aliveWs = ws as WebSocket & { clientAlive: boolean };
    aliveWs.clientAlive = true;
    let pongTimeout: ReturnType<typeof setTimeout> | null = null;

    const cleanupCallbacks: Array<() => void> = [];
    let cleanedUp = false;
    const cleanupConnection = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      for (const cleanup of cleanupCallbacks.splice(0)) cleanup();
      if (pongTimeout) clearTimeout(pongTimeout);
    };

    const resetPongTimer = (): void => {
      if (pongTimeout) clearTimeout(pongTimeout);
      pongTimeout = setTimeout(() => {
        logger.warn('WebSocket 客户端心跳超时，断开连接');
        cleanupConnection();
        ws.terminate();
      }, HEARTBEAT_INTERVAL_MS * 2 + 5_000);
    };
    resetPongTimer();

    ws.on('pong', () => {
      aliveWs.clientAlive = true;
      resetPongTimer();
    });

    const heartbeatTimer = setInterval(() => {
      if (!aliveWs.clientAlive) {
        cleanupConnection();
        ws.terminate();
        return;
      }
      aliveWs.clientAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        ws.send(JSON.stringify({ type: 'ping', ok: true }));
      }
    }, HEARTBEAT_INTERVAL_MS);
    cleanupCallbacks.push(() => clearInterval(heartbeatTimer));

    cleanupCallbacks.push(
      subscribeToLogEntries((entry) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'log_entry', ok: true, data: entry }));
      }),
    );

    ws.on('message', (raw) => {
      void handleWsMessage(raw, ws, ctx);
    });
    ws.on('close', () => {
      cleanupConnection();
      logger.info('WebSocket 客户端已断开');
    });
    ws.on('error', (err) => {
      cleanupConnection();
      logger.error('WebSocket 连接错误', err);
    });
  });

  return wss;
}

async function handleWsMessage(raw: unknown, ws: WebSocket, ctx: PluginContext): Promise<void> {
  let msg: WsMessage;
  try {
    const text = raw instanceof Buffer ? raw.toString() : String(raw);
    msg = JSON.parse(text) as WsMessage;
  } catch {
    ws.send(JSON.stringify({ type: 'error', ok: false, error: '无效的 JSON 消息' }));
    return;
  }

  if (msg.type === 'pong') {
    (ws as WebSocket & { clientAlive: boolean }).clientAlive = true;
    return;
  }

  try {
    const response = await dispatchMessage(msg, ctx);
    ws.send(JSON.stringify({ ...response, requestId: msg.requestId }));
  } catch (err) {
    logger.error('处理 WS 消息时未捕获错误', err);
    ws.send(
      JSON.stringify({
        type: msg.type,
        requestId: msg.requestId,
        ok: false,
        error: '内部服务器错误',
      }),
    );
  }
}
