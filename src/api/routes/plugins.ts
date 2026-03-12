import type { Express } from 'express';
import type { PluginManager } from '../../plugins/index.js';
import type { Config } from '../../types.js';
import { ConfigLoader } from '../../config/loader.js';
import { createErrorResponse, createValidationErrorResponse, NotFoundError } from '../../logger/index.js';

interface PluginRouteDeps {
  pluginManager?: PluginManager;
  setConfig?: (config: Config) => void;
}

export function registerPluginRoutes(app: Express, deps: PluginRouteDeps = {}): void {
  const { pluginManager, setConfig } = deps;

  app.get('/api/plugins', async (req, res) => {
    try {
      if (!pluginManager) return res.json({ plugins: [] });
      const plugins = await pluginManager.getAllPlugins();
      res.json({ plugins });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/plugins/:name/toggle', async (req, res) => {
    try {
      if (!pluginManager) {
        return res.status(503).json(createErrorResponse(new Error('Plugin manager not available')));
      }
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json(createValidationErrorResponse('enabled is required and must be a boolean', 'enabled'));
      }
      const { name } = req.params;
      const success = await pluginManager.enablePlugin(name, enabled);
      if (!success) {
        return res.status(404).json(createErrorResponse(new NotFoundError('Plugin', name)));
      }
      const nextConfig = await ConfigLoader.updatePluginConfig(name, enabled);
      setConfig?.(nextConfig);
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/plugins/:name/reload', async (req, res) => {
    try {
      if (!pluginManager) {
        return res.status(503).json(createErrorResponse(new Error('Plugin manager not available')));
      }
      const { name } = req.params;
      const success = await pluginManager.reloadPlugin(name);
      if (!success) {
        return res.status(404).json(createErrorResponse(new NotFoundError('Plugin', name)));
      }
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.put('/api/plugins/:name/config', async (req, res) => {
    try {
      if (!pluginManager) {
        return res.status(503).json(createErrorResponse(new Error('Plugin manager not available')));
      }
      const { options } = req.body;
      if (!options || typeof options !== 'object') {
        return res.status(400).json(createValidationErrorResponse('options is required and must be an object', 'options'));
      }
      const { name } = req.params;
      const success = await pluginManager.updatePluginConfig(name, options);
      if (!success) {
        return res.status(404).json(createErrorResponse(new NotFoundError('Plugin', name)));
      }
      const config = ConfigLoader.get();
      const currentEnabled = config.plugins[name]?.enabled ?? true;
      const nextConfig = await ConfigLoader.updatePluginConfig(name, currentEnabled, options);
      setConfig?.(nextConfig);
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });
}
