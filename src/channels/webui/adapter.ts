import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { logger } from '../../platform/observability/logger';
import { createWebUIRouter } from './router';
import { authMiddleware, extractToken, AuthService, loginHandler, verifyHandler } from './auth';
import { WebSocketHandler } from './ws-handler';
import { configManager } from '../../features/config/config-manager';
import type { ApiError } from './types';

export class WebUIAdapter {
  private static instance: WebUIAdapter;
  private app: Express | null = null;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private wsHandler: WebSocketHandler;
  private port: number = 3001;
  private isRunning: boolean = false;

  private constructor() {
    this.wsHandler = WebSocketHandler.getInstance();
  }

  static getInstance(): WebUIAdapter {
    if (!WebUIAdapter.instance) {
      WebUIAdapter.instance = new WebUIAdapter();
    }
    return WebUIAdapter.instance;
  }

  async initialize(): Promise<void> {
    if (this.isRunning) {
      logger.warn('WebUIAdapter is already running');
      return;
    }

    this.app = express();

    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    }));

    this.app.use(express.json());

    this.app.use((req: Request, res: Response, next: NextFunction) => {
      logger.debug({ method: req.method, path: req.path }, 'Incoming request');
      next();
    });

    this.app.post('/api/auth/login', loginHandler);
    this.app.get('/api/auth/verify', verifyHandler);

    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        webui: this.isRunning,
        timestamp: new Date().toISOString(),
      });
    });

    this.app.get('/ready', (req, res) => {
      const checks = {
        config: this.checkConfig(),
        websocket: this.wss !== null,
      };
      const ok = Object.values(checks).every(Boolean);
      res.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'degraded',
        checks,
      });
    });

    this.app.use('/api', createWebUIRouter());

    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
      const error: ApiError = {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      };
      res.status(500).json(error);
    });

    this.wss = new WebSocketServer({
      noServer: true,
      path: '/ws',
    });

    this.wss.on('connection', (ws, req) => {
      this.wsHandler.handleConnection(ws as any, req);
    });

    this.wsHandler.initialize(this.wss);

    logger.info('WebUIAdapter initialized');
  }

  private checkConfig(): boolean {
    try {
      configManager.getConfig();
      return true;
    } catch {
      return false;
    }
  }

  async start(port?: number): Promise<void> {
    if (this.isRunning) {
      logger.warn('WebUIAdapter is already running');
      return;
    }

    if (!this.app) {
      await this.initialize();
    }

    this.port = port || this.port;

    return new Promise((resolve, reject) => {
      if (!this.app) {
        reject(new Error('App not initialized'));
        return;
      }

      this.server = this.app.listen(this.port, () => {
        this.isRunning = true;
        logger.info({ port: this.port }, '🚀 WebUI API Server started');

        const authService = AuthService.getInstance();
        authService.reloadPassword();
      });

      this.server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url || '', `http://localhost:${this.port}`);

        if (url.pathname === '/ws') {
          this.wss!.handleUpgrade(request, socket, head, (ws) => {
            this.wss!.emit('connection', ws, request);
          });
        } else {
          socket.destroy();
        }
      });

      this.server.on('error', (error) => {
        logger.error({ error }, 'Server error');
        reject(error);
      });

      resolve();
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          logger.info('WebUIAdapter stopped');
          resolve();
        });
      } else {
        this.isRunning = false;
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }

  isServerRunning(): boolean {
    return this.isRunning;
  }

  getConnectedClientsCount(): number {
    return this.wsHandler.getConnectedClientsCount();
  }
}
