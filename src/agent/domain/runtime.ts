export interface RuntimeLifecycle {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}
