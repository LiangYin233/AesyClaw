export { AgentLoop } from './core/AgentLoop.js';
export { ContextBuilder } from './execution/engine/ContextBuilder.js';
export type { ContextMode, ExecutionStatus } from './core/AgentLoop.js';

export { AgentExecutor } from './execution/engine/AgentExecutor.js';
export { ToolLoopRunner } from './execution/engine/ToolLoopRunner.js';
export { SyncStrategy, BackgroundStrategy, VisionStrategy } from './execution/engine/strategies.js';
export type {
  ExecutionStrategy,
  ExecutionResult,
  ExecutionOptions,
  BackgroundExecutionResult,
  LLMCallOptions,
  VisionSettings
} from './execution/engine/types.js';

export { ExecutionRegistry } from './execution/ExecutionRegistry.js';
export type { ForegroundExecutionHandle } from './execution/ExecutionRegistry.js';
export { ExecutionFinalizeService } from './execution/ExecutionFinalizeService.js';

export { MessagePreprocessingService } from './messaging/MessagePreprocessingService.js';

export { SessionRoutingService } from './session/SessionRoutingService.js';
export { ExecutionCoordinator } from './execution/ExecutionCoordinator.js';

export { BackgroundTaskManager } from './execution/BackgroundTaskManager.js';
export type {
  BackgroundTaskExecutor,
  BackgroundTaskCallbacks,
  BackgroundTaskHandle,
  BackgroundTaskResult
} from './execution/BackgroundTaskManager.js';

export { isVisionableFile } from './execution/engine/vision.js';
