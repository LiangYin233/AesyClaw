import type { Config } from '../types.js';

export const DEFAULT_CONFIG: Config = {
  server: {
    host: '0.0.0.0',
    apiPort: 18792,
    apiEnabled: true,
    token: ''
  },
  agent: {
    defaults: {
      model: 'gpt-4o',
      provider: 'openai',
      description: '内建主 Agent',
      vision: false,
      reasoning: false,
      visionProvider: '',
      visionModel: '',
      maxToolIterations: 40,
      memoryWindow: 50,
      memorySummary: {
        enabled: false,
        provider: '',
        model: '',
        triggerMessages: 50
      },
      memoryFacts: {
        enabled: false,
        provider: '',
        model: '',
        maxFacts: 100
      },
      systemPrompt: 'You are a helpful AI assistant.',
      contextMode: 'channel',
      maxSessions: 100
    }
  },
  agents: {
    roles: {}
  },
  channels: {},
  providers: {
    openai: {
      apiKey: '',
      apiBase: 'https://api.openai.com/v1',
      model: 'gpt-4o'
    }
  },
  skills: {},
  tools: {
    timeoutMs: 30000
  },
  log: {
    level: 'info'
  },
  metrics: {
    enabled: true,
    maxMetrics: 10000
  }
};

function merge(base: any, override: any): any {
  if (!override || Object.keys(override).length === 0) {
    return base;
  }

  if (!base || typeof base !== 'object') {
    return override;
  }

  const result: any = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      result[key] = merge(base[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function normalizeConfig(config: Config): Config {
  const normalized = merge(DEFAULT_CONFIG, config);
  if (config.providers && Object.keys(config.providers).length > 0) {
    normalized.providers = config.providers;
  }
  normalized.agents ||= { roles: {} };
  normalized.agents.roles ||= {};
  normalized.agent.defaults.memorySummary ||= {
    enabled: false,
    provider: '',
    model: '',
    triggerMessages: 50
  };
  normalized.agent.defaults.memoryFacts ||= {
    enabled: false,
    provider: '',
    model: '',
    maxFacts: 100
  };
  normalized.tools ||= {
    timeoutMs: 30000
  };
  normalized.agent.defaults.description ||= '内建主 Agent';
  if ('blacklist' in normalized.tools) {
    delete (normalized.tools as Record<string, unknown>).blacklist;
  }

  return normalized;
}
