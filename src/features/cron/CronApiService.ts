import { randomUUID } from 'crypto';
import type { CronJob, CronPayload, CronSchedule } from '../../cron/index.js';
import { NotFoundError, ValidationError } from '../../api/errors.js';
import { CronRepository } from './CronRepository.js';

const VALID_SCHEDULE_KINDS = new Set<CronSchedule['kind']>(['once', 'interval', 'daily', 'cron']);

export class CronApiService {
  constructor(private readonly cronRepository: CronRepository) {}

  listJobs(): { jobs: CronJob[] } {
    return { jobs: this.cronRepository.list() };
  }

  getJob(id: string): { job: CronJob } {
    const job = this.cronRepository.getById(id);
    if (!job) {
      throw new NotFoundError('Cron job', id);
    }
    return { job };
  }

  createJob(body: unknown): { success: true; job: CronJob } {
    const payload = this.requireBody(body);
    const name = this.requireString(payload.name, 'name', 'name is required and must be a string');
    const schedule = this.requireSchedule(payload.schedule, true);
    const jobPayload = this.requirePayload(payload.payload, true);
    const enabled = payload.enabled !== false;
    const job = this.cronRepository.create({
      id: randomUUID().slice(0, 8),
      name,
      enabled,
      schedule,
      payload: jobPayload
    });

    return { success: true, job };
  }

  updateJob(id: string, body: unknown): { success: true; job: CronJob } {
    const existing = this.cronRepository.getById(id);
    if (!existing) {
      throw new NotFoundError('Cron job', id);
    }

    const payload = this.requireBody(body);
    if (payload.name !== undefined) {
      existing.name = this.requireString(payload.name, 'name', 'name must be a string');
    }
    if (payload.schedule !== undefined) {
      existing.schedule = this.requireSchedule(payload.schedule, false);
    }
    if (payload.payload !== undefined) {
      existing.payload = this.requirePayload(payload.payload, false);
    }
    if (payload.enabled !== undefined) {
      if (typeof payload.enabled !== 'boolean') {
        throw new ValidationError('enabled must be a boolean', 'enabled');
      }
      existing.enabled = payload.enabled;
    }

    return { success: true, job: this.cronRepository.save(existing) };
  }

  deleteJob(id: string): { success: true } {
    const removed = this.cronRepository.delete(id);
    if (!removed) {
      throw new NotFoundError('Cron job', id);
    }
    return { success: true };
  }

  toggleJob(id: string, body: unknown): { success: true; enabled: boolean } {
    const payload = this.requireBody(body);
    if (typeof payload.enabled !== 'boolean') {
      throw new ValidationError('enabled is required and must be a boolean', 'enabled');
    }

    const job = this.cronRepository.getById(id);
    if (!job) {
      throw new NotFoundError('Cron job', id);
    }

    this.cronRepository.setEnabled(id, payload.enabled);
    return {
      success: true,
      enabled: payload.enabled
    };
  }

  private requireBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('request body must be an object');
    }
    return body as Record<string, unknown>;
  }

  private requireString(value: unknown, field: string, message: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ValidationError(message, field);
    }
    return value;
  }

  private requireSchedule(value: unknown, strictKind: boolean): CronSchedule {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ValidationError(
        strictKind ? 'schedule is required and must be an object' : 'schedule must be an object',
        'schedule'
      );
    }

    const schedule = value as CronSchedule;
    if (!VALID_SCHEDULE_KINDS.has(schedule.kind)) {
      throw new ValidationError(
        'schedule.kind must be one of: once, interval, daily, cron',
        'schedule.kind'
      );
    }

    return schedule;
  }

  private requirePayload(value: unknown, required: boolean): CronPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ValidationError(
        required ? 'payload is required and must be an object' : 'payload must be an object',
        'payload'
      );
    }
    return value as CronPayload;
  }
}
