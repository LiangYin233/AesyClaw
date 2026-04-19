import { ZodError } from 'zod';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import {
  type RegistrationHandle,
  type RegistrationOwner,
  getRegistrationOwnerKey,
} from '@/platform/registration/types.js';
import type { Tool, ToolDefinition } from './types.js';

export interface ToolValidationError {
  toolName: string;
  error: string;
  issues?: Array<{
    path: string[];
    message: string;
  }>;
}

export interface ToolCatalog {
  getTool(toolName: string): Tool | undefined;
  hasTool(toolName: string): boolean;
  getAllToolDefinitions(): ToolDefinition[];
  getAllToolNames(): string[];
  getStats(): {
    totalTools: number;
  };
}

export interface ToolRegistrationPort {
  readonly owner: RegistrationOwner;
  register(tool: Tool): RegistrationHandle;
  unregister(toolName: string): boolean;
  listOwnedNames(): string[];
  dispose(): void;
}

interface RegisteredToolRecord {
  tool: Tool;
  owner: RegistrationOwner;
}

export class ToolManager implements ToolCatalog {
  private tools: Map<string, RegisteredToolRecord> = new Map();
  private ownerToolNames: Map<string, Set<string>> = new Map();

  constructor() {
    logger.info({}, 'ToolManager initialized');
  }

  createScope(owner: RegistrationOwner): ToolRegistrationPort {
    return {
      owner,
      register: (tool) => this.register(owner, tool),
      unregister: (toolName) => this.unregister(toolName, owner),
      listOwnedNames: () => this.listOwnedNames(owner),
      dispose: () => {
        this.unregisterAll(owner);
      },
    };
  }

  getTool(toolName: string): Tool | undefined {
    return this.tools.get(toolName)?.tool;
  }

  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  getAllToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values(), ({ tool }) => tool.getDefinition());
  }

  getAllToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  validateToolArguments(
    toolName: string,
    args: Record<string, unknown>
  ): { valid: boolean; errors?: ToolValidationError; parsedArgs?: Record<string, unknown> } {
    const tool = this.getTool(toolName);

    if (!tool) {
      return {
        valid: false,
        errors: {
          toolName,
          error: `工具 "${toolName}" 未注册`,
        },
      };
    }

    try {
      const parsedArgs = tool.parametersSchema.parse(args);
      return { valid: true, parsedArgs: parsedArgs as Record<string, unknown> };
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          valid: false,
          errors: {
            toolName,
            error: `参数验证失败: ${error.message}`,
            issues: error.issues.map(issue => ({
              path: issue.path.map(String),
              message: issue.message,
            })),
          },
        };
      }

      return {
        valid: false,
        errors: {
          toolName,
          error: toErrorMessage(error),
        },
      };
    }
  }

  getStats(): { totalTools: number } {
    return {
      totalTools: this.tools.size,
    };
  }

  private register(owner: RegistrationOwner, tool: Tool): RegistrationHandle {
    const existing = this.tools.get(tool.name);
    if (existing) {
      throw new Error(
        `Tool "${tool.name}" is already registered by ${existing.owner.kind}:${existing.owner.id}`
      );
    }

    this.tools.set(tool.name, { tool, owner });
    this.trackOwnerName(owner, tool.name);

    logger.info(
      {
        toolName: tool.name,
        ownerKind: owner.kind,
        ownerId: owner.id,
        totalTools: this.tools.size,
      },
      'Tool registered'
    );

    return {
      name: tool.name,
      owner,
      dispose: () => this.unregister(tool.name, owner),
    };
  }

  private unregister(toolName: string, owner?: RegistrationOwner): boolean {
    const record = this.tools.get(toolName);
    if (!record) {
      return false;
    }

    if (owner && getRegistrationOwnerKey(record.owner) !== getRegistrationOwnerKey(owner)) {
      return false;
    }

    const deleted = this.tools.delete(toolName);
    if (!deleted) {
      return false;
    }

    this.untrackOwnerName(record.owner, toolName);

    logger.info(
      {
        toolName,
        ownerKind: record.owner.kind,
        ownerId: record.owner.id,
        remainingTools: this.tools.size,
      },
      'Tool unregistered'
    );

    return true;
  }

  private unregisterAll(owner: RegistrationOwner): void {
    for (const toolName of this.listOwnedNames(owner)) {
      this.unregister(toolName, owner);
    }
  }

  private listOwnedNames(owner: RegistrationOwner): string[] {
    return Array.from(this.ownerToolNames.get(getRegistrationOwnerKey(owner)) ?? []);
  }

  private trackOwnerName(owner: RegistrationOwner, toolName: string): void {
    const ownerKey = getRegistrationOwnerKey(owner);
    const names = this.ownerToolNames.get(ownerKey) ?? new Set<string>();
    names.add(toolName);
    this.ownerToolNames.set(ownerKey, names);
  }

  private untrackOwnerName(owner: RegistrationOwner, toolName: string): void {
    const ownerKey = getRegistrationOwnerKey(owner);
    const names = this.ownerToolNames.get(ownerKey);
    if (!names) {
      return;
    }

    names.delete(toolName);
    if (names.size === 0) {
      this.ownerToolNames.delete(ownerKey);
    }
  }
}
