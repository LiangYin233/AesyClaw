export type SkillSource = 'builtin' | 'external';

export interface SkillFile {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  files?: SkillFile[];
  content?: string;
  enabled: boolean;
  source: SkillSource;
  builtin: boolean;
  configurable: boolean;
}

export interface SkillContext {
  message: string;
  senderId: string;
  chatId: string;
  channel: string;
  media?: string[];
  sessionKey?: string;
  raw?: any;
}

export interface SkillResult {
  content: string;
  media?: string[];
  consumed?: boolean;
}

export interface SkillReloadSummary {
  added: string[];
  updated: string[];
  removed: string[];
  total: number;
  cleanedAgentRefs: number;
}

export interface SkillPromptItem {
  name: string;
  description: string;
}
