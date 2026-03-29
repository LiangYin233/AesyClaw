import type { WorkerRuntimeSnapshot } from '../../../platform/context/WorkerContext.js';

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
