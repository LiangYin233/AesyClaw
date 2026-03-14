import type { Express } from 'express';
import type { Config } from '../../types.js';
import { logging, tokenUsage, logger, type LogLevel } from '../../observability/index.js';
import { ConfigLoader } from '../../config/loader.js';
import { badRequest, serverError } from './helpers.js';

const log = logger.child('ObservabilityAPI');

interface ObservabilityRouteDeps {
  setConfig?: (config: Config) => void;
}

export function registerObservabilityRoutes(app: Express, deps: ObservabilityRouteDeps = {}): void {
  app.get('/api/observability/logging/config', (req, res) => {
    try {
      res.json(logging.getConfig());
    } catch (error) {
      serverError(res, error);
    }
  });

  app.get('/api/observability/logging/entries', (req, res) => {
    try {
      const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
      const levelParam = Array.isArray(req.query.level) ? req.query.level[0] : req.query.level;
      const limit = limitParam ? parseInt(String(limitParam), 10) : 200;

      if (Number.isNaN(limit) || limit <= 0) {
        return badRequest(res, 'limit must be a positive integer', 'limit');
      }

      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      if (levelParam !== undefined && (typeof levelParam !== 'string' || !validLevels.includes(levelParam as LogLevel))) {
        return badRequest(res, `level must be one of: ${validLevels.join(', ')}`, 'level');
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
      serverError(res, error);
    }
  });

  app.post('/api/observability/logging/level', async (req, res) => {
    try {
      const { level } = req.body;
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      if (!level || !validLevels.includes(level)) {
        return badRequest(res, `level must be one of: ${validLevels.join(', ')}`, 'level');
      }

      logging.setLevel(level);

      try {
        const nextConfig = await ConfigLoader.update((config) => {
          config.observability.level = level;
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
      serverError(res, error);
    }
  });

  app.get('/api/observability/usage', (req, res) => {
    try {
      res.json(tokenUsage.getStats());
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/observability/usage/reset', (req, res) => {
    try {
      tokenUsage.reset();
      res.json({ success: true });
    } catch (error) {
      serverError(res, error);
    }
  });
}
