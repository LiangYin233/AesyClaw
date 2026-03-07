import type { Express } from 'express';
import { logger, type LogLevel } from '../../logger/index.js';
import { metrics } from '../../logger/Metrics.js';
import { createErrorResponse } from '../../utils/errors.js';
import { ConfigLoader } from '../../config/loader.js';

export function registerMetricsRoutes(app: Express): void {
  // Log config
  app.get('/api/logs/config', (req, res) => {
    res.json(logger.getConfig());
  });

  app.post('/api/logs/level', async (req, res) => {
    try {
      const { level } = req.body;
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      if (!level || !validLevels.includes(level)) {
        return res.status(400).json({ error: `Invalid log level. Must be one of: ${validLevels.join(', ')}` });
      }

      // 设置日志等级
      logger.setLevel(level);

      // 保存到配置文件
      try {
        const config = await ConfigLoader.load();
        if (!config.log) {
          config.log = { level };
        } else {
          config.log.level = level;
        }
        await ConfigLoader.save(config);
        logger.info(`Log level changed to ${level} and saved to config`);
      } catch (saveError) {
        logger.warn(`Log level changed to ${level} but failed to save to config:`, saveError);
      }

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
    const mem = process.memoryUsage();
    res.json({
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss
    });
  });

  app.get('/api/metrics/overview', (req, res) => {
    const names = metrics.getMetricNames();
    const mem = process.memoryUsage();

    let totalDataPoints = 0;
    for (const name of names) {
      const stats = metrics.getStats(name);
      if (stats) {
        totalDataPoints += stats.count;
      }
    }

    res.json({
      totalMetrics: names.length,
      totalDataPoints,
      memoryUsage: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rss: mem.rss
      }
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
