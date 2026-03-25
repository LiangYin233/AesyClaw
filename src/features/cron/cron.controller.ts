import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { CronApiService } from './CronApiService.js';
import { parseCreateCronJob, parseToggleCronJob, parseUpdateCronJob } from './cron.dto.js';

export function registerCronController(app: Express, service: CronApiService): void {
  app.get('/api/cron', (_req, res) => {
    res.json(service.listJobs());
  });

  app.get('/api/cron/:id', asyncHandler(async (req, res) => {
    res.json(service.getJob(String(req.params.id)));
  }));

  app.post('/api/cron', asyncHandler(async (req, res) => {
    res.status(201).json(service.createJob(parseCreateCronJob(req.body)));
  }));

  app.put('/api/cron/:id', asyncHandler(async (req, res) => {
    res.json(service.updateJob(String(req.params.id), parseUpdateCronJob(req.body)));
  }));

  app.delete('/api/cron/:id', asyncHandler(async (req, res) => {
    res.json(service.deleteJob(String(req.params.id)));
  }));

  app.post('/api/cron/:id/toggle', asyncHandler(async (req, res) => {
    res.json(service.toggleJob(String(req.params.id), parseToggleCronJob(req.body).enabled));
  }));
}
