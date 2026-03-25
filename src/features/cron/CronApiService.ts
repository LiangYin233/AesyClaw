import { randomUUID } from 'crypto';
import type { CronJob } from '../../cron/index.js';
import { NotFoundError } from '../../api/errors.js';
import { CronRepository } from './CronRepository.js';
import type { CreateCronJobDto, UpdateCronJobDto } from './cron.dto.js';

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

  createJob(input: CreateCronJobDto): { success: true; job: CronJob } {
    const job = this.cronRepository.create({
      id: randomUUID().slice(0, 8),
      name: input.name,
      enabled: input.enabled,
      schedule: input.schedule,
      payload: input.payload
    });

    return { success: true, job };
  }

  updateJob(id: string, input: UpdateCronJobDto): { success: true; job: CronJob } {
    const existing = this.cronRepository.getById(id);
    if (!existing) {
      throw new NotFoundError('Cron job', id);
    }

    if (input.name !== undefined) {
      existing.name = input.name;
    }
    if (input.schedule !== undefined) {
      existing.schedule = input.schedule;
    }
    if (input.payload !== undefined) {
      existing.payload = input.payload;
    }
    if (input.enabled !== undefined) {
      existing.enabled = input.enabled;
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

  toggleJob(id: string, enabled: boolean): { success: true; enabled: boolean } {
    const job = this.cronRepository.getById(id);
    if (!job) {
      throw new NotFoundError('Cron job', id);
    }

    this.cronRepository.setEnabled(id, enabled);
    return {
      success: true,
      enabled
    };
  }
}
