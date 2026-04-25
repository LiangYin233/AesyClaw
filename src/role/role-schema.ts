/**
 * Role config TypeBox schema.
 *
 * Role configuration files are JSON files stored in the `roles/` directory.
 * Validation uses TypeBox so we get both runtime checking and
 * TypeScript type inference via `Static<>`.
 *
 */

import { Type, Static } from '@sinclair/typebox';

/**
 * TypeBox schema for a single role configuration file.
 */
export const RoleConfigSchema = Type.Object({
  id: Type.String({ description: 'Unique role identifier' }),
  name: Type.String({ description: 'Human-readable role name' }),
  description: Type.String({ description: 'Brief description of the role' }),
  systemPrompt: Type.String({ description: 'System prompt template for the role' }),
  model: Type.String({ description: 'provider/model format' }),
  toolPermission: Type.Object({
    mode: Type.Union([Type.Literal('allowlist'), Type.Literal('denylist')]),
    list: Type.Array(Type.String()),
  }),
  skills: Type.Union([
    Type.Array(Type.String()),
    Type.Tuple([Type.Literal('*')]),
  ]),
  enabled: Type.Boolean({ default: true }),
});

/** Derived TypeScript type from the RoleConfigSchema */
export type RoleConfigSchemaType = Static<typeof RoleConfigSchema>;
