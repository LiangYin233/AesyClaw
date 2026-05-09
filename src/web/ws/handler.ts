/** WebSocket 连接处理器 — 鉴权、消息接收/发送、心跳。 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import { dispatchMessage } from './dispatcher';
import type { WsMessage } from './types';
import { createScopedLogger, subscribeToLogEntries } from '@aesyclaw/core/logger';

const logger = createScopedLogger('webui:ws');

const HEARTBEAT_INTERVAL_MS = 30_000;

function safeTokenEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * 验证 WebSocket upgrade 请求的 token。
 */
function validateWsToken(requestUrl: string | undefined, configManager: ConfigManager): boolean {
  const authToken = configManager.get('server.authToken') as string | undefined;
  if (!authToken) {
    logger.error('WebSocket 鉴权 token 未配置，拒绝所有连接');
    return false;
  }

  if (!requestUrl) {
    return false;
  }

  try {
    const parsed = new URL(requestUrl, 'http://localhost');
    const token = parsed.searchParams.get('token');
    if (!token) {
      return false;
    }
    return safeTokenEqual(token, authToken);
  } catch {
    return false;
  }
}

/**
 * 创建 WebSocket 服务器并绑定到 HTTP server。
 * 使用 `noServer: true` 模式，通过 HTTP server 的 upgrade 事件处理。
 */
export function createWebSocketServer(
  httpServer: Server,
  deps: WebUiManagerDependencies,
): WebSocketServer {
  const configManager = deps.configManager;
  const wss = new WebSocketServer({ noServer: true });

  // 处理 HTTP upgrade
  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url;

    // 只处理 /api/ws 路径
    if (!url?.startsWith('/api/ws')) {
      socket.destroy();
      return;
    }

    // 鉴权
    if (!validateWsToken(url, configManager)) {
      logger.warn('WebSocket 连接鉴权失败');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  // 处理连接
  wss.on('connection', (ws: WebSocket) => {
    logger.info('WebSocket 客户端已连接');

    const CLIENT_ALIVE_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2 + 5_000;

    const aliveWs = ws as WebSocket & { clientAlive: boolean };
    aliveWs.clientAlive = true;
    let pongTimeout: ReturnType<typeof setTimeout> | null = null;

    const resetPongTimer = (): void => {
      if (pongTimeout) {
        clearTimeout(pongTimeout);
      }
      pongTimeout = setTimeout(() => {
        logger.warn('WebSocket 客户端心跳超时，断开连接');
        cleanupConnection();
        ws.terminate();
      }, CLIENT_ALIVE_TIMEOUT_MS);
    };

    resetPongTimer();

    // 协议级心跳：服务端 ping，客户端浏览器自动回复 pong
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
      }
    }, HEARTBEAT_INTERVAL_MS);

    // 日志订阅：向客户端推送新日志条目
    const unsubscribeFromLogs = subscribeToLogEntries((entry) => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }

      ws.send(
        JSON.stringify({
          type: 'log_entry',
          ok: true,
          data: entry,
        }),
      );
    });

    let cleanedUp = false;
    const cleanupConnection = (): void => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      unsubscribeFromLogs();
      clearInterval(heartbeatTimer);
      if (pongTimeout) {
        clearTimeout(pongTimeout);
      }
    };

    // 消息处理
    ws.on('message', (raw) => {
      void handleWsMessage(raw, ws, deps);
    });

    // 连接关闭
    ws.on('close', () => {
      cleanupConnection();
      logger.info('WebSocket 客户端已断开');
    });

    // 错误处理
    ws.on('error', (err) => {
      cleanupConnection();
      logger.error('WebSocket 连接错误', err);
    });
  });

  return wss;
}

async function handleWsMessage(
  raw: unknown,
  ws: WebSocket,
  deps: WebUiManagerDependencies,
): Promise<void> {
  let msg: WsMessage;
  try {
    const text = raw instanceof Buffer ? raw.toString() : String(raw);
    msg = JSON.parse(text) as WsMessage;
  } catch {
    ws.send(JSON.stringify({ type: 'error', ok: false, error: '无效的 JSON 消息' }));
    return;
  }

  // 处理 pong 消息（心跳回复，同时支持协议级和 JSON 级 pong）
  if (msg.type === 'pong') {
    (ws as WebSocket & { clientAlive: boolean }).clientAlive = true;
    return;
  }

  // 分发消息到对应的 service handler
  try {
    const response = await dispatchMessage(msg, deps);
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
