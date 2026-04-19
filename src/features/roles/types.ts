import { z } from 'zod';

export const ToolAccessSchema = z.object({
  mode: z.enum(['allowlist', 'denylist']).default('denylist'),
  tools: z.array(z.string()).default([]),
});

export type ToolAccessConfig = z.infer<typeof ToolAccessSchema>;

export const RoleConfigSchema = z.object({
  name: z.string().min(1, '角色名称不能为空'),
  description: z.string().optional().default(''),
  system_prompt: z.string().min(1, '系统提示词不能为空'),
  model: z.string()
    .includes('/', { message: "模型配置必须遵循 'provider_name/model_name' 格式" })
    .describe("模型标识 (格式: provider_name/model_name)"),
  tool_access: ToolAccessSchema.default({ mode: 'denylist', tools: [] }),
  allowed_skills: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

export type RoleConfig = z.infer<typeof RoleConfigSchema>;

export interface RoleMetadata {
  id: string;
  fileName: string;
  loadedAt: Date;
  updatedAt: Date;
}

export interface RoleWithMetadata extends RoleConfig {
  metadata: RoleMetadata;
}

export const DEFAULT_ROLE_ID = 'default';

export const DEFAULT_ROLE_CONFIG: RoleConfig = {
  name: '默认助手',
  description: '通用助手角色',
  system_prompt: '你是一个有帮助的AI助手。',
  model: 'openai/default',
  tool_access: {
    mode: 'denylist',
    tools: [],
  },
  allowed_skills: [],
  enabled: true,
};
