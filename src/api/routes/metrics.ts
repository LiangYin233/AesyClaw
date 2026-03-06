import type { Express } from 'express';
import { logger, type LogLevel } from '../../logger/index.js';
import { metrics } from '../../logger/Metrics.js';
import { createErrorResponse } from '../../utils/errors.js';

export function registerMetricsRoutes(app: Express): void {
  // Log config
  app.get('/api/logs/config', (req, res) => {
    res.json(logger.getConfig());
  });

  app.post('/api/logs/level', (req, res) => {
    try {
      const { level } = req.body;
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      if (!level || !validLevels.includes(level)) {
        return res.status(400).json({ error: `Invalid log level. Must be one of: ${validLevels.join(', ')}` });
      }
      logger.setLevel(level);
      res.json({ success: true, level: logger.getLevel() });
    } catch (error) {
      res.status(400).json(createErrorResponse(error));
    }
  });

  // Metrics
  app.get('/api/metrics/names', (req, res) => {
    res.json({ names: metrics.getMetricNames() });
  });

  app.get('/api/metrics/stats/:name', (req, res) => {
    const { name } = req.params;
    const window = req.query.timeWindow ? parseInt(req.query.timeWindow as string) : undefined;
    const stats = metrics.getStats(name, window);
    if (!stats) return res.status(404).json({ error: `Metric "${name}" not found or no data available` });
    res.json(stats);
  });

  app.get('/api/metrics/export', (req, res) => {
    const { name, timeWindow } = req.query;
    const window = timeWindow ? parseInt(timeWindow as string) : undefined;
    const data = metrics.export(name as string | undefined, window);
    res.json({ count: data.length, metrics: data });
  });

  app.post('/api/metrics/clear', (req, res) => {
    const { name } = req.body;
    metrics.clear(name);
    res.json({ success: true, message: name ? `Cleared metrics for "${name}"` : 'Cleared all metrics' });
  });

  app.get('/api/metrics/memory', (req, res) => {
    res.json(metrics.getMemoryUsage());
  });

  app.get('/api/metrics/overview', (req, res) => {
    const timeWindow = 60000;
    res.json({
      agent: {
        processMessage: metrics.getStats('agent.process_message', timeWindow),
        messageCount: metrics.getStats('agent.message_count', timeWindow),
        toolExecution: metrics.getStats('agent.tool_execution', timeWindow)
      },
      tools: {
        executionTime: metrics.getStats('tool.execution_time', timeWindow),
        callCount: metrics.getStats('tool.call_count', timeWindow)
      },
      plugins: {
        hookExecution: metrics.getStats('plugin.hook_execution', timeWindow),
        hookCount: metrics.getStats('plugin.hook_count', timeWindow)
      },
      memory: metrics.getMemoryUsage()
    });
  });

  app.get('/api/metrics/config', (req, res) => {
    res.json(metrics.getConfig());
  });

  app.post('/api/metrics/config', (req, res) => {
    try {
      const { enabled } = req.body;
      if (enabled !== undefined && typeof enabled === 'boolean') {
        metrics.setEnabled(enabled);
      }
      res.json({ success: true, config: metrics.getConfig() });
    } catch (error) {
      res.status(400).json(createErrorResponse(error));
    }
  });
}
