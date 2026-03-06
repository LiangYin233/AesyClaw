/**
 * Service Interfaces for Dependency Injection
 *
 * These interfaces define the contracts for services in the DI container.
 * They enable loose coupling and make testing easier by allowing mock implementations.
 */

import type {
  InboundMessage,
  OutboundMessage,
  Config,
  LLMMessage,
  ToolDefinition,
  ToolCall,
  LLMResponse
} from '../types.js';
import type { ToolContext, Tool } from '../tools/ToolRegistry.js';
import type { PluginCommand } from '../plugins/PluginManager.js';
import type { SkillInfo } from '../skills/index.js';

/**
 * Agent Loop Interface
 * Handles message processing and LLM interactions
 */
export interface IAgentLoop {
  processMessage(msg: InboundMessage): Promise<AgentResponse>;
  setPluginManager(pm: IPluginManager): void;
  setSkillManager(sm: ISkillManager): void;
  start(): void;
  stop(): void;
}

export interface AgentResponse {
  content: string;
  toolCalls?: ToolCall[];
  error?: string;
}

/**
 * Plugin Manager Interface
 * Manages plugin lifecycle and hooks
 */
export interface IPluginManager {
  // Lifecycle
  loadFromConfig(config: Record<string, { enabled: boolean; options?: Record<string, any> }>): Promise<void>;
  enablePlugin(name: string, enabled: boolean): Promise<boolean>;
  setPluginConfigs(configs: Record<string, { enabled: boolean; options?: Record<string, any> }>): void;
  applyDefaultConfigs(): Promise<Record<string, any>>;

  // Hooks
  applyOnMessage(msg: InboundMessage): Promise<InboundMessage | null>;
  applyOnResponse(msg: OutboundMessage): Promise<OutboundMessage | null>;
  applyOnAgentBefore(messages: LLMMessage[], tools: ToolDefinition[]): Promise<{ messages: LLMMessage[]; tools: ToolDefinition[] }>;
  applyOnAgentAfter(response: LLMResponse): Promise<LLMResponse>;
  applyOnBeforeToolCall(toolName: string, params: any): Promise<{ toolName: string; params: any }>;
  applyOnToolCall(toolName: string, result: any): Promise<any>;
  applyOnError(context: any): Promise<void>;

  // Commands
  matchCommand(content: string): Promise<{ plugin: string; command: PluginCommand; args: string[] } | null>;

  // Query
  listPlugins(): Array<{ name: string; version: string; enabled: boolean; description?: string }>;
  getPlugin(name: string): any | null;
}

/**
 * Session Manager Interface
 * Manages conversation sessions and history
 */
export interface ISessionManager {
  ready(): Promise<void>;
  loadAll(): Promise<void>;
  getOrCreate(sessionId: string): any;
  get(sessionId: string): any | null;
  delete(sessionId: string): Promise<void>;
  count(): number;
  list(): string[];
  clear(): Promise<void>;
}

/**
 * Config Service Interface
 * Manages configuration loading, validation, and persistence
 */
export interface IConfigService {
  get(): Config;
  save(config: Config): Promise<void>;
  watch(callback: (config: Config) => void): void;
  updatePluginConfig(name: string, enabled: boolean, options?: Record<string, any>): Promise<void>;
  validate(config: Config): ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Skill Manager Interface
 * Manages skill discovery and execution
 */
export interface ISkillManager {
  loadFromDirectory(): Promise<void>;
  listSkills(): SkillInfo[];
  getSkill(name: string): SkillInfo | null;
  readSkillFile(skillName: string, fileName?: string): Promise<string | null>;
  listSkillFiles(skillName: string): Promise<Array<{ name: string; isDirectory: boolean }> | null>;
  setConfig(config: Config): void;
  buildSkillsPrompt(): string;
}

/**
 * Tool Registry Interface
 * Manages tool registration and execution
 */
export interface IToolRegistry {
  register(tool: Tool, source?: string): void;
  unregister(name: string): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  listBySource(source: string): Tool[];
  execute(name: string, params: any, context: ToolContext): Promise<any>;
  getDefinitions(): ToolDefinition[];
}

/**
 * Channel Manager Interface
 * Manages communication channels
 */
export interface IChannelManager {
  createChannel(name: string, config: any): any;
  getChannel(name: string): any | null;
  listChannels(): string[];
  removeChannel(name: string): void;
}

/**
 * MCP Client Manager Interface
 * Manages MCP protocol connections
 */
export interface IMCPClientManager {
  connect(config: Record<string, any>): Promise<void>;
  disconnect(): Promise<void>;
  getTools(): Array<{ name: string; description: string; parameters: any }>;
  callTool(name: string, params: any): Promise<any>;
  listServers(): string[];
}

/**
 * Cron Service Interface
 * Manages scheduled jobs
 */
export interface ICronService {
  start(): Promise<void>;
  stop(): Promise<void>;
  addJob(job: any): Promise<void>;
  removeJob(id: string): Promise<void>;
  listJobs(): any[];
  getJob(id: string): any | null;
}

/**
 * API Server Interface
 * Manages REST API endpoints
 */
export interface IAPIServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
}
