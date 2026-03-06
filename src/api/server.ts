import express from 'express';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentLoop } from '../agent/AgentLoop.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { ChannelManager } from '../channels/ChannelManager.js';
import type { Config } from '../types.js';
import { ConfigService } from '../config/ConfigService.js';
import type { PluginManager } from '../plugins/index.js';
import { normalizeError, createErrorResponse, createValidationErrorResponse, NotFoundError } from '../utils/errors.js';
import type { CronService } from '../cron/index.js';
import type { MCPClientManager } from '../mcp/MCPClient.js';
import type { SkillManager } from '../skills/SkillManager.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { logger, type LogLevel } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';
import { CONSTANTS } from '../constants/index.js';
import { ConfigLoader } from '../config/loader.js';

const MAX_MESSAGE_LENGTH = CONSTANTS.MESSAGE_MAX_LENGTH;

// 读取版本号
let packageVersion = '0.1.0';
try {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
  packageVersion = packageJson.version || '0.1.0';
} catch (error) {
  // 如果读取失败,使用默认版本号
}

export class APIServer {
  private app = express();
  private server = createServer(this.app);
  private log = logger.child({ prefix: 'API' });
  private configService = new ConfigService();

  constructor(
    private port: number,
    private agent: AgentLoop,
    private sessionManager: SessionManager,
    private channelManager: ChannelManager,
    private config: Config,
    private pluginManager?: PluginManager,
    private cronService?: CronService,
    private mcpManager?: MCPClientManager,
    private skillManager?: SkillManager,
    private toolRegistry?: ToolRegistry
  ) {}

  /**
   * 验证请求参数
   */
  private validateRequired(value: any, fieldName: string): value is string {
    return value !== undefined && value !== null && typeof value === 'string' && value.length > 0;
  }

  /**
   * 验证字符串类型
   */
  private validateString(value: any, fieldName: string, maxLength?: number): string | null {
    if (!value || typeof value !== 'string') {
      return `${fieldName} is required and must be a string`;
    }
    if (maxLength && value.length > maxLength) {
      return `${fieldName} too long (max ${maxLength} characters)`;
    }
    return null;
  }

  async start(): Promise<void> {
    this.setupMiddleware();
    this.setupRoutes();

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.log.info(`Server started on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  private setupMiddleware(): void {
    const MAX_REQUEST_SIZE = 10 * 1024 * 1024;

    this.app.use(express.json({ limit: MAX_REQUEST_SIZE }));
    this.app.use(express.urlencoded({ extended: true, limit: MAX_REQUEST_SIZE }));

    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
  }

  private setupRoutes(): void {
    this.app.get('/api/status', (req, res) => {
      res.json({
        version: packageVersion,
        uptime: process.uptime(),
        channels: this.channelManager.getStatus(),
        sessions: this.sessionManager.count(),
        agentRunning: this.agent.isRunning()
      });
    });

    this.app.get('/api/sessions', (req, res) => {
      const sessions = this.sessionManager.list();
      res.json({ sessions: sessions.map(s => ({
        key: s.key,
        channel: s.channel,
        chatId: s.chatId,
        uuid: s.uuid,
        messageCount: s.messages.length
      })) });
    });

    this.app.get('/api/sessions/:key', async (req, res) => {
      const session = await this.sessionManager.getOrCreate(req.params.key);
      res.json({
        key: session.key,
        channel: session.channel,
        chatId: session.chatId,
        uuid: session.uuid,
        messageCount: session.messages.length,
        messages: session.messages
      });
    });

    this.app.delete('/api/sessions/:key', async (req, res) => {
      await this.sessionManager.delete(req.params.key);
      res.json({ success: true });
    });

    this.app.post('/api/chat', async (req, res) => {
      const { sessionKey, message } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json(createValidationErrorResponse('Message is required', 'message'));
      }

      if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json(createValidationErrorResponse(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`, 'message'));
      }

      const key = sessionKey || `api:${randomUUID()}`;

      this.log.debug(`POST /api/chat - session: ${key}, message: ${message.substring(0, 50)}...`);

      try {
        const response = await this.agent.processDirect(message, key);
        this.log.debug(`Chat response: ${response.substring(0, 50)}...`);
        res.json({ success: true, response });
      } catch (error: unknown) {
        const message = normalizeError(error);
        this.log.error(`Chat error: ${message}`);
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.get('/api/channels', (req, res) => {
      res.json(this.channelManager.getStatus());
    });

    this.app.post('/api/channels/:name/send', async (req, res) => {
      const { chatId, content } = req.body;

      if (!chatId || typeof chatId !== 'string') {
        return res.status(400).json(createValidationErrorResponse('chatId is required and must be a string', 'chatId'));
      }

      if (!content || typeof content !== 'string') {
        return res.status(400).json(createValidationErrorResponse('content is required and must be a string', 'content'));
      }

      if (content.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json(createValidationErrorResponse(`content too long (max ${MAX_MESSAGE_LENGTH} characters)`, 'content'));
      }

      const channel = this.channelManager.get(req.params.name);

      if (!channel) {
        return res.status(404).json(createErrorResponse(new NotFoundError('Channel', req.params.name)));
      }

      try {
        await channel.send({ channel: req.params.name, chatId, content });
        res.json({ success: true });
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.get('/api/tools', (req, res) => {
      const tools = this.agent.getToolDefinitions();
      res.json({ tools });
    });

    this.app.get('/api/plugins', async (req, res) => {
      if (!this.pluginManager) {
        return res.json({ plugins: [] });
      }
      const plugins = await this.pluginManager.getAllPlugins();
      res.json({ plugins });
    });

    this.app.post('/api/plugins/:name/toggle', async (req, res) => {
      if (!this.pluginManager) {
        return res.status(500).json({ success: false, error: 'Plugin manager not available' });
      }
      try {
        const { enabled } = req.body;
        const { name } = req.params;

        const success = await this.pluginManager.enablePlugin(name, enabled);
        if (success) {
          await this.configService.updatePluginConfig(name, enabled);
          res.json({ success: true });
        } else {
          res.status(500).json({ success: false, error: 'Failed to toggle plugin' });
        }
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.post('/api/plugins/:name/reload', async (req, res) => {
      if (!this.pluginManager) {
        return res.status(500).json({ success: false, error: 'Plugin manager not available' });
      }
      const { name } = req.params;

      const success = await this.pluginManager.reloadPlugin(name);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ success: false, error: 'Failed to reload plugin' });
      }
    });

    this.app.put('/api/plugins/:name/config', async (req, res) => {
      if (!this.pluginManager) {
        return res.status(500).json({ success: false, error: 'Plugin manager not available' });
      }
      try {
        const { options } = req.body;
        const { name } = req.params;

        const success = await this.pluginManager.updatePluginConfig(name, options);
        if (success) {
          const config = this.configService.get();
          const currentEnabled = config.plugins?.[name]?.enabled ?? true;
          await this.configService.updatePluginConfig(name, currentEnabled, options);
          res.json({ success: true });
        } else {
          res.status(500).json({ success: false, error: 'Failed to update plugin config' });
        }
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.get('/api/config', (req, res) => {
      res.json(this.config);
    });

    this.app.put('/api/config', async (req, res) => {
      try {
        const newConfig = req.body;
        await this.configService.save(newConfig);
        this.config = newConfig;
        res.json({ success: true });
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    // Skills routes
    if (this.skillManager) {
      this.app.get('/api/skills', (req, res) => {
        const skills = this.skillManager!.listSkills();
        res.json({ skills });
      });

      this.app.get('/api/skills/:name', (req, res) => {
        const skill = this.skillManager!.getSkill(req.params.name);
        if (!skill) {
          return res.status(404).json({ error: 'Skill not found' });
        }
        res.json({ skill });
      });

      this.app.post('/api/skills/:name/toggle', async (req, res) => {
        const { enabled } = req.body;
        const { name } = req.params;
        const success = await this.skillManager!.toggleSkill(name, enabled);
        if (!success) {
          return res.status(404).json({ success: false, error: 'Skill not found' });
        }
        res.json({ success: true });
      });
    }

    if (this.cronService) {
      const cronService = this.cronService;

      this.app.get('/api/cron', (req, res) => {
        const jobs = cronService.listJobs();
        res.json({ jobs });
      });

      this.app.get('/api/cron/:id', (req, res) => {
        const job = cronService.getJob(req.params.id);
        if (!job) {
          return res.status(404).json({ error: 'Job not found' });
        }
        res.json({ job });
      });

      this.app.post('/api/cron', (req, res) => {
        const { name, schedule, payload, enabled } = req.body;

        if (!name || !schedule || !payload) {
          return res.status(400).json({ success: false, error: 'name, schedule, and payload are required' });
        }

        if (!['once', 'interval', 'daily', 'cron'].includes(schedule.kind)) {
          return res.status(400).json({ success: false, error: 'Invalid schedule kind' });
        }

        const job = cronService.addJob({
          id: randomUUID().slice(0, 8),
          name,
          enabled: enabled !== false,
          schedule,
          payload
        });

        res.json({ success: true, job });
      });

      this.app.put('/api/cron/:id', (req, res) => {
        const { name, schedule, payload, enabled } = req.body;
        const existing = cronService.getJob(req.params.id);

        if (!existing) {
          return res.status(404).json({ success: false, error: 'Job not found' });
        }

        if (name !== undefined) existing.name = name;
        if (schedule !== undefined) existing.schedule = schedule;
        if (payload !== undefined) existing.payload = payload;
        if (enabled !== undefined) existing.enabled = enabled;

        cronService.computeNextRun(existing);
        cronService.removeJob(req.params.id);
        cronService.addJob(existing);

        res.json({ success: true, job: existing });
      });

      this.app.delete('/api/cron/:id', (req, res) => {
        const removed = cronService.removeJob(req.params.id);
        if (!removed) {
          return res.status(404).json({ success: false, error: 'Job not found' });
        }
        res.json({ success: true });
      });

      this.app.post('/api/cron/:id/toggle', (req, res) => {
        const { enabled } = req.body;
        const job = cronService.getJob(req.params.id);

        if (!job) {
          return res.status(404).json({ success: false, error: 'Job not found' });
        }

        cronService.enableJob(req.params.id, enabled);
        res.json({ success: true, enabled });
      });
    }

    // 日志配置 API
    this.app.get('/api/logs/config', (req, res) => {
      res.json(logger.getConfig());
    });

    this.app.post('/api/logs/level', (req, res) => {
      try {
        const { level } = req.body;

        // 验证日志级别
        const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
        if (!level || !validLevels.includes(level)) {
          return res.status(400).json({
            error: `Invalid log level. Must be one of: ${validLevels.join(', ')}`
          });
        }

        // 更新日志级别
        logger.setLevel(level);

        res.json({
          success: true,
          level: logger.getLevel()
        });
      } catch (error) {
        res.status(400).json(createErrorResponse(error));
      }
    });

    // 性能指标 API
    this.app.get('/api/metrics/names', (req, res) => {
      res.json({
        names: metrics.getMetricNames()
      });
    });

    this.app.get('/api/metrics/stats/:name', (req, res) => {
      const { name } = req.params;
      const { timeWindow } = req.query;

      const window = timeWindow ? parseInt(timeWindow as string) : undefined;
      const stats = metrics.getStats(name, window);

      if (!stats) {
        return res.status(404).json({
          error: `Metric "${name}" not found or no data available`
        });
      }

      res.json(stats);
    });

    this.app.get('/api/metrics/export', (req, res) => {
      const { name, timeWindow } = req.query;

      const window = timeWindow ? parseInt(timeWindow as string) : undefined;
      const data = metrics.export(name as string | undefined, window);

      res.json({
        count: data.length,
        metrics: data
      });
    });

    this.app.post('/api/metrics/clear', (req, res) => {
      const { name } = req.body;
      metrics.clear(name);

      res.json({
        success: true,
        message: name ? `Cleared metrics for "${name}"` : 'Cleared all metrics'
      });
    });

    this.app.get('/api/metrics/memory', (req, res) => {
      res.json(metrics.getMemoryUsage());
    });

    this.app.get('/api/metrics/overview', (req, res) => {
      const timeWindow = 60000; // 最近 1 分钟

      const overview = {
        agent: {
          processMessage: metrics.getStats('agent.process_message', timeWindow),
          messageCount: metrics.getStats('agent.message_count', timeWindow),
          toolExecution: metrics.getStats('agent.tool_execution', timeWindow)
        },
        tools: {
          executionTime: metrics.getStats('tool.execution_time', timeWindow),
          callCount: metrics.getStats('tool.call_count', timeWindow)
        },
        plugins: {
          hookExecution: metrics.getStats('plugin.hook_execution', timeWindow),
          hookCount: metrics.getStats('plugin.hook_count', timeWindow)
        },
        memory: metrics.getMemoryUsage()
      };

      res.json(overview);
    });

    // 获取 metrics 配置
    this.app.get('/api/metrics/config', (req, res) => {
      res.json(metrics.getConfig());
    });

    // 更新 metrics 配置
    this.app.post('/api/metrics/config', (req, res) => {
      try {
        const { enabled } = req.body;

        if (enabled !== undefined && typeof enabled === 'boolean') {
          metrics.setEnabled(enabled);
        }

        res.json({
          success: true,
          config: metrics.getConfig()
        });
      } catch (error) {
        res.status(400).json(createErrorResponse(error));
      }
    });

    // ==================== MCP 管理端点 ====================

    // 获取所有 MCP 服务器状态
    this.app.get('/api/mcp/servers', (req, res) => {
      if (!this.mcpManager) {
        return res.json({ servers: [] });
      }

      const servers = this.mcpManager.getServerStatus();
      res.json({ servers });
    });

    // 获取单个 MCP 服务器状态
    this.app.get('/api/mcp/servers/:name', (req, res) => {
      if (!this.mcpManager) {
        return res.status(404).json({ error: 'MCP not configured' });
      }

      const { name } = req.params;
      const server = this.mcpManager.getServerStatus(name);

      if (!server || (Array.isArray(server) ? false : server.status === 'disconnected')) {
        return res.status(404).json({ error: `MCP server not found: ${name}` });
      }

      res.json(server);
    });

    // 添加/更新 MCP 服务器
    this.app.post('/api/mcp/servers/:name', async (req, res) => {
      try {
        const { name } = req.params;
        const config = req.body;

        // 验证配置
        if (!config.type || !['local', 'http'].includes(config.type)) {
          return res.status(400).json({
            error: 'Invalid config: type must be "local" or "http"'
          });
        }

        if (config.type === 'local' && !config.command) {
          return res.status(400).json({
            error: 'Invalid config: command is required for local type'
          });
        }

        if (config.type === 'http' && !config.url) {
          return res.status(400).json({
            error: 'Invalid config: url is required for http type'
          });
        }

        // 初始化 MCPClientManager (如果不存在)
        if (!this.mcpManager) {
          const { MCPClientManager } = await import('../mcp/index.js');
          this.mcpManager = new MCPClientManager();
        }

        // 连接服务器
        await this.mcpManager.connectOne(name, config);

        // 保存到配置文件
        this.config.mcp = this.config.mcp || {};
        this.config.mcp[name] = config;
        await ConfigLoader.save(this.config);

        // 注册工具到 ToolRegistry
        if (this.toolRegistry) {
          const allTools = this.mcpManager.getTools();
          const tools = allTools.filter(t => t.name.startsWith(`mcp_${name}_`));

          for (const tool of tools) {
            this.toolRegistry.register({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              execute: async (params: any) => {
                return this.mcpManager!.callTool(tool.name, params);
              },
              source: 'mcp' as any
            }, 'mcp');
          }

          res.json({
            success: true,
            server: this.mcpManager.getServerStatus(name),
            toolsRegistered: tools.length
          });
        } else {
          res.json({
            success: true,
            server: this.mcpManager.getServerStatus(name),
            toolsRegistered: 0
          });
        }
      } catch (error) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    // 删除 MCP 服务器
    this.app.delete('/api/mcp/servers/:name', async (req, res) => {
      try {
        if (!this.mcpManager) {
          return res.status(404).json({ error: 'MCP not configured' });
        }

        const { name } = req.params;

        // 断开连接
        await this.mcpManager.disconnectOne(name);

        // 从配置文件中删除
        if (this.config.mcp && this.config.mcp[name]) {
          delete this.config.mcp[name];
          await ConfigLoader.save(this.config);
        }

        // 从 ToolRegistry 中注销工具
        let toolsRemoved = 0;
        if (this.toolRegistry) {
          const toolsToRemove = this.toolRegistry.list().filter((t: any) =>
            t.name.startsWith(`mcp_${name}_`)
          );

          for (const tool of toolsToRemove) {
            this.toolRegistry.unregister(tool.name);
          }
          toolsRemoved = toolsToRemove.length;
        }

        res.json({
          success: true,
          message: `MCP server "${name}" removed`,
          toolsRemoved
        });
      } catch (error) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    // 重新连接 MCP 服务器
    this.app.post('/api/mcp/servers/:name/reconnect', async (req, res) => {
      try {
        if (!this.mcpManager) {
          return res.status(404).json({ error: 'MCP not configured' });
        }

        const { name } = req.params;
        await this.mcpManager.reconnect(name);

        res.json({
          success: true,
          server: this.mcpManager.getServerStatus(name)
        });
      } catch (error) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    // 启用/禁用 MCP 服务器
    this.app.post('/api/mcp/servers/:name/toggle', async (req, res) => {
      try {
        const { name } = req.params;
        const { enabled } = req.body;

        if (typeof enabled !== 'boolean') {
          return res.status(400).json({
            error: 'Invalid request: enabled must be a boolean'
          });
        }

        // 更新配置
        if (!this.config.mcp || !this.config.mcp[name]) {
          return res.status(404).json({
            error: `MCP server not found in config: ${name}`
          });
        }

        this.config.mcp[name].enabled = enabled;
        await ConfigLoader.save(this.config);

        // 连接或断开
        if (this.mcpManager) {
          if (enabled) {
            await this.mcpManager.connectOne(name, this.config.mcp[name]);
          } else {
            await this.mcpManager.disconnectOne(name);
          }
        }

        res.json({
          success: true,
          enabled,
          server: this.mcpManager?.getServerStatus(name)
        });
      } catch (error) {
        res.status(500).json(createErrorResponse(error));
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.log.info('Server stopped');
        resolve();
      });
    });
  }

  updateConfig(config: Config): void {
    this.config = config;
    this.log.info('Config updated');
  }
}
