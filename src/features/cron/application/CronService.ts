import type { CronJob } from '../index.js';
import { ResourceNotFoundError } from '../../../platform/errors/domain.js';
import { createShortId } from '../../../platform/utils/createShortId.js';
import { CronRepository } from '../infrastructure/CronRepository.js';
import type { CreateCronJobDto, UpdateCronJobDto } from '../contracts/cron.dto.js';

export class CronService {
  constructor(private readonly cronRepository: CronRepository) {}

  async listJobs(): Promise<{ jobs: CronJob[] }> {
    return { jobs: await this.cronRepository.list() };
  }

  async getJob(id: string): Promise<{ job: CronJob }> {
    const job = await this.cronRepository.getById(id);
    if (!job) {
      throw new ResourceNotFoundError('Cron job', id);
    }
    return { job };
  }

  async createJob(input: CreateCronJobDto): Promise<{ success: true; job: CronJob }> {
    const job = await this.cronRepository.create({
      id: createShortId(),
      name: input.name,
      enabled: input.enabled,
      schedule: input.schedule,
      payload: input.payload
    });

    return { success: true, job };
  }

  async updateJob(id: string, input: UpdateCronJobDto): Promise<{ success: true; job: CronJob }> {
    const existing = await this.cronRepository.getById(id);
    if (!existing) {
      throw new ResourceNotFoundError('Cron job', id);
    }

    const nextJob: CronJob = {
      ...existing,
      schedule: { ...existing.schedule },
      payload: { ...existing.payload }
    };

    if (input.name !== undefined) {
      nextJob.name = input.name;
    }
    if (input.schedule !== undefined) {
      nextJob.schedule = input.schedule;
    }
    if (input.payload !== undefined) {
      nextJob.payload = input.payload;
    }
    if (input.enabled !== undefined) {
      nextJob.enabled = input.enabled;
    }

    return { success: true, job: await this.cronRepository.save(nextJob) };
  }

  async deleteJob(id: string): Promise<{ success: true }> {
    const removed = await this.cronRepository.delete(id);
    if (!removed) {
      throw new ResourceNotFoundError('Cron job', id);
    }
    return { success: true };
  }

  async toggleJob(id: string, enabled: boolean): Promise<{ success: true; enabled: boolean }> {
    const job = await this.cronRepository.getById(id);
    if (!job) {
      throw new ResourceNotFoundError('Cron job', id);
    }

    await this.cronRepository.setEnabled(id, enabled);
    return {
      success: true,
      enabled
    };
  }
}
