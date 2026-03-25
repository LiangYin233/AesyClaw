import { getConfigValidationIssue } from '../../../config/index.js';
import { DomainValidationError } from '../../../platform/errors/domain.js';
import type { Config } from '../../../types.js';
import { sanitizeConfigForApi, preserveServerTokenInApiConfig } from '../api/configPayload.js';
import { ConfigRepository } from '../infrastructure/ConfigRepository.js';

export class ConfigService {
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
        throw new DomainValidationError(issue.message, issue.field);
      }
      throw error;
    }
  }
}
