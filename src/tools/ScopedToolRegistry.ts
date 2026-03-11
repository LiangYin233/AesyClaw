import type { ToolContext, ToolRegistry } from './ToolRegistry.js';
import type { ToolDefinition } from '../types.js';

export class ScopedToolRegistry {
  private allowedSet: Set<string>;

  constructor(
    private baseRegistry: Pick<ToolRegistry, 'getDefinitions' | 'execute'>,
    allowedTools: string[]
  ) {
    this.allowedSet = new Set(allowedTools);
  }

  getDefinitions(): ToolDefinition[] {
    return this.baseRegistry.getDefinitions().filter((tool) => this.allowedSet.has(tool.name));
  }

  async execute(name: string, params: Record<string, any>, context?: ToolContext): Promise<string> {
    if (!this.allowedSet.has(name)) {
      throw new Error(`Tool not allowed for current agent role: ${name}`);
    }

    return this.baseRegistry.execute(name, params, context);
  }
}
