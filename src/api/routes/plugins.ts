import type { Express } from 'express';
import type { PluginManager } from '../../plugins/index.js';
import { ConfigLoader } from '../../config/loader.js';
import { createErrorResponse, createValidationErrorResponse, NotFoundError } from '../../logger/index.js';

export function registerPluginRoutes(app: Express, pluginManager?: PluginManager): void {
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
      await ConfigLoader.updatePluginConfig(name, enabled);
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
      const currentEnabled = config.plugins?.[name]?.enabled ?? true;
      await ConfigLoader.updatePluginConfig(name, currentEnabled, options);
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });
}
