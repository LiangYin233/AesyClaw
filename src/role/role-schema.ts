/**
 * 角色配置 TypeBox 模式。
 *
 * 角色配置文件是存储在 `roles/` 目录中的 JSON 文件。
 * 使用 TypeBox 进行验证，以便同时获得运行时检查和
 * 通过 `Static<>` 进行的 TypeScript 类型推断。
 *
 */

import { Type } from '@sinclair/typebox';

/**
 * 单个角色配置文件的 TypeBox 模式。
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
  skills: Type.Union([Type.Array(Type.String()), Type.Tuple([Type.Literal('*')])]),
  enabled: Type.Boolean({ default: true }),
});
