import type { Express } from 'express';
import { randomUUID } from 'crypto';
import type { CronService } from '../../cron/index.js';

export function registerCronRoutes(app: Express, cronService?: CronService): void {
  if (!cronService) return;

  app.get('/api/cron', (req, res) => {
    res.json({ jobs: cronService.listJobs() });
  });

  app.get('/api/cron/:id', (req, res) => {
    const job = cronService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  });

  app.post('/api/cron', (req, res) => {
    const { name, schedule, payload, enabled } = req.body;
    if (!name || !schedule || !payload) {
      return res.status(400).json({ success: false, error: 'name, schedule, and payload are required' });
    }
    if (!['once', 'interval', 'daily', 'cron'].includes(schedule.kind)) {
      return res.status(400).json({ success: false, error: 'Invalid schedule kind' });
    }
    const job = cronService.addJob({
      id: randomUUID().slice(0, 8),
      name,
      enabled: enabled !== false,
      schedule,
      payload
    });
    res.json({ success: true, job });
  });

  app.put('/api/cron/:id', (req, res) => {
    const { name, schedule, payload, enabled } = req.body;
    const existing = cronService.getJob(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Job not found' });

    if (name !== undefined) existing.name = name;
    if (schedule !== undefined) existing.schedule = schedule;
    if (payload !== undefined) existing.payload = payload;
    if (enabled !== undefined) existing.enabled = enabled;

    cronService.computeNextRun(existing);
    cronService.removeJob(req.params.id);
    cronService.addJob(existing);
    res.json({ success: true, job: existing });
  });

  app.delete('/api/cron/:id', (req, res) => {
    const removed = cronService.removeJob(req.params.id);
    if (!removed) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true });
  });

  app.post('/api/cron/:id/toggle', (req, res) => {
    const { enabled } = req.body;
    const job = cronService.getJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    cronService.enableJob(req.params.id, enabled);
    res.json({ success: true, enabled });
  });
}
