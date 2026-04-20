/** @file 消息处理流水线运行时
 *
 * 创建并管理 ChannelPipeline 实例，按顺序注册中间件：
 * 1. ConfigStage      — 懒初始化配置管理器
 * 2. SessionStage      — 获取或创建会话
 * 3. CommandMiddleware — 检测并执行命令
 * 4. AgentStage        — 调用 LLM Agent 生成回复
 *
 * 通过 pipelineRef 与 ChannelRuntime 共享管道实例，
 * 使频道插件可以通过 pipeline.receiveWithSend() 注入消息。
 */

import { agentStage } from '@/agent/runtime/agent-message-stage.js';
import { ChannelPipeline } from '@/agent/pipeline.js';
import { createSessionStage } from '@/agent/session/session-runtime.js';
import { ChatService } from '@/agent/session/session-service.js';
import type { ConfigManagerService } from '@/contracts/runtime-services.js';
import { createCommandMiddleware } from '@/features/commands/command-middleware.js';
import { CommandManager } from '@/features/commands/command-registry.js';
import { createConfigStage } from '@/features/config/config-message-stage.js';
import { PluginManager } from '@/features/plugins/plugin-manager.js';

interface PipelineRuntimeDependencies {
    pluginManager: PluginManager;
    chatService: ChatService;
    commandManager: CommandManager;
    configManager: ConfigManagerService;
    pipelineRef: { current: ChannelPipeline | null };
}

/** 消息处理流水线运行时
 *
 * 管理中间件链的创建与销毁。start() 创建管道并注册所有中间件，
 * stop() 释放管道引用使频道插件无法再注入消息。
 */
export class PipelineRuntime {
    constructor(private readonly deps: PipelineRuntimeDependencies) {}

    /** 创建管道并按顺序注册中间件 */
    start(): void {
        const pipeline = new ChannelPipeline(this.deps.pluginManager);
        pipeline.use(
            createConfigStage({
                isInitialized: () => this.deps.configManager.isInitialized(),
                initialize: () => this.deps.configManager.initialize(),
                getConfig: () => this.deps.configManager.config,
            }),
        );
        pipeline.use(createSessionStage(this.deps.chatService));
        pipeline.use(createCommandMiddleware(this.deps.commandManager));
        pipeline.use(agentStage);
        this.deps.pipelineRef.current = pipeline;
    }

    /** 释放管道引用，使后续消息注入失败 */
    stop(): void {
        this.deps.pipelineRef.current = null;
    }
}
