import type { ToolDefinition, ToolExecuteContext } from '@/platform/tools/types.js';

export interface IToolRegistry {
  getToolDefinitions(): ToolDefinition[];
  executeTool(name: string, params: Record<string, unknown>, context: ToolExecuteContext): Promise<unknown>;
  hasTool(name: string): boolean;
  getTool(name: string): ToolDefinition | undefined;
}
