import { MiddlewareFunc } from '../../agent/core/types';
import { ITool } from '../../platform/tools/types';

export interface PluginContext {
  config: Record<string, unknown>;
  logger: {
    info: (msg: string, data?: Record<string, unknown>) => void;
    warn: (msg: string, data?: Record<string, unknown>) => void;
    error: (msg: string, data?: Record<string, unknown>) => void;
    debug: (msg: string, data?: Record<string, unknown>) => void;
  };
}

export interface IPlugin {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  
  tools?: ITool[];
  middlewares?: MiddlewareFunc[];
  
  init?: (context: PluginContext) => Promise<void>;
  destroy?: () => Promise<void>;
}

export interface PluginInfo {
  name: string;
  description: string;
  version?: string;
  loaded: boolean;
  toolCount: number;
  middlewareCount: number;
}
