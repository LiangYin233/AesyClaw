import type { Express } from 'express';
import type { PluginManager } from '../../plugins/index.js';
import { ConfigLoader } from '../../config/loader.js';
import { createErrorResponse } from '../../utils/errors.js';

export function registerPluginRoutes(app: Express, pluginManager?: PluginManager): void {
  app.get('/api/plugins', async (req, res) => {
    if (!pluginManager) return res.json({ plugins: [] });
    const plugins = await pluginManager.getAllPlugins();
    res.json({ plugins });
  });

  app.post('/api/plugins/:name/toggle', async (req, res) => {
    if (!pluginManager) return res.status(500).json({ success: false, error: 'Plugin manager not available' });
    try {
      const { enabled } = req.body;
      const { name } = req.params;
      const success = await pluginManager.enablePlugin(name, enabled);
      if (success) {
        await ConfigLoader.updatePluginConfig(name, enabled);
        res.json({ success: true });
      } else {
        res.status(500).json({ success: false, error: 'Failed to toggle plugin' });
      }
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/plugins/:name/reload', async (req, res) => {
    if (!pluginManager) return res.status(500).json({ success: false, error: 'Plugin manager not available' });
    const { name } = req.params;
    const success = await pluginManager.reloadPlugin(name);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Failed to reload plugin' });
    }
  });

  app.put('/api/plugins/:name/config', async (req, res) => {
    if (!pluginManager) return res.status(500).json({ success: false, error: 'Plugin manager not available' });
    try {
      const { options } = req.body;
      const { name } = req.params;
      const success = await pluginManager.updatePluginConfig(name, options);
      if (success) {
        const config = ConfigLoader.get();
        const currentEnabled = config.plugins?.[name]?.enabled ?? true;
        await ConfigLoader.updatePluginConfig(name, currentEnabled, options);
        res.json({ success: true });
      } else {
        res.status(500).json({ success: false, error: 'Failed to update plugin config' });
      }
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });
}
