import fs from 'node:fs/promises';
import path from 'node:path';
import type { PersistableMessage } from '@aesyclaw/core/types';

type SessionFile = {
  sessionId: string;
  version: number;
  messages: PersistableMessage[];
};

export class SessionFileStore {
  constructor(private sessionsDir: string) {}

  private filePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  async listSessionIds(): Promise<string[]> {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
      const files = await fs.readdir(this.sessionsDir);
      return files.filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5));
    } catch {
      return [];
    }
  }

  async load(sessionId: string): Promise<PersistableMessage[]> {
    try {
      const data = await fs.readFile(this.filePath(sessionId), 'utf-8');
      const file: SessionFile = JSON.parse(data);
      return file.messages;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return [];
      }
      throw error;
    }
  }

  async save(sessionId: string, message: PersistableMessage): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const existing = await this.load(sessionId);
    existing.push(message);
    await fs.writeFile(
      this.filePath(sessionId),
      JSON.stringify({ sessionId, version: 1, messages: existing }, null, 2),
      'utf-8',
    );
  }

  async clear(sessionId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(sessionId));
    } catch {
      // Missing session files are treated as empty histories.
    }
  }

  async replaceWithSummary(sessionId: string, summary: string): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const message: PersistableMessage = {
      role: 'assistant',
      content: summary,
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      this.filePath(sessionId),
      JSON.stringify({ sessionId, version: 1, messages: [message] }, null, 2),
      'utf-8',
    );
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
