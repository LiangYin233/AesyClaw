import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { AgentManager } from '../../agent/core/engine';
import { logger } from '../../platform/observability/logger';
import { SessionRepository } from '../../platform/db/repositories/session-repository';
import { extractToken, AuthService } from './auth';
import type {
  WebSocketMessage,
  ChatMessagePayload,
  RuntimeTracePayload,
  ChatStreamPayload,
} from './types';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  chatId?: string;
  isAlive?: boolean;
}

export class WebSocketHandler {
  private static instance: WebSocketHandler;
  private wss: WebSocketServer | null = null;
  private clients: Set<AuthenticatedWebSocket> = new Set();
  private sessionRepo: SessionRepository;
  private agentManager: AgentManager;

  private constructor() {
    this.sessionRepo = new SessionRepository();
    this.agentManager = AgentManager.getInstance();
  }

  static getInstance(): WebSocketHandler {
    if (!WebSocketHandler.instance) {
      WebSocketHandler.instance = new WebSocketHandler();
    }
    return WebSocketHandler.instance;
  }

  initialize(wss: WebSocketServer): void {
    this.wss = wss;

    const interval = setInterval(() => {
      this.wss!.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (ws.isAlive === false) {
          this.clients.delete(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(interval);
    });

    logger.info('WebSocket handler initialized');
  }

  async handleConnection(ws: AuthenticatedWebSocket, req: IncomingMessage): Promise<void> {
    const token = extractToken(req as any);

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    const authService = AuthService.getInstance();
    const valid = authService.verifyToken(token);

    if (!valid) {
      ws.close(4002, 'Invalid token');
      return;
    }

    ws.userId = 'admin';
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    this.clients.add(ws);
    logger.info({ userId: ws.userId }, 'WebSocket client connected');

    ws.on('message', async (data) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        await this.handleMessage(ws, message);
      } catch (error) {
        logger.error({ error }, 'Failed to handle WebSocket message');
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format',
        }));
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      logger.info({ userId: ws.userId }, 'WebSocket client disconnected');
    });

    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));
  }

  private async handleMessage(ws: AuthenticatedWebSocket, message: WebSocketMessage): Promise<void> {
    const { type } = message;

    switch (type) {
      case 'chat_message':
        await this.handleChatMessage(ws, message as unknown as ChatMessagePayload);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      default:
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${type}`,
        }));
    }
  }

  private async handleChatMessage(ws: AuthenticatedWebSocket, payload: ChatMessagePayload): Promise<void> {
    const { chatId, text } = payload;

    logger.info({ chatId, textLength: text.length }, 'Received chat message via WebSocket');

    ws.chatId = chatId;

    try {
      const agent = this.agentManager.getOrCreate(chatId);

      const thinkingTrace: WebSocketMessage = {
        type: 'runtime_trace',
        chatId,
        event: 'thinking',
        timestamp: Date.now(),
      };
      this.sendToClient(ws, thinkingTrace);

      const result = await agent.run(text);

      const finalTrace: WebSocketMessage = {
        type: 'runtime_trace',
        chatId,
        event: result.success ? 'response' : 'error',
        detail: {
          text: result.finalText,
          error: result.error,
        },
        timestamp: Date.now(),
      } as any;
      this.sendToClient(ws, finalTrace);

      const chunks = result.finalText.split('');
      for (let i = 0; i < chunks.length; i += 10) {
        const chunk = chunks.slice(i, i + 10).join('');
        const streamPayload: WebSocketMessage = {
          type: 'chat_stream',
          chatId,
          chunk,
          done: false,
        } as any;
        this.sendToClient(ws, streamPayload);
      }

      const donePayload: WebSocketMessage = {
        type: 'chat_stream',
        chatId,
        chunk: '',
        done: true,
      } as any;
      this.sendToClient(ws, donePayload);

      this.sessionRepo.upsert({
        chatId,
        channelType: 'webui',
      });

      logger.info(
        {
          chatId,
          success: result.success,
          steps: result.steps,
          toolCalls: result.toolCalls,
        },
        'Chat message processed'
      );
    } catch (error) {
      logger.error({ chatId, error }, 'Failed to process chat message');
      const errorPayload: WebSocketMessage = {
        type: 'chat_stream',
        chatId,
        chunk: '',
        done: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as any;
      this.sendToClient(ws, errorPayload);
    }
  }

  broadcast(message: WebSocketMessage, filter?: (ws: AuthenticatedWebSocket) => boolean): void {
    const payload = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        if (!filter || filter(client)) {
          client.send(payload);
        }
      }
    });
  }

  sendToClient(ws: AuthenticatedWebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  getConnectedClientsCount(): number {
    return this.clients.size;
  }
}
