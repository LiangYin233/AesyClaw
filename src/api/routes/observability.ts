import type { Express } from 'express';
import type { Config } from '../../types.js';
import { createErrorResponse, createValidationErrorResponse, NotFoundError } from '../../errors/index.js';
import { logging, metrics, tokenUsage, logger, type LogLevel } from '../../observability/index.js';
import { ConfigLoader } from '../../config/loader.js';

const log = logger.child('ObservabilityAPI');

interface ObservabilityRouteDeps {
  setConfig?: (config: Config) => void;
}

export function registerObservabilityRoutes(app: Express, deps: ObservabilityRouteDeps = {}): void {
  app.get('/api/observability/logging/config', (req, res) => {
    try {
      res.json(logging.getConfig());
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/observability/logging/entries', (req, res) => {
    try {
      const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
      const levelParam = Array.isArray(req.query.level) ? req.query.level[0] : req.query.level;
      const limit = limitParam ? parseInt(String(limitParam), 10) : 200;

      if (Number.isNaN(limit) || limit <= 0) {
        return res.status(400).json(createValidationErrorResponse('limit must be a positive integer', 'limit'));
      }

      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      if (levelParam !== undefined && (typeof levelParam !== 'string' || !validLevels.includes(levelParam as LogLevel))) {
        return res.status(400).json(createValidationErrorResponse(`level must be one of: ${validLevels.join(', ')}`, 'level'));
      }

      res.json({
        entries: logging.getEntries({
          limit,
          level: typeof levelParam === 'string' ? levelParam as LogLevel : undefined
        }),
        total: logging.getBufferSize(),
        bufferSize: logging.getConfig().bufferSize,
        level: logging.getLevel()
      });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/observability/logging/level', async (req, res) => {
    try {
      const { level } = req.body;
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      if (!level || !validLevels.includes(level)) {
        return res.status(400).json(createValidationErrorResponse(`level must be one of: ${validLevels.join(', ')}`, 'level'));
      }

      logging.setLevel(level);

      try {
        const nextConfig = await ConfigLoader.update((config) => {
          config.observability.logging.level = level;
        });
        deps.setConfig?.(nextConfig);
        log.info('Logging level updated', { level });
      } catch (saveError) {
        log.warn('Logging level updated in memory but failed to persist', {
          level,
          error: saveError instanceof Error ? saveError.message : String(saveError)
        });
      }

      res.json({ success: true, level: logging.getLevel() });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/observability/metrics/names', (req, res) => {
    try {
      res.json({ names: metrics.getMetricNames() });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/observability/metrics/stats/:name', (req, res) => {
    try {
      const { name } = req.params;
      const timeWindow = req.query.timeWindow ? parseInt(String(req.query.timeWindow), 10) : undefined;
      const stats = metrics.getStats(name, timeWindow);
      if (!stats) {
        return res.status(404).json(createErrorResponse(new NotFoundError('Metric', name)));
      }
      res.json(stats);
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/observability/metrics/export', (req, res) => {
    try {
      const { name, timeWindow } = req.query;
      const parsedWindow = timeWindow ? parseInt(String(timeWindow), 10) : undefined;
      const exported = metrics.export(typeof name === 'string' ? name : undefined, parsedWindow);
      res.json({ count: exported.length, metrics: exported });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/observability/metrics/clear', (req, res) => {
    try {
      const { name } = req.body;
      metrics.clear(typeof name === 'string' ? name : undefined);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/observability/metrics/memory', (req, res) => {
    try {
      const memoryUsage = process.memoryUsage();
      res.json({
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
        arrayBuffers: memoryUsage.arrayBuffers
      });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/observability/metrics/overview', (req, res) => {
    try {
      const names = metrics.getMetricNames();
      const memoryUsage = process.memoryUsage();
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
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          external: memoryUsage.external,
          rss: memoryUsage.rss
        }
      });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/observability/metrics/config', (req, res) => {
    try {
      res.json(metrics.getConfig());
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/observability/metrics/config', async (req, res) => {
    try {
      const { enabled, maxPoints } = req.body;
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return res.status(400).json(createValidationErrorResponse('enabled must be a boolean', 'enabled'));
      }
      if (maxPoints !== undefined && (!Number.isInteger(maxPoints) || maxPoints <= 0)) {
        return res.status(400).json(createValidationErrorResponse('maxPoints must be a positive integer', 'maxPoints'));
      }

      metrics.configure({
        ...(enabled !== undefined ? { enabled } : {}),
        ...(maxPoints !== undefined ? { maxPoints } : {})
      });

      const nextConfig = await ConfigLoader.update((config) => {
        if (enabled !== undefined) {
          config.observability.metrics.enabled = enabled;
        }
        if (maxPoints !== undefined) {
          config.observability.metrics.maxPoints = maxPoints;
        }
      });
      deps.setConfig?.(nextConfig);

      res.json({ success: true, config: metrics.getConfig() });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/observability/usage', (req, res) => {
    try {
      res.json(tokenUsage.getStats());
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/observability/usage/reset', (req, res) => {
    try {
      tokenUsage.reset();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });
}
