import { Router, Request, Response } from 'express';
import { logger } from '../../platform/observability/logger';
import { configManager } from '../../features/config/config-manager';
import { SessionRepository } from '../../platform/db/repositories/session-repository';
import { CronJobRepository } from '../../platform/db/repositories/cron-job-repository';
import { ToolRegistry } from '../../platform/tools/registry';
import { AgentManager } from '../../agent/core/engine';
import { authMiddleware } from './auth';
import type { ApiError, SessionInfo, CronJobInfo, ToolInfo, MCPStatus } from './types';

export function createWebUIRouter(): Router {
  const router = Router();
  const sessionRepo = new SessionRepository();
  const cronJobRepo = new CronJobRepository();
  const toolRegistry = ToolRegistry.getInstance();
  const agentManager = AgentManager.getInstance();

  router.use(authMiddleware);

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      connectedClients: 0,
    });
  });

  router.get('/sessions', (req, res) => {
    try {
      const sessions = sessionRepo.findAll();
      const sessionInfos: SessionInfo[] = sessions.map((s) => {
        const agent = agentManager.hasAgent(s.chatId)
          ? agentManager.getOrCreate(s.chatId)
          : null;

        let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        let memoryStats;

        if (agent) {
          const stats = agent.getMemoryStats();
          const budget = agent.getTokenBudget();
          tokenUsage = {
            promptTokens: Math.floor(budget.currentTokens * 0.5),
            completionTokens: Math.floor(budget.currentTokens * 0.3),
            totalTokens: budget.currentTokens,
          };
          memoryStats = {
            currentTokens: budget.currentTokens,
            maxTokens: budget.maxTokens,
            isCompressing: agent.isMemoryCompressing(),
            compressionPhase: agent.getMemoryCompressionPhase(),
          };
        }

        return {
          chatId: s.chatId,
          title: `会话 ${s.chatId.substring(0, 8)}`,
          updatedAt: s.updatedAt,
          messageCount: (agent?.getHistory()?.length) || 0,
          tokenUsage,
          memoryStats,
        };
      });

      res.json({ sessions: sessionInfos });
    } catch (error) {
      logger.error({ error }, 'Failed to get sessions');
      const err: ApiError = { error: 'Failed to get sessions', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.delete('/sessions/:chatId', (req, res) => {
    try {
      const { chatId } = req.params;
      agentManager.removeAgent(chatId);
      sessionRepo.delete(chatId);
      res.json({ success: true, chatId });
    } catch (error) {
      logger.error({ error }, 'Failed to delete session');
      const err: ApiError = { error: 'Failed to delete session', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.post('/sessions/:chatId/clear', (req, res) => {
    try {
      const { chatId } = req.params;
      const agent = agentManager.getOrCreate(chatId);
      agent.clearHistory();
      res.json({ success: true, chatId });
    } catch (error) {
      logger.error({ error }, 'Failed to clear session');
      const err: ApiError = { error: 'Failed to clear session', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.get('/sessions/:chatId/memory', (req, res) => {
    try {
      const { chatId } = req.params;
      const agent = agentManager.getOrCreate(chatId);
      const memoryStats = agent.getMemoryStats();
      const tokenBudget = agent.getTokenBudget();
      const history = agent.getHistory();

      res.json({
        chatId,
        stats: memoryStats,
        budget: tokenBudget,
        messageCount: history.length,
        messages: history.map((m) => ({
          role: m.role,
          content: m.content,
          toolCallId: (m as any).toolCallId,
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get session memory');
      const err: ApiError = { error: 'Failed to get session memory', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.get('/cron', (req, res) => {
    try {
      const jobs = cronJobRepo.findEnabled();
      const jobInfos: CronJobInfo[] = jobs.map((j) => ({
        id: j.id,
        name: j.name || j.id,
        expression: j.cronExpression,
        prompt: j.prompt || '',
        enabled: j.enabled,
        lastRun: j.lastRunAt || undefined,
        nextRun: j.nextRunAt || undefined,
        runCount: j.runCount,
        payload: j.metadata || {},
      }));
      res.json({ jobs: jobInfos });
    } catch (error) {
      logger.error({ error }, 'Failed to get cron jobs');
      const err: ApiError = { error: 'Failed to get cron jobs', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.post('/cron', (req, res) => {
    try {
      const { id, name, expression, prompt } = req.body;

      if (!id || !expression) {
        const err: ApiError = {
          error: 'id and expression are required',
          code: 'VALIDATION_ERROR',
        };
        res.status(400).json(err);
        return;
      }

      if (!prompt || prompt.trim().length === 0) {
        const err: ApiError = {
          error: 'prompt is required',
          code: 'VALIDATION_ERROR',
        };
        res.status(400).json(err);
        return;
      }

      const job = cronJobRepo.create({
        id,
        chatId: 'system',
        name: name || id,
        cronExpression: expression,
        command: '',
        prompt: prompt,
        metadata: {},
      });

      res.json({
        job: {
          id: job.id,
          name: job.name,
          expression: job.cronExpression,
          prompt: job.prompt,
          enabled: job.enabled,
          lastRun: job.lastRunAt || undefined,
          nextRun: job.nextRunAt || undefined,
          runCount: job.runCount,
          payload: job.metadata || {},
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create cron job');
      const err: ApiError = { error: 'Failed to create cron job', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.delete('/cron/:id', (req, res) => {
    try {
      const { id } = req.params;
      cronJobRepo.delete(id);
      res.json({ success: true, id });
    } catch (error) {
      logger.error({ error }, 'Failed to delete cron job');
      const err: ApiError = { error: 'Failed to delete cron job', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.patch('/cron/:id/toggle', (req, res) => {
    try {
      const { id } = req.params;
      const job = cronJobRepo.findById(id);
      if (!job) {
        const err: ApiError = { error: 'Cron job not found', code: 'NOT_FOUND' };
        res.status(404).json(err);
        return;
      }
      cronJobRepo.update(id, { enabled: !job.enabled });
      res.json({ success: true, id, enabled: !job.enabled });
    } catch (error) {
      logger.error({ error }, 'Failed to toggle cron job');
      const err: ApiError = { error: 'Failed to toggle cron job', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.get('/registry/tools', (req, res) => {
    try {
      const tools = toolRegistry.getAllToolDefinitions();
      const toolInfos: ToolInfo[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
      res.json({ tools: toolInfos });
    } catch (error) {
      logger.error({ error }, 'Failed to get tools');
      const err: ApiError = { error: 'Failed to get tools', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.get('/registry/mcp', (req, res) => {
    try {
      const statuses: MCPStatus[] = [];
      res.json({ servers: statuses });
    } catch (error) {
      logger.error({ error }, 'Failed to get MCP status');
      const err: ApiError = { error: 'Failed to get MCP status', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.get('/config', (req, res) => {
    try {
      const config = configManager.getConfig();
      res.json({ config });
    } catch (error) {
      logger.error({ error }, 'Failed to get config');
      const err: ApiError = { error: 'Failed to get config', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.post('/config', (req, res) => {
    try {
      const newConfig = req.body;
      configManager.updateConfig(newConfig);
      logger.info('Config updated via API');
      res.json({ success: true });
    } catch (error) {
      logger.error({ error }, 'Failed to update config');
      const err: ApiError = { error: 'Failed to update config', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  router.get('/agents/stats', (req, res) => {
    try {
      const chatIds = agentManager.getAllChatIds();
      const agents = chatIds.map((chatId) => {
        const agent = agentManager.getOrCreate(chatId);
        return {
          chatId,
          instanceId: agent.getInstanceId(),
          memoryStats: agent.getMemoryStats(),
          tokenBudget: agent.getTokenBudget(),
        };
      });
      res.json({
        activeCount: agentManager.getActiveAgentsCount(),
        chatIds,
        agents,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get agent stats');
      const err: ApiError = { error: 'Failed to get agent stats', code: 'INTERNAL_ERROR' };
      res.status(500).json(err);
    }
  });

  return router;
}
