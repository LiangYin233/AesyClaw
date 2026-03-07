import type { Express } from 'express';
import { logger, type LogLevel, createErrorResponse, createValidationErrorResponse, NotFoundError } from '../../logger/index.js';
import { metrics } from '../../logger/Metrics.js';
import { ConfigLoader } from '../../config/loader.js';

const log = logger.child({ prefix: 'MetricsAPI' });

export function registerMetricsRoutes(app: Express): void {
  // Log config
  app.get('/api/logs/config', (req, res) => {
    try {
      res.json(logger.getConfig());
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/logs/level', async (req, res) => {
    try {
      const { level } = req.body;
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      if (!level || !validLevels.includes(level)) {
        return res.status(400).json(createValidationErrorResponse(`level must be one of: ${validLevels.join(', ')}`, 'level'));
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
        log.info(`Log level changed to ${level} and saved to config`);
      } catch (saveError) {
        log.warn(`Log level changed to ${level} but failed to save to config:`, saveError);
      }

      res.json({ success: true, level: logger.getLevel() });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  // Metrics
  app.get('/api/metrics/names', (req, res) => {
    try {
      res.json({ names: metrics.getMetricNames() });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/metrics/stats/:name', (req, res) => {
    try {
      const { name } = req.params;
      const window = req.query.timeWindow ? parseInt(req.query.timeWindow as string) : undefined;
      const stats = metrics.getStats(name, window);
      if (!stats) {
        return res.status(404).json(createErrorResponse(new NotFoundError('Metric', name)));
      }
      res.json(stats);
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/metrics/export', (req, res) => {
    try {
      const { name, timeWindow } = req.query;
      const window = timeWindow ? parseInt(timeWindow as string) : undefined;
      const data = metrics.export(name as string | undefined, window);
      res.json({ count: data.length, metrics: data });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/metrics/clear', (req, res) => {
    try {
      const { name } = req.body;
      metrics.clear(name);
      res.json({ success: true, message: name ? `Cleared metrics for "${name}"` : 'Cleared all metrics' });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/metrics/memory', (req, res) => {
    try {
      const mem = process.memoryUsage();
      res.json({
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rss: mem.rss,
        arrayBuffers: mem.arrayBuffers
      });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/metrics/overview', (req, res) => {
    try {
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
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/metrics/config', (req, res) => {
    try {
      res.json(metrics.getConfig());
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/metrics/config', (req, res) => {
    try {
      const { enabled } = req.body;
      if (enabled !== undefined) {
        if (typeof enabled !== 'boolean') {
          return res.status(400).json(createValidationErrorResponse('enabled must be a boolean', 'enabled'));
        }
        metrics.setEnabled(enabled);
      }
      res.json({ success: true, config: metrics.getConfig() });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });
}
