import type { ToolDefinition } from '../../types.js';
import type { ToolContext, ToolRegistry } from './ToolRegistry.js';

export class DefinitionAugmentedToolRegistry implements Pick<ToolRegistry, 'getDefinitions' | 'execute'> {
  constructor(
    private readonly baseRegistry: Pick<ToolRegistry, 'getDefinitions' | 'execute'>,
    private readonly extraDefinitions: ToolDefinition[]
  ) {}

  getDefinitions(): ToolDefinition[] {
    const merged = new Map<string, ToolDefinition>();

    for (const definition of this.baseRegistry.getDefinitions()) {
      merged.set(definition.name, definition);
    }

    for (const definition of this.extraDefinitions) {
      if (!merged.has(definition.name)) {
        merged.set(definition.name, definition);
      }
    }

    return Array.from(merged.values());
  }

  async execute(name: string, params: Record<string, any>, context?: ToolContext): Promise<string> {
    return this.baseRegistry.execute(name, params, context);
  }
}
