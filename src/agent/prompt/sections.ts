import type { RoleConfig, Skill } from '@aesyclaw/core/types';

const SKILL_HEADER = `## 技能

以下是可用的专业技能模块。在使用任何技能之前，必须通过 \`load_skill\` 工具读取完整说明。

### 可用技能`;

const SKILL_RULES = `### 技能使用规则

1. **触发** — 任务匹配技能描述时使用
2. **读取** — 使用前必须 \`load_skill(skillName="技能名")\` 读取完整内容
3. **渐近** — 仅读取 SKILL.md 直接引用的文件，勿批量加载
4. **引用** — SKILL.md 引用的脚本，先 \`load_skill\` 读取文件内容再尝试执行
5. **降级** — 若技能无法应用，说明原因后继续`;

const ROLE_HEADER = `## 角色

### 可用角色`;

export type RoleSectionOptions = {
  canRunSubAgent: boolean;
  canRunTempSubAgent: boolean;
};

/**
 * 构建角色列表的 Prompt 段落，包含可用角色描述和使用规则。
 *
 * @param allRoles - 所有已启用的角色配置
 * @returns Markdown 格式的角色段落
 */
export function buildRoleSection(
  allRoles: RoleConfig[],
  options: RoleSectionOptions = { canRunSubAgent: true, canRunTempSubAgent: true },
): string {
  const lines = allRoles.map((r) => `- **${r.id}** — ${r.description}`);
  return `${ROLE_HEADER}\n${lines.join('\n')}\n\n${buildRoleRules(options)}`;
}

function buildRoleRules(options: RoleSectionOptions): string {
  const rules = ['1. **匹配** — 根据子任务需求选择对应专长的角色'];

  if (options.canRunSubAgent) {
    rules.push(
      `${rules.length + 1}. **委托** — 使用 \`run_sub_agent(roleId="角色id", prompt="指令")\` 将任务委派给该角色`,
    );
  }

  if (options.canRunTempSubAgent) {
    rules.push(
      `${rules.length + 1}. **临时** — 无需预定义角色时，使用 \`run_temp_sub_agent(systemPrompt="自定义提示", prompt="指令")\` 创建临时子代理`,
    );
  }

  if (options.canRunSubAgent || options.canRunTempSubAgent) {
    rules.push(`${rules.length + 1}. **分工** — 复杂任务拆分至多个子代理并行或串行执行`);
  }

  return `### 角色使用规则\n\n${rules.join('\n')}`;
}

/**
 * 构建技能列表的 Prompt 段落，包含可用技能描述和使用规则。
 *
 * @param skills - 可用技能列表
 * @returns Markdown 格式的技能段落
 */
export function buildSkillSection(skills: Skill[]): string {
  const lines = skills.map((s) => `- **${s.name}**: ${s.description || '无描述'}`);
  return `${SKILL_HEADER}\n${lines.join('\n')}\n\n${SKILL_RULES}`;
}
