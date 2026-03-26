import type { CronJob, CronRuntimeService } from '../index.js';

export class CronRepository {
  constructor(private readonly cronService: CronRuntimeService) {}

  async list(): Promise<CronJob[]> {
    return this.cronService.listJobs();
  }

  async getById(id: string): Promise<CronJob | undefined> {
    return this.cronService.getJob(id);
  }

  async create(job: CronJob): Promise<CronJob> {
    return this.cronService.addJob(job);
  }

  async save(job: CronJob): Promise<CronJob> {
    return this.cronService.saveJob(job);
  }

  async delete(id: string): Promise<boolean> {
    return this.cronService.removeJob(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.cronService.enableJob(id, enabled);
  }
}
