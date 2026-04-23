/** @file pi-agent-core 运行时辅助函数（兼容入口）
 *
 * 本文件作为兼容层，将所有运行时辅助函数重新导出，
 * 使现有调用方无需修改导入路径。
 *
 * 具体实现已拆分到以下模块：
 * - model-builder.ts      — pi-ai Model 构建
 * - agent-tool-adapter.ts — Tool → AgentTool 适配
 * - agent-builder.ts      — Agent 实例构建
 * - message-utils.ts      — 消息提取与统计
 */

export { buildModel } from './model-builder.js';
export { toAgentTool, type PiRunStats } from './agent-tool-adapter.js';
export { buildPiAgent, type BuildPiAgentOptions } from './agent-builder.js';
export { getFinalAssistantText, collectTokenUsage } from './message-utils.js';
