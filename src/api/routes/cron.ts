import type { Express } from 'express';
import { randomUUID } from 'crypto';
import type { CronService } from '../../cron/index.js';
import { createErrorResponse, createValidationErrorResponse, NotFoundError } from '../../errors/index.js';

export function registerCronRoutes(app: Express, cronService?: CronService): void {
  if (!cronService) return;

  app.get('/api/cron', (req, res) => {
    res.json({ jobs: cronService.listJobs() });
  });

  app.get('/api/cron/:id', (req, res) => {
    const job = cronService.getJob(req.params.id);
    if (!job) return res.status(404).json(createErrorResponse(new NotFoundError('Cron job', req.params.id)));
    res.json({ job });
  });

  app.post('/api/cron', (req, res) => {
    try {
      const { name, schedule, payload, enabled } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json(createValidationErrorResponse('name is required and must be a string', 'name'));
      }
      if (!schedule || typeof schedule !== 'object') {
        return res.status(400).json(createValidationErrorResponse('schedule is required and must be an object', 'schedule'));
      }
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json(createValidationErrorResponse('payload is required and must be an object', 'payload'));
      }
      if (!['once', 'interval', 'daily', 'cron'].includes(schedule.kind)) {
        return res.status(400).json(createValidationErrorResponse('schedule.kind must be one of: once, interval, daily, cron', 'schedule.kind'));
      }
      const job = cronService.addJob({
        id: randomUUID().slice(0, 8),
        name,
        enabled: enabled !== false,
        schedule,
        payload
      });
      res.status(201).json({ success: true, job });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.put('/api/cron/:id', (req, res) => {
    try {
      const { name, schedule, payload, enabled } = req.body;
      const existing = cronService.getJob(req.params.id);
      if (!existing) return res.status(404).json(createErrorResponse(new NotFoundError('Cron job', req.params.id)));

      if (name !== undefined) {
        if (typeof name !== 'string') {
          return res.status(400).json(createValidationErrorResponse('name must be a string', 'name'));
        }
        existing.name = name;
      }
      if (schedule !== undefined) {
        if (typeof schedule !== 'object') {
          return res.status(400).json(createValidationErrorResponse('schedule must be an object', 'schedule'));
        }
        existing.schedule = schedule;
      }
      if (payload !== undefined) {
        if (typeof payload !== 'object') {
          return res.status(400).json(createValidationErrorResponse('payload must be an object', 'payload'));
        }
        existing.payload = payload;
      }
      if (enabled !== undefined) {
        if (typeof enabled !== 'boolean') {
          return res.status(400).json(createValidationErrorResponse('enabled must be a boolean', 'enabled'));
        }
        existing.enabled = enabled;
      }

      cronService.computeNextRun(existing);
      cronService.removeJob(req.params.id);
      cronService.addJob(existing);
      res.json({ success: true, job: existing });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.delete('/api/cron/:id', (req, res) => {
    try {
      const removed = cronService.removeJob(req.params.id);
      if (!removed) return res.status(404).json(createErrorResponse(new NotFoundError('Cron job', req.params.id)));
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/cron/:id/toggle', (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json(createValidationErrorResponse('enabled is required and must be a boolean', 'enabled'));
      }
      const job = cronService.getJob(req.params.id);
      if (!job) return res.status(404).json(createErrorResponse(new NotFoundError('Cron job', req.params.id)));
      cronService.enableJob(req.params.id, enabled);
      res.json({ success: true, enabled });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });
}
