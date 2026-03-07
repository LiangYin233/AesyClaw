import { randomUUID } from 'crypto';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { CronService, CronJob, CronSchedule } from './CronService.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';
import { parseInterval } from '../utils/index.js';

export function registerCronTools(
  toolRegistry: ToolRegistry,
  cronService: CronService,
  eventBus: EventBus
): void {
  const log = logger.child({ prefix: 'CronTools' });

  toolRegistry.register({
    name: 'create_cron_task',
    description: '创建一个定时任务',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['once', 'interval', 'daily'],
          description: '运行类型：once-指定时间执行一次, interval-间隔执行, daily-每日指定时间执行'
        },
        time: {
          type: 'string',
          description: '运行时间 (once: ISO时间如 "2024-01-01T10:00:00Z", interval: 间隔如 "10m"/"1h", daily: 每日时间如 "09:00")'
        },
        description: {
          type: 'string',
          description: '任务简介'
        },
        detail: {
          type: 'string',
          description: '任务详细描述，触发时将发送给LLM处理'
        },
        target: {
          type: 'string',
          description: '发送目标，格式：private:QQ号 或 group:群号，如 private:163213819 或 group:381297421'
        }
      },
      required: ['type', 'time', 'description', 'detail']
    },
    execute: async (params: Record<string, any>) => {
      const { type, time, description, detail, target } = params;

      const schedule: CronSchedule = { kind: type };

      switch (type) {
        case 'once':
          schedule.onceAt = time;
          break;
        case 'interval':
          const intervalMs = parseInterval(time);
          if (!intervalMs) {
            return JSON.stringify({ success: false, error: '无效的间隔格式，请使用如 "10m", "1h", "30s"' });
          }
          schedule.intervalMs = intervalMs;
          break;
        case 'daily':
          schedule.dailyAt = time;
          break;
      }

      const job: CronJob = {
        id: randomUUID().slice(0, 8),
        name: description,
        enabled: true,
        schedule,
        payload: {
          description,
          detail,
          target
        }
      };

      cronService.addJob(job);

      return JSON.stringify({ success: true, id: job.id, message: `任务已创建: ${description}` });
    },
    source: 'built-in'
  }, 'built-in');

  toolRegistry.register({
    name: 'delete_cron_task',
    description: '删除定时任务',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '任务ID'
        }
      },
      required: ['id']
    },
    execute: async (params: Record<string, any>) => {
      const { id } = params;
      const removed = cronService.removeJob(id);

      if (removed) {
        return JSON.stringify({ success: true, message: `任务 ${id} 已删除` });
      } else {
        return JSON.stringify({ success: false, error: `任务 ${id} 不存在` });
      }
    },
    source: 'built-in'
  }, 'built-in');

  toolRegistry.register({
    name: 'list_cron_task',
    description: '列出所有定时任务',
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async () => {
      const jobs = cronService.listJobs();

      return JSON.stringify({
        success: true,
        jobs: jobs.map(job => ({
          id: job.id,
          name: job.name,
          enabled: job.enabled,
          kind: job.schedule.kind,
          nextRunAtMs: job.nextRunAtMs,
          lastRunAtMs: job.lastRunAtMs
        }))
      });
    },
    source: 'built-in'
  }, 'built-in');

  log.debug('Cron tools registered');
}
