import type { SystemPromptBuildOptions } from '@/features/roles/system-prompt-types.js';

export type { SystemPromptBuildOptions as PromptBuildContext };

export interface ISystemPromptBuilder {
  buildSystemPrompt(options: SystemPromptBuildOptions): string;
}
