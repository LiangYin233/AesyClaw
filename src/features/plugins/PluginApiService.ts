import { NotFoundError, ValidationError } from '../../api/errors.js';
import type { PluginInfo } from '../../plugins/types.js';
import { PluginRepository } from './PluginRepository.js';

export class PluginApiService {
  constructor(private readonly pluginRepository: PluginRepository) {}

  async listPlugins(): Promise<{ plugins: PluginInfo[] }> {
    return {
      plugins: await this.pluginRepository.listAll()
    };
  }

  async togglePlugin(name: string, body: unknown): Promise<{ success: true }> {
    const payload = this.requireBody(body);
    if (typeof payload.enabled !== 'boolean') {
      throw new ValidationError('enabled is required and must be a boolean', 'enabled');
    }

    const updated = await this.pluginRepository.setEnabled(name, payload.enabled);
    if (!updated) {
      throw new NotFoundError('Plugin', name);
    }

    return { success: true };
  }

  async updatePluginConfig(name: string, body: unknown): Promise<{ success: true }> {
    const payload = this.requireBody(body);
    if (!payload.options || typeof payload.options !== 'object' || Array.isArray(payload.options)) {
      throw new ValidationError('options is required and must be an object', 'options');
    }

    const updated = await this.pluginRepository.updateOptions(name, payload.options as Record<string, unknown>);
    if (!updated) {
      throw new NotFoundError('Plugin', name);
    }

    return { success: true };
  }

  private requireBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('request body must be an object');
    }
    return body as Record<string, unknown>;
  }
}
