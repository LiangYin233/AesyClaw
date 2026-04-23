import { Type, type Static } from '@sinclair/typebox';

export const ToolAccessSchema = Type.Object({
    mode: Type.Union([Type.Literal('allowlist'), Type.Literal('denylist')], {
        default: 'denylist',
    }),
    tools: Type.Array(Type.String(), { default: [] }),
});

export type ToolAccessConfig = Static<typeof ToolAccessSchema>;

export const RoleConfigSchema = Type.Object({
    name: Type.String({ minLength: 1, description: '角色名称不能为空' }),
    description: Type.String({ default: '' }),
    system_prompt: Type.String({ minLength: 1, description: '系统提示词不能为空' }),
    model: Type.String({
        pattern: '^[^/]+/[^/]+$',
        description: "模型配置必须遵循 'provider_name/model_name' 格式",
    }),
    tool_access: ToolAccessSchema,
    allowed_skills: Type.Array(Type.String(), { default: [] }),
    enabled: Type.Boolean({ default: true }),
});

export type RoleConfig = Static<typeof RoleConfigSchema>;

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
