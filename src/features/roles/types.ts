import { z } from 'zod';

export const RoleConfigSchema = z.object({
  name: z.string().min(1, '角色名称不能为空'),
  description: z.string().optional().default(''),
  system_prompt: z.string().min(1, '系统提示词不能为空'),
  allowed_tools: z.array(z.string()).default(['*']),
  allowed_skills: z.array(z.string()).default([]),
  override_model: z.string().optional(),
  avatar: z.string().optional(),
  tags: z.array(z.string()).default([]),
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
  allowed_tools: ['*'],
  allowed_skills: [],
  tags: [],
  enabled: true,
};
