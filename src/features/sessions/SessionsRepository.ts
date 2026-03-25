import { SessionManager } from '../../session/SessionManager.js';
import { SessionValidationError } from '../../session/errors.js';

export class SessionsRepository {
  constructor(private readonly sessionManager: SessionManager) {}

  list() {
    return this.sessionManager.list();
  }

  count(): number {
    return this.sessionManager.count();
  }

  async getByKeyOrThrow(key: string) {
    return this.sessionManager.getExistingOrThrow(key);
  }

  async deleteByKey(key: string): Promise<void> {
    await this.sessionManager.delete(key);
  }

  validateKey(key: string): void {
    try {
      SessionManager.validateSessionKey(key);
    } catch (error) {
      if (error instanceof SessionValidationError) {
        throw error;
      }
      throw error;
    }
  }
}
