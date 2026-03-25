import type { CronJob, CronRuntimeService } from '../index.js';

export class CronRepository {
  constructor(private readonly cronService: CronRuntimeService) {}

  list() {
    return this.cronService.listJobs();
  }

  getById(id: string): CronJob | undefined {
    return this.cronService.getJob(id);
  }

  create(job: CronJob): CronJob {
    return this.cronService.addJob(job);
  }

  save(job: CronJob): CronJob {
    this.cronService.computeNextRun(job);
    this.cronService.removeJob(job.id);
    return this.cronService.addJob(job);
  }

  delete(id: string): boolean {
    return this.cronService.removeJob(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    this.cronService.enableJob(id, enabled);
  }
}
