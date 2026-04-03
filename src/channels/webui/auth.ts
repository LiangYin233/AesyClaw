import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../../platform/observability/logger';
import { configManager } from '../../features/config/config-manager';
import type { LoginRequest, LoginResponse, ApiError } from './types';

export class AuthService {
  private static instance: AuthService;
  private adminPassword: string = 'admin123';
  private validTokens: Map<string, { userId: string; expiresAt: number }> = new Map();

  private constructor() {
    this.loadAdminPassword();
    this.cleanupExpiredTokens();
    setInterval(() => this.cleanupExpiredTokens(), 60 * 60 * 1000);
  }

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private loadAdminPassword(): void {
    try {
      const config = configManager.getConfig();
      if (config?.server?.adminToken && typeof config.server.adminToken === 'string') {
        this.adminPassword = config.server.adminToken;
        logger.info('Admin password loaded from config');
      }
    } catch {
      logger.warn('Using default admin password - configure adminToken in config.toml for production');
    }
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, record] of this.validTokens.entries()) {
      if (now > record.expiresAt) {
        this.validTokens.delete(token);
      }
    }
  }

  verifyPassword(password: string): boolean {
    return password === this.adminPassword;
  }

  generateToken(): LoginResponse {
    const token = randomUUID();
    this.validTokens.set(token, {
      userId: 'admin',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    return {
      token,
      expiresIn: 24 * 60 * 60,
    };
  }

  verifyToken(token: string): boolean {
    const record = this.validTokens.get(token);
    if (!record) {
      return false;
    }

    if (Date.now() > record.expiresAt) {
      this.validTokens.delete(token);
      return false;
    }

    return true;
  }

  reloadPassword(): void {
    this.loadAdminPassword();
  }
}

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token');
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);

  if (!token) {
    const error: ApiError = {
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    };
    res.status(401).json(error);
    return;
  }

  const authService = AuthService.getInstance();

  if (!authService.verifyToken(token)) {
    const error: ApiError = {
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN',
    };
    res.status(401).json(error);
    return;
  }

  next();
}

export function loginHandler(req: Request, res: Response): void {
  const { password } = req.body as LoginRequest;

  if (!password) {
    const error: ApiError = {
      error: 'Password is required',
      code: 'VALIDATION_ERROR',
    };
    res.status(400).json(error);
    return;
  }

  const authService = AuthService.getInstance();

  if (!authService.verifyPassword(password)) {
    logger.warn({ ip: req.ip }, 'Failed login attempt');
    const error: ApiError = {
      error: 'Invalid password',
      code: 'INVALID_PASSWORD',
    };
    res.status(401).json(error);
    return;
  }

  const response = authService.generateToken();
  logger.info({ ip: req.ip }, 'Successful login');

  res.json(response);
}

export function verifyHandler(req: Request, res: Response): void {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ valid: false });
    return;
  }

  const authService = AuthService.getInstance();
  const valid = authService.verifyToken(token);

  if (valid) {
    res.json({ valid: true, user: { userId: 'admin', role: 'admin' } });
  } else {
    res.status(401).json({ valid: false });
  }
}
