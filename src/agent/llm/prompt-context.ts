import { StandardMessage } from './types.js';
import { ToolDefinition } from '../../platform/tools/types.js';

export interface SystemVariables {
  date: string;
  os: string;
  systemLang: string;
}

export interface SkillInfo {
  name: string;
  description: string;
}

export interface PromptMetadata {
  chatId: string;
  senderId: string;
  traceId?: string;
  maxTokens?: number;
  roleId?: string;
}

export interface SystemContext {
  roleId: string;
  roleName: string;
  systemPrompt: string;
  variables: SystemVariables;
}

export interface PromptContext {
  system: SystemContext;
  messages: StandardMessage[];
  tools: ToolDefinition[];
  skills?: SkillInfo[];
  metadata?: PromptMetadata;
}

export interface PromptContextOptions {
  chatId: string;
  senderId: string;
  traceId?: string;
  roleId: string;
  messages: StandardMessage[];
  tools: ToolDefinition[];
  skills?: SkillInfo[];
  maxTokens?: number;
}
