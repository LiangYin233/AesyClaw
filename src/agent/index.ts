export { AgentLoop } from './core/AgentLoop.js';
export { ContextBuilder } from './core/ContextBuilder.js';
export type { ContextMode, ExecutionStatus } from './core/AgentLoop.js';

export { AgentExecutor } from './executor/AgentExecutor.js';
export { ToolLoopRunner } from './executor/ToolLoopRunner.js';
export { SyncStrategy, BackgroundStrategy, VisionStrategy } from './executor/strategies.js';
export type { ExecuteOptions, AgentResult } from './executor/AgentExecutor.js';
export type {
  ExecutionStrategy,
  ExecutionResult,
  ExecutionOptions,
  BackgroundExecutionResult,
  LLMCallOptions,
  VisionSettings
} from './executor/types.js';

export { ExecutionRegistry } from './execution/registry/ExecutionRegistry.js';
export type { ForegroundExecutionHandle } from './execution/registry/ExecutionRegistry.js';
export { ExecutionCompletionService } from './execution/registry/ExecutionCompletionService.js';

export { MessagePreprocessingService } from './messaging/MessagePreprocessingService.js';

export { SessionRoutingService } from './routing/SessionRoutingService.js';
export { ExecutionCoordinator } from './routing/ExecutionCoordinator.js';

export { BackgroundTaskManager } from './state/BackgroundTaskManager.js';
export type {
  BackgroundTaskExecutor,
  BackgroundTaskCallbacks,
  BackgroundTaskHandle,
  BackgroundTaskResult
} from './state/BackgroundTaskManager.js';

export { isVisionableFile } from './vision.js';
