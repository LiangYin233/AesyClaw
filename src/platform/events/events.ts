import type { Config } from '../../types.js';

export interface AesyClawEvents {
  'config.changed': {
    previousConfig: Config;
    currentConfig: Config;
  };
  'cron.job.executed': {
    jobId: string;
    jobName: string;
    target?: string;
  };
  'cron.job.failed': {
    jobId: string;
    jobName: string;
    target?: string;
    error: Error;
  };
  'mcp.tools.synced': {
    serverName?: string;
    count?: number;
  };
  'plugin.runtime.updated': {
    pluginName?: string;
    state?: 'loaded' | 'updated' | 'failed';
  };
}
