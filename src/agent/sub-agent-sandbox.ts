/**
 * SubAgentSandbox — isolated sub-agent execution environment.
 *
 * Provides two execution modes:
 * - runWithRole: Execute a sub-agent with an existing role configuration
 * - runWithPrompt: Execute a sub-agent with a temporary system prompt
 *
 * Both modes are stubs for now. The real implementation requires Pi-mono
 * Agent integration to create isolated agent instances with restricted
 * tool access and controlled execution limits.
 *
 * @see project.md §5.14
 */

import type { SubAgentRoleParams, SubAgentTempParams } from './agent-types';

// ─── Dependencies ───────────────────────────────────────────────

/**
 * Dependencies for SubAgentSandbox.
 *
 * Will be expanded when Pi-mono Agent integration is available.
 */
export interface SubAgentSandboxDependencies {
  // Will include AgentEngine, ToolRegistry, etc. when implemented
}

// ─── SubAgentSandbox ────────────────────────────────────────────

export class SubAgentSandbox {
  constructor(_deps: SubAgentSandboxDependencies) {
    // Dependencies will be stored when implementation is complete
  }

  /**
   * Execute a sub-agent with an existing role configuration.
   *
   * The sub-agent uses the specified role's system prompt, model, and
   * tool permissions, but runs in an isolated context with its own
   * conversation history.
   *
   * @param _params - Parameters specifying the role and prompt
   * @returns The sub-agent's response text
   * @throws Always throws in the current stub implementation
   */
  async runWithRole(_params: SubAgentRoleParams): Promise<string> {
    throw new Error(
      'Sub-agent execution not yet available — requires Pi-mono Agent integration',
    );
  }

  /**
   * Execute a sub-agent with a temporary system prompt.
   *
   * The sub-agent uses the provided system prompt instead of a role
   * configuration, allowing ad-hoc task delegation.
   *
   * @param _params - Parameters specifying the prompt and options
   * @returns The sub-agent's response text
   * @throws Always throws in the current stub implementation
   */
  async runWithPrompt(_params: SubAgentTempParams): Promise<string> {
    throw new Error(
      'Sub-agent execution not yet available — requires Pi-mono Agent integration',
    );
  }
}