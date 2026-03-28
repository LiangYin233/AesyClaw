import type { CronPayload, CronSchedule } from '../index.js';
import { RequestValidationError } from '../../../platform/errors/boundary.js';
import {
  parseOptionalString,
  requireBoolean,
  requireObjectBody,
  requireString
} from '../../shared/requestParsers.js';

const VALID_SCHEDULE_KINDS = new Set<CronSchedule['kind']>(['once', 'interval', 'daily', 'cron']);
const CRON_TARGET_PATTERN = /^[^:]+:(private|group):.+$/;

export interface CreateCronJobDto {
  name: string;
  schedule: CronSchedule;
  payload: CronPayload;
  enabled: boolean;
}

export interface UpdateCronJobDto {
  name?: string;
  schedule?: CronSchedule;
  payload?: CronPayload;
  enabled?: boolean;
}

export function parseCreateCronJob(body: unknown): CreateCronJobDto {
  const payload = requireObjectBody(body);

  return {
    name: requireString(payload.name, 'name', 'name is required and must be a string'),
    schedule: parseCronSchedule(payload.schedule, true),
    payload: parseCronPayload(payload.payload, true),
    enabled: payload.enabled === undefined ? true : requireBoolean(payload.enabled, 'enabled', 'enabled must be a boolean')
  };
}

export function parseUpdateCronJob(body: unknown): UpdateCronJobDto {
  const payload = requireObjectBody(body);

  return {
    name: payload.name === undefined ? undefined : requireString(payload.name, 'name', 'name must be a string'),
    schedule: payload.schedule === undefined ? undefined : parseCronSchedule(payload.schedule, false),
    payload: payload.payload === undefined ? undefined : parseCronPayload(payload.payload, false),
    enabled: payload.enabled === undefined ? undefined : requireBoolean(payload.enabled, 'enabled', 'enabled must be a boolean')
  };
}

export function parseToggleCronJob(body: unknown): { enabled: boolean } {
  const payload = requireObjectBody(body);
  return {
    enabled: requireBoolean(payload.enabled, 'enabled', 'enabled is required and must be a boolean')
  };
}

function parseCronSchedule(value: unknown, required: boolean): CronSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestValidationError(
      required ? 'schedule is required and must be an object' : 'schedule must be an object',
      'schedule'
    );
  }

  const schedule = value as CronSchedule;
  if (!VALID_SCHEDULE_KINDS.has(schedule.kind)) {
    throw new RequestValidationError('schedule.kind must be one of: once, interval, daily, cron', 'schedule.kind');
  }

  return schedule;
}

function parseCronPayload(value: unknown, required: boolean): CronPayload {
  const payload = requireObjectBody(
    value,
    'payload',
    required ? 'payload is required and must be an object' : 'payload must be an object'
  );

  const target = parseOptionalString(payload.target, 'payload.target');
  if (target && !CRON_TARGET_PATTERN.test(target)) {
    throw new RequestValidationError(
      'payload.target must use format "channel:private|group:chatId"',
      'payload.target'
    );
  }

  return {
    description: requireString(payload.description, 'payload.description', 'payload.description must be a string'),
    detail: requireString(payload.detail, 'payload.detail', 'payload.detail must be a string'),
    channel: parseOptionalString(payload.channel, 'payload.channel'),
    target
  };
}
