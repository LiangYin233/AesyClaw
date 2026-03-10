import { randomUUID } from 'crypto';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { CronService, CronJob, CronSchedule } from './CronService.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';

/**
 * Parse an interval string into milliseconds
 * Supported formats: "30s", "5m", "2h", "1d"
 */
function parseInterval(str: string): number | null {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

export function registerCronTools(
  toolRegistry: ToolRegistry,
  cronService: CronService,
  _eventBus: EventBus
): void {
  const log = logger.child({ prefix: 'CronTools' });

  toolRegistry.register({
    name: 'create_cron_task',
    description: '创建定时任务。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['once', 'interval', 'daily'],
          description: '任务类型：once / interval / daily。'
        },
        time: {
          type: 'string',
          description: '时间；once 用日期时间，interval 用 10m/1h，daily 用 HH:MM。'
        },
        description: {
          type: 'string',
          description: '任务名。'
        },
        detail: {
          type: 'string',
          description: '触发时发送给 AI 的内容。'
        },
        target: {
          type: 'string',
          description: '目标上下文；格式 频道:消息类型:用户ID。'
        }
      },
      required: ['type', 'time', 'description', 'detail', 'target']
    },
    execute: async (params: Record<string, any>) => {
      const { type, time, description, detail, target } = params;

      const schedule: CronSchedule = { kind: type };

      switch (type) {
        case 'once': {
          // If no timezone offset is present, treat as local time
          const hasOffset = /[Z]$|[+-]\d{2}:\d{2}$/.test(time.trim());
          if (!hasOffset) {
            const offsetMin = new Date().getTimezoneOffset();
            const sign = offsetMin <= 0 ? '+' : '-';
            const abs = Math.abs(offsetMin);
            const hh = String(Math.floor(abs / 60)).padStart(2, '0');
            const mm = String(abs % 60).padStart(2, '0');
            schedule.onceAt = `${time}${sign}${hh}:${mm}`;
          } else {
            schedule.onceAt = time;
          }
          break;
        }
        case 'interval': {
          const intervalMs = parseInterval(time);
          if (!intervalMs) {
            return JSON.stringify({ success: false, error: '无效的间隔格式，请使用如 "10m", "1h", "30s"' });
          }
          schedule.intervalMs = intervalMs;
          break;
        }
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
    description: '删除定时任务。',
    parameters: {
      type: 'object',
      properties: {
          id: {
            type: 'string',
            description: '任务 ID。'
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
    description: '列出定时任务。',
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
