/**
 * Service Tokens for Dependency Injection
 *
 * Each token uniquely identifies a service in the DI container.
 * Using symbols ensures type safety and prevents naming collisions.
 */

export const TOKENS = {
  // Core Infrastructure
  EventBus: Symbol('EventBus'),
  Config: Symbol('Config'),
  ConfigService: Symbol('ConfigService'),
  Workspace: Symbol('Workspace'),

  // LLM & Tools
  LLMProvider: Symbol('LLMProvider'),
  ToolRegistry: Symbol('ToolRegistry'),

  // Session & State
  SessionManager: Symbol('SessionManager'),

  // Agent & Plugins
  AgentLoop: Symbol('AgentLoop'),
  PluginManager: Symbol('PluginManager'),

  // Skills
  SkillManager: Symbol('SkillManager'),

  // Channels & Communication
  ChannelManager: Symbol('ChannelManager'),

  // MCP Integration
  MCPClientManager: Symbol('MCPClientManager'),

  // Cron Jobs
  CronService: Symbol('CronService'),

  // API Server
  APIServer: Symbol('APIServer'),
} as const;

// Type helper to get service type from token
export type TokenType<T extends symbol> = T extends typeof TOKENS[keyof typeof TOKENS] ? any : never;
