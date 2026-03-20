import type { Express } from 'express';
import type { PluginManager } from '../../plugins/index.js';
import type { Config } from '../../types.js';
import { badRequest, notFound, serverError, unavailable } from './helpers.js';

interface PluginRouteDeps {
  pluginManager?: PluginManager;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
}

export function registerPluginRoutes(app: Express, deps: PluginRouteDeps): void {
  const { pluginManager, getConfig, updateConfig } = deps;

  app.get('/api/plugins', async (req, res) => {
    try {
      if (!pluginManager) return res.json({ plugins: [] });
      const plugins = await pluginManager.getAllPlugins();
      res.json({ plugins });
    } catch (error: unknown) {
      serverError(res, error);
    }
  });

  app.post('/api/plugins/:name/toggle', async (req, res) => {
    try {
      if (!pluginManager) {
        return unavailable(res, 'Plugin manager not available');
      }
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return badRequest(res, 'enabled is required and must be a boolean', 'enabled');
      }
      const { name } = req.params;
      const success = await pluginManager.enablePlugin(name, enabled);
      if (!success) {
        return notFound(res, 'Plugin', name);
      }
      await updateConfig((config) => {
        config.plugins[name] = {
          ...(config.plugins[name] || {}),
          enabled
        };
      });
      res.json({ success: true });
    } catch (error: unknown) {
      serverError(res, error);
    }
  });

  app.put('/api/plugins/:name/config', async (req, res) => {
    try {
      if (!pluginManager) {
        return unavailable(res, 'Plugin manager not available');
      }
      const { options } = req.body;
      if (!options || typeof options !== 'object') {
        return badRequest(res, 'options is required and must be an object', 'options');
      }
      const { name } = req.params;
      const success = await pluginManager.updatePluginConfig(name, options);
      if (!success) {
        return notFound(res, 'Plugin', name);
      }
      const config = getConfig();
      const currentEnabled = config.plugins[name]?.enabled ?? true;
      await updateConfig((config) => {
        config.plugins[name] = {
          ...(config.plugins[name] || {}),
          enabled: currentEnabled,
          options
        };
      });
      res.json({ success: true });
    } catch (error: unknown) {
      serverError(res, error);
    }
  });
}
