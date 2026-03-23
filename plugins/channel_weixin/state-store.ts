import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface WeixinAccountState {
  token?: string;
  userId?: string;
  contextTokens?: Record<string, string>;
  updatedAt?: string;
}

function normalizeContextTokens(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1].trim().length > 0)
  );
}

export class WeixinStateStore {
  readonly rootDir: string;
  private readonly accountPath: string;
  private readonly syncCursorPath: string;

  constructor(workspace: string) {
    this.rootDir = join(workspace, '.aesyclaw', 'channels', 'weixin');
    this.accountPath = join(this.rootDir, 'account.json');
    this.syncCursorPath = join(this.rootDir, 'sync-buf.json');
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  async loadAccount(): Promise<WeixinAccountState | null> {
    try {
      const raw = await readFile(this.accountPath, 'utf-8');
      const parsed = JSON.parse(raw) as WeixinAccountState;
      return {
        token: typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token.trim() : undefined,
        userId: typeof parsed.userId === 'string' && parsed.userId.trim() ? parsed.userId.trim() : undefined,
        contextTokens: normalizeContextTokens(parsed.contextTokens),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined
      };
    } catch {
      return null;
    }
  }

  async saveAccount(next: WeixinAccountState): Promise<void> {
    await this.ensureRoot();
    const normalized: WeixinAccountState = {
      ...(next.token?.trim() ? { token: next.token.trim() } : {}),
      ...(next.userId?.trim() ? { userId: next.userId.trim() } : {}),
      contextTokens: normalizeContextTokens(next.contextTokens),
      updatedAt: new Date().toISOString()
    };
    await writeFile(this.accountPath, JSON.stringify(normalized, null, 2), 'utf-8');
  }

  async mergeAccount(update: Partial<WeixinAccountState>): Promise<WeixinAccountState> {
    const current = (await this.loadAccount()) || { contextTokens: {} };
    const next: WeixinAccountState = {
      ...current,
      ...update,
      contextTokens: {
        ...(current.contextTokens || {}),
        ...normalizeContextTokens(update.contextTokens)
      }
    };
    await this.saveAccount(next);
    return next;
  }

  async clearToken(): Promise<void> {
    const current = await this.loadAccount();
    if (!current) {
      return;
    }

    const { token: _token, ...rest } = current;
    await this.saveAccount(rest);
  }

  async deleteAccount(): Promise<void> {
    await rm(this.accountPath, { force: true });
  }

  async loadSyncCursor(): Promise<string> {
    try {
      const raw = await readFile(this.syncCursorPath, 'utf-8');
      const parsed = JSON.parse(raw) as { cursor?: unknown };
      return typeof parsed.cursor === 'string' ? parsed.cursor : '';
    } catch {
      return '';
    }
  }

  async saveSyncCursor(cursor: string): Promise<void> {
    await this.ensureRoot();
    await writeFile(this.syncCursorPath, JSON.stringify({ cursor }, null, 2), 'utf-8');
  }

  async clearSyncCursor(): Promise<void> {
    await rm(this.syncCursorPath, { force: true });
  }

  async getContextToken(peerId: string): Promise<string | undefined> {
    const account = await this.loadAccount();
    return account?.contextTokens?.[peerId];
  }

  async setContextToken(peerId: string, token: string): Promise<void> {
    const current = (await this.loadAccount()) || { contextTokens: {} };
    await this.saveAccount({
      ...current,
      contextTokens: {
        ...(current.contextTokens || {}),
        [peerId]: token
      }
    });
  }
}
