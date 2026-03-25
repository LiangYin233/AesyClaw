import { getConfigValidationIssue } from '../../config/index.js';
import { preserveServerTokenInApiConfig, sanitizeConfigForApi } from '../../api/configPayload.js';
import { ValidationError } from '../../api/errors.js';
import type { Config } from '../../types.js';
import { ConfigRepository } from './ConfigRepository.js';

export class ConfigApiService {
  constructor(private readonly configRepository: ConfigRepository) {}

  getApiConfig(): ReturnType<typeof sanitizeConfigForApi> {
    return sanitizeConfigForApi(this.configRepository.getConfig());
  }

  async updateApiConfig(nextConfig: Record<string, unknown>): Promise<{ success: true }> {
    try {
      const currentConfig = this.configRepository.getConfig();
      await this.configRepository.updateConfig(
        () => preserveServerTokenInApiConfig(nextConfig, currentConfig) as Config
      );
      return { success: true };
    } catch (error) {
      const issue = getConfigValidationIssue(error);
      if (issue) {
        throw new ValidationError(issue.message, issue.field);
      }
      throw error;
    }
  }
}
