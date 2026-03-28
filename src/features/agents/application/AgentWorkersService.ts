import type { WorkerRuntimeSnapshot } from '../../../agent/domain/execution.js';

export class AgentWorkersService {
  constructor(
    private readonly args: {
      getSnapshot: () => WorkerRuntimeSnapshot;
      abortSession: (sessionKey: string) => boolean;
    }
  ) {}

  getSnapshot(): WorkerRuntimeSnapshot {
    return this.args.getSnapshot();
  }

  abortSession(sessionKey: string): { success: boolean } {
    return {
      success: this.args.abortSession(sessionKey)
    };
  }
}
