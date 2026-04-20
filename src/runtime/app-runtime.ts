/** @file 应用运行时主编排器
 *
 * AppRuntime 是整个 AesyClaw 系统的顶层控制器，负责按序启动和关闭所有子系统。
 *
 * 启动顺序（runInitStages）：
 * 1. initializeCoreInfrastructure — PathResolver → ConfigManager → SQLiteManager
 * 2. initializeDomainServices     — SkillManager → RoleManager
 * 3. pipelineRuntime.start()      — 创建消息处理中间件链
 * 4. systemRuntime.register()      — 注册系统工具与命令
 * 5. pluginRuntime.start()         — 初始化并加载插件
 * 6. cronRuntime.start()           — 启动定时任务
 * 7. startManagedRuntimes           — MCP → Channel → 配置同步 → 热重载监听
 *
 * 关闭顺序（stop）与启动相反：
 * 先停止外部连接（Channel → Cron → MCP），再停止内部服务
 * （Plugin → Pipeline → System → SQLite → Skill → Role → Config），
 * 确保不再有新消息进入系统后再释放资源。
 */

import { ChannelRuntime } from '@/channels/channel-runtime.js';
import { PluginRuntime } from '@/features/plugins/plugin-runtime.js';
import { logger } from '@/platform/observability/logger.js';
import { McpRuntime } from '@/platform/tools/mcp/mcp-runtime.js';
import { ToolManager } from '@/platform/tools/registry.js';
import type {
    ChatSessionStore,
    ConfigManagerService,
    PathResolverService,
    RoleManagerService,
    SkillManagerService,
    SQLiteManagerService,
} from '@/contracts/runtime-services.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { CronRuntime } from '@/runtime/cron-runtime.js';
import { PipelineRuntime } from '@/runtime/pipeline-runtime.js';
import { SystemRuntime } from '@/runtime/system-runtime.js';

/** AppRuntime 的依赖注入接口，包含所有子系统与核心服务 */
interface AppRuntimeDependencies {
    toolManager: ToolManager;
    pluginRuntime: PluginRuntime;
    pipelineRuntime: PipelineRuntime;
    channelRuntime: ChannelRuntime;
    mcpRuntime: McpRuntime;
    cronRuntime: CronRuntime;
    systemRuntime: SystemRuntime;
    pathResolver: PathResolverService;
    configManager: ConfigManagerService;
    sqliteManager: SQLiteManagerService;
    roleManager: RoleManagerService;
    skillManager: SkillManagerService;
    chatStore: Pick<ChatSessionStore, 'count'>;
}

/** 应用运行时主编排器
 *
 * 管理所有子系统的生命周期，确保按正确顺序启动与关闭。
 * 启动失败时会自动执行清理（调用 stop），避免资源泄漏。
 */
export class AppRuntime {
    private initialized = false;

    private readonly toolManager: ToolManager;
    private readonly pluginRuntime: PluginRuntime;
    private readonly pipelineRuntime: PipelineRuntime;
    private readonly channelRuntime: ChannelRuntime;
    private readonly mcpRuntime: McpRuntime;
    private readonly cronRuntime: CronRuntime;
    private readonly systemRuntime: SystemRuntime;
    private readonly deps: AppRuntimeDependencies;

    constructor(deps: AppRuntimeDependencies) {
        this.deps = deps;
        this.toolManager = deps.toolManager;
        this.pluginRuntime = deps.pluginRuntime;
        this.pipelineRuntime = deps.pipelineRuntime;
        this.channelRuntime = deps.channelRuntime;
        this.mcpRuntime = deps.mcpRuntime;
        this.cronRuntime = deps.cronRuntime;
        this.systemRuntime = deps.systemRuntime;
    }

    /** 启动所有子系统
     *
     * 按依赖顺序初始化：先基础设施，再领域服务，最后外部连接。
     * 任何阶段失败都会触发完整清理，防止部分初始化状态。
     */
    async start(): Promise<void> {
        if (this.initialized) {
            logger.warn({}, 'Bootstrap already initialized, skipping...');
            return;
        }

        try {
            logger.info({}, 'AesyClaw starting...');
            await this.runInitStages();
            this.initialized = true;
            logger.info({}, 'AesyClaw started successfully');
        } catch (error) {
            const errorMessage = toErrorMessage(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error({ error: errorMessage, stack: errorStack }, 'Bootstrap failed');

            try {
                await this.stop();
            } catch (cleanupError) {
                logger.error({ error: cleanupError }, 'Bootstrap cleanup failed');
            }

            throw error;
        }
    }

    /** 关闭所有子系统
     *
     * 按与启动相反的顺序关闭：先断开外部连接（Channel/Cron/MCP），
     * 再停止内部服务，确保不再有新消息进入后才释放资源。
     * 每个步骤独立 try-catch，单个失败不影响后续清理。
     */
    async stop(): Promise<void> {
        logger.info({}, 'Shutting down AesyClaw...');

        const steps: Array<[string, () => void | Promise<void>]> = [
            ['Channel runtime', () => this.channelRuntime.stop()],
            ['Cron runtime', () => this.cronRuntime.stop()],
            ['MCP runtime', () => this.mcpRuntime.stop()],
            ['Plugin runtime', () => this.pluginRuntime.stop()],
            ['Pipeline runtime', () => this.pipelineRuntime.stop()],
            ['System registrations', () => this.systemRuntime.dispose()],
            ['SQLiteManager', () => this.deps.sqliteManager.close()],
            ['SkillManager', () => this.deps.skillManager.shutdown()],
            ['RoleManager', () => this.deps.roleManager.shutdown()],
            ['ConfigManager', () => this.deps.configManager.destroy()],
        ];

        for (const [i, [label, fn]] of steps.entries()) {
            try {
                await fn();
                logger.info({}, `[${i + 1}/${steps.length}] ${label} stopped`);
            } catch (error) {
                logger.error({ error }, `Error stopping ${label}`);
            }
        }

        this.initialized = false;

        logger.info({}, 'AesyClaw shutdown completed');
    }

    /** 获取当前运行状态摘要，用于诊断与监控 */
    getStatus() {
        const mcpServers = this.mcpRuntime.getConnectedServers();

        return {
            initialized: this.initialized,
            pathResolver: this.deps.pathResolver.isInitialized(),
            configManager: this.deps.configManager.isInitialized(),
            sqliteManager: this.deps.sqliteManager.isInitialized(),
            toolRegistry: { totalTools: this.toolManager.getStats().totalTools },
            roles: {
                total: this.deps.roleManager.isInitialized()
                    ? this.deps.roleManager.getAllRoles().length
                    : 0,
            },
            sessions: {
                total: this.deps.sqliteManager.isInitialized() ? this.deps.chatStore.count() : 0,
            },
            mcpServers: mcpServers.filter((server) => server.connected).length,
            plugins: this.pluginRuntime.getPluginCount(),
            channels: this.channelRuntime.getChannelCount(),
            cron: {
                running: this.cronRuntime.isRunning(),
                scheduledTasks: this.cronRuntime.getScheduledTaskCount(),
            },
        };
    }

    /** 按依赖顺序执行所有初始化阶段 */
    private async runInitStages(): Promise<void> {
        await this.initializeCoreInfrastructure();
        await this.initializeDomainServices();
        this.pipelineRuntime.start();
        this.systemRuntime.register();
        await this.pluginRuntime.start();
        this.cronRuntime.start();
        await this.startManagedRuntimes();
    }

    /** 初始化核心基础设施：路径解析 → 配置管理 → 数据库 */
    private async initializeCoreInfrastructure(): Promise<void> {
        await this.deps.pathResolver.initialize();
        await this.deps.configManager.initialize();
        this.deps.sqliteManager.initialize();
    }

    /** 初始化领域服务：技能系统 → 角色系统 */
    private async initializeDomainServices(): Promise<void> {
        await this.deps.skillManager.initialize();
        logger.info(this.deps.skillManager.getStats(), 'Skills system loaded');

        await this.deps.roleManager.initialize();
        logger.info(
            { roleCount: this.deps.roleManager.getAllRoles().length },
            'Role system loaded',
        );
    }

    /** 启动托管运行时：MCP → 频道 → 配置同步 → 热重载监听
     *
     * 配置同步必须在所有插件与频道加载后执行，
     * 以确保 registerDefaults() 已收集所有默认值。
     * 热重载监听必须在配置同步之后启用，
     * 避免初始同步触发不必要的重载。
     */
    private async startManagedRuntimes(): Promise<void> {
        await this.mcpRuntime.start();
        await this.channelRuntime.start();

        await this.deps.configManager.syncAllDefaultConfigs();
        this.pluginRuntime.watchConfigChanges();
        this.mcpRuntime.watchConfigChanges();
        this.channelRuntime.watchConfigChanges();
    }
}
