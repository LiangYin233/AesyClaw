import { randomUUID } from 'crypto';
import type { ToolContext, ToolRegistry } from '../tools/ToolRegistry.js';
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

function normalizeOnceTime(str: string): string {
  const trimmed = str.trim();
  const normalizedBase = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/, '$1T$2');
  const hasOffset = /[Z]$|[+-]\d{2}:\d{2}$/.test(normalizedBase);

  if (hasOffset) {
    return normalizedBase;
  }

  const offsetMin = new Date().getTimezoneOffset();
  const sign = offsetMin <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${normalizedBase}${sign}${hh}:${mm}`;
}

export function registerCronTools(
  toolRegistry: ToolRegistry,
  cronService: CronService,
  _eventBus: EventBus
): void {
  const log = logger.child({ prefix: 'CronTools' });

  toolRegistry.register({
    name: 'create_cron_task',
    description: '创建定时任务。适用于“稍后提醒我”或“到某个时间再告诉我/再处理”的请求。调用该工具时应只创建任务，不要当场回答用户要等到未来才处理的问题；任务会自动发送到当前会话用户，无需传入目标参数。',
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
          description: '时间；once 可用日期时间或 2m/1h/1d 这类相对时间，interval 用 10m/1h，daily 用 HH:MM。'
        },
        description: {
          type: 'string',
          description: '任务名；用于概括任务，简短即可，不要把完整答案写进去。'
        },
        detail: {
          type: 'string',
          description: '触发时发送给 AI 的完整指令。这里应填写未来真正要处理的原始请求，不要提前写答案。'
        },
      },
      required: ['type', 'time', 'description', 'detail']
    },
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      const { type, time, description, detail } = params;

      if (!context?.channel || !context?.chatId || !context?.messageType) {
        return JSON.stringify({ success: false, error: '无法获取当前会话目标，创建定时任务失败' });
      }

      const target = `${context.channel}:${context.messageType}:${context.chatId}`;

      const schedule: CronSchedule = { kind: type };

      switch (type) {
        case 'once': {
          const relativeMs = parseInterval(String(time));
          if (relativeMs) {
            schedule.onceAt = new Date(Date.now() + relativeMs).toISOString();
            break;
          }

          const normalizedTime = normalizeOnceTime(String(time));
          if (!Number.isFinite(new Date(normalizedTime).getTime())) {
            return JSON.stringify({ success: false, error: '无效的一次性执行时间，请使用如 "2026-03-12 18:30"、ISO 8601 格式，或相对时间如 "2m"、"1h"' });
          }
          schedule.onceAt = normalizedTime;
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

      cronService.computeNextRun(job);
      if (!Number.isFinite(job.nextRunAtMs)) {
        return JSON.stringify({ success: false, error: '无法计算下次执行时间，请检查 time 参数是否有效且未落在过去' });
      }

      cronService.addJob(job);

      return JSON.stringify({
        success: true,
        id: job.id,
        message: `任务已创建: ${description}`,
        nextRunAtMs: job.nextRunAtMs,
        nextRunAt: new Date(job.nextRunAtMs!).toISOString()
      });
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
