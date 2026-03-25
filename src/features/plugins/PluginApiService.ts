import { NotFoundError } from '../../api/errors.js';
import type { PluginInfo } from '../../plugins/types.js';
import { PluginRepository } from './PluginRepository.js';

export class PluginApiService {
  constructor(private readonly pluginRepository: PluginRepository) {}

  async listPlugins(): Promise<{ plugins: PluginInfo[] }> {
    return {
      plugins: await this.pluginRepository.listAll()
    };
  }

  async togglePlugin(name: string, enabled: boolean): Promise<{ success: true }> {
    const updated = await this.pluginRepository.setEnabled(name, enabled);
    if (!updated) {
      throw new NotFoundError('Plugin', name);
    }

    return { success: true };
  }

  async updatePluginConfig(name: string, options: Record<string, unknown>): Promise<{ success: true }> {
    const updated = await this.pluginRepository.updateOptions(name, options);
    if (!updated) {
      throw new NotFoundError('Plugin', name);
    }

    return { success: true };
  }
}
