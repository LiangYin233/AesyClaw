import type { CronManager, CreateCronJobParams } from '@aesyclaw/cron/manager';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { CronJobRecord, CronRunRecord, RoleConfig } from '@aesyclaw/core/types';
import { APP_NAME, APP_VERSION } from '@aesyclaw/core/types';
import type { ChannelManager } from '@aesyclaw/extension/channel/manager';
import type { ChannelPlugin } from '@aesyclaw/extension/channel/types';
import type { PluginManager } from '@aesyclaw/extension/plugin/manager';
import type { PluginDefinition } from '@aesyclaw/extension/plugin/types';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { SessionManager, SessionSummary } from '@aesyclaw/session';
import type { AgentMessage } from '@aesyclaw/contracts/llm';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { AesyClawTool, ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';

type ExtensionEnabledItem = {
  name: string;
  enabled: boolean;
};

export type RuntimeControlDependencies = {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  sessionManager: SessionManager;
  cronManager?: CronManager;
  roleManager: RoleManager;
  channelManager: ChannelManager;
  pluginManager: PluginManager;
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  agentRegistry: AgentRegistry;
  paths: Readonly<ResolvedPaths>;
};

export type RuntimeControlApi = {
  plugins: {
    list(): Promise<ExtensionEnabledItem[]>;
    definition(name: string): Promise<PluginDefinition>;
    reload(): Promise<void>;
    reload(name: string): Promise<boolean>;
  };
  channels: {
    list(): Promise<ExtensionEnabledItem[]>;
    definition(name: string): Promise<ChannelPlugin>;
    reload(): Promise<void>;
    reload(name: string): Promise<boolean>;
  };
  sessions: {
    list(): Promise<SessionSummary[]>;
    getMessages(sessionId: string): Promise<AgentMessage[]>;
    clear(sessionId: string): Promise<void>;
    delete(sessionId: string): Promise<void>;
    setModel(sessionId: string, model: string): Promise<void>;
    setRole(sessionId: string, role: string): Promise<void>;
  };
  roles: {
    list(): Promise<RoleConfig[]>;
    get(id: string): Promise<RoleConfig>;
    create(role: Omit<RoleConfig, 'id'> & { id?: string }): Promise<RoleConfig>;
    update(id: string, patch: Partial<RoleConfig>): Promise<RoleConfig>;
    delete(id: string): Promise<void>;
  };
  cron: {
    list(): Promise<CronJobRecord[]>;
    get(id: string): Promise<CronJobRecord>;
    getRuns(jobId: string): Promise<CronRunRecord[]>;
    create(job: CreateCronJobParams): Promise<CronJobRecord>;
    update(id: string, patch: Partial<CronJobRecord>): Promise<CronJobRecord>;
    delete(id: string): Promise<void>;
    runNow(id: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
  };
  logs: {
    query(options?: { limit?: number }): Promise<{ entries: unknown[]; limit: number }>;
  };
  usage: {
    query(options?: { model?: string; from?: string; to?: string }): Promise<unknown>;
    today(): Promise<unknown>;
    tools(options?: { from?: string; to?: string }): Promise<unknown>;
  };
  status: {
    get(): Promise<{
      app: string;
      version: string;
      uptime: number;
      channels: Array<{ name: string; state: string; version?: string; error?: string }>;
      database: unknown;
    }>;
  };
  tools: {
    list(): Promise<Array<Pick<AesyClawTool, 'name' | 'description' | 'owner'> & { parameters: unknown }>>;
  };
  skills: {
    list(): Promise<Array<{ name: string; description?: string; isSystem: boolean }>>;
    reload(): Promise<void>;
    getContent(name: string): Promise<{ name: string; content: string }>;
  };
};

export class RuntimeControlHub implements RuntimeControlApi {
  plugins: RuntimeControlApi['plugins'];
  channels: RuntimeControlApi['channels'];
  sessions: RuntimeControlApi['sessions'];
  roles: RuntimeControlApi['roles'];
  cron: RuntimeControlApi['cron'];
  logs: RuntimeControlApi['logs'];
  usage: RuntimeControlApi['usage'];
  status: RuntimeControlApi['status'];
  tools: RuntimeControlApi['tools'];
  skills: RuntimeControlApi['skills'];

  private deps?: RuntimeControlDependencies;

  constructor(deps?: RuntimeControlDependencies) {
    this.deps = deps;
    this.plugins = createPluginsControl(() => this.requireDeps());
    this.channels = createChannelsControl(() => this.requireDeps());
    this.sessions = createSessionsControl(() => this.requireDeps());
    this.roles = createRolesControl(() => this.requireDeps());
    this.cron = createCronControl(() => this.requireDeps());
    this.logs = createLogsControl();
    this.usage = createUsageControl(() => this.requireDeps());
    this.status = createStatusControl(() => this.requireDeps());
    this.tools = createToolsControl(() => this.requireDeps());
    this.skills = createSkillsControl(() => this.requireDeps());
  }

  bind(deps: RuntimeControlDependencies): void {
    this.deps = deps;
  }

  reset(): void {
    this.deps = undefined;
  }

  private requireDeps(): RuntimeControlDependencies {
    if (!this.deps) {
      throw new Error('Runtime control dependencies are not ready');
    }
    return this.deps;
  }
}

function createPluginsControl(getDeps: () => RuntimeControlDependencies): RuntimeControlApi['plugins'] {
  return {
    async list() {
      return getDeps().pluginManager.listEnabledPlugins();
    },
    async definition(name) {
      return getDeps().pluginManager.getDefinition(name);
    },
    reload: (async (name?: string): Promise<void | boolean> => {
      return await reloadExtension(getDeps().pluginManager, name);
    }) as RuntimeControlApi['plugins']['reload'],
  };
}

function createChannelsControl(getDeps: () => RuntimeControlDependencies): RuntimeControlApi['channels'] {
  return {
    async list() {
      return getDeps().channelManager.listEnabledChannels();
    },
    async definition(name) {
      return getDeps().channelManager.getDefinition(name);
    },
    reload: (async (name?: string): Promise<void | boolean> => {
      return await reloadExtension(getDeps().channelManager, name);
    }) as RuntimeControlApi['channels']['reload'],
  };
}

async function reloadExtension(
  manager: { reload(): Promise<void>; reload(name: string): Promise<boolean> },
  name?: string,
): Promise<void | boolean> {
  if (name === undefined) {
    await manager.reload();
    return;
  }
  return await manager.reload(name);
}

function createSessionsControl(getDeps: () => RuntimeControlDependencies): RuntimeControlApi['sessions'] {
  return {
    async list() {
      return await getDeps().sessionManager.getSummaries();
    },
    async getMessages(sessionId) {
      return await getDeps().sessionManager.getMessagesById(sessionId);
    },
    async clear(sessionId) {
      await getDeps().sessionManager.clearById(sessionId);
    },
    async delete(sessionId) {
      const deleted = await getDeps().sessionManager.deleteById(sessionId);
      if (!deleted) throw new Error(`会话 "${sessionId}" 未找到`);
    },
    async setModel(sessionId, model) {
      const record = await getDeps().databaseManager.sessions.findById(sessionId);
      if (!record) throw new Error(`会话 "${sessionId}" 未找到`);
      await getDeps().databaseManager.sessions.setModel(sessionId, model);
    },
    async setRole(sessionId, role) {
      const record = await getDeps().databaseManager.sessions.findById(sessionId);
      if (!record) throw new Error(`会话 "${sessionId}" 未找到`);
      await getDeps().databaseManager.sessions.setRole(sessionId, role);
    },
  };
}

function createRolesControl(getDeps: () => RuntimeControlDependencies): RuntimeControlApi['roles'] {
  return {
    async list() {
      return getDeps()
        .roleManager.getAllRoles()
        .sort((a, b) => {
          if (a.id === 'default') return -1;
          if (b.id === 'default') return 1;
          return a.id.localeCompare(b.id);
        });
    },
    async get(id) {
      return getDeps().roleManager.getRole(id);
    },
    async create(role) {
      return await getDeps().roleManager.createRole(role);
    },
    async update(id, patch) {
      const current = getDeps().roleManager.getRole(id);
      const updated = { ...current, ...patch, id };
      await getDeps().roleManager.saveRole(id, updated);
      return getDeps().roleManager.getRole(id);
    },
    async delete(id) {
      await getDeps().roleManager.deleteRole(id);
    },
  };
}

function createCronControl(getDeps: () => RuntimeControlDependencies): RuntimeControlApi['cron'] {
  const requireCron = (): CronManager => {
    const cronManager = getDeps().cronManager;
    if (!cronManager) throw new Error('CronManager is not ready');
    return cronManager;
  };
  return {
    async list() {
      return await requireCron().listJobs();
    },
    async get(id) {
      const job = await getDeps().databaseManager.cronJobs.findById(id);
      if (!job) throw new Error(`定时任务 "${id}" 未找到`);
      return job;
    },
    async getRuns(jobId) {
      return await getDeps().databaseManager.cronRuns.findByJobId(jobId);
    },
    async create(job) {
      const id = await requireCron().createJob(job);
      const created = await getDeps().databaseManager.cronJobs.findById(id);
      if (!created) throw new Error(`定时任务 "${id}" 创建后未找到`);
      return created;
    },
    async update() {
      throw new Error('cron.update is not implemented until cron job update storage is available');
    },
    async delete(id) {
      const deleted = await requireCron().deleteJob(id);
      if (!deleted) throw new Error(`定时任务 "${id}" 未找到`);
    },
    async runNow(id) {
      await requireCron().runJobNow(id);
    },
    async setEnabled() {
      throw new Error('cron.setEnabled is not implemented until cron job enabled storage is available');
    },
  };
}

function createLogsControl(): RuntimeControlApi['logs'] {
  return {
    async query(options) {
      const { getRecentLogEntries } = await import('@aesyclaw/core/logger');
      const limit = normalizeLimit(options?.limit);
      return { entries: getRecentLogEntries(limit) as unknown[], limit };
    },
  };
}

function createUsageControl(getDeps: () => RuntimeControlDependencies): RuntimeControlApi['usage'] {
  return {
    async query(options) {
      return await getDeps().databaseManager.usage.getStats(options);
    },
    async today() {
      return await getDeps().databaseManager.usage.getTodaySummary();
    },
    async tools(options) {
      return await getDeps().databaseManager.toolUsage.getStats(options);
    },
  };
}

function createStatusControl(getDeps: () => RuntimeControlDependencies): RuntimeControlApi['status'] {
  return {
    async get() {
      const deps = getDeps();
      return {
        app: APP_NAME,
        version: APP_VERSION,
        uptime: process.uptime(),
        channels: deps.channelManager.listChannels().map((ch) => ({
          name: ch.name,
          state: ch.state,
          version: ch.version,
          error: ch.error,
        })),
        database: deps.databaseManager.getStats(),
      };
    },
  };
}

function createToolsControl(getDeps: () => RuntimeControlDependencies): RuntimeControlApi['tools'] {
  return {
    async list() {
      return getDeps().toolRegistry.getAll().map((tool) => ({
        name: tool.name,
        description: tool.description,
        owner: tool.owner,
        parameters: JSON.parse(JSON.stringify(tool.parameters)) as unknown,
      }));
    },
  };
}

function createSkillsControl(getDeps: () => RuntimeControlDependencies): RuntimeControlApi['skills'] {
  return {
    async list() {
      return getDeps().skillManager.getAllSkills().map((skill) => ({
        name: skill.name,
        description: skill.description,
        isSystem: skill.isSystem,
      }));
    },
    async reload() {
      await getDeps().skillManager.reload();
    },
    async getContent(name) {
      const skill = getDeps().skillManager.getSkill(name);
      if (!skill) throw new Error(`技能 "${name}" 未找到`);
      return { name: skill.name, content: skill.content };
    },
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined || limit < 1) return 200;
  return Math.min(Math.floor(limit), 500);
}
