import type { RoleConfig, Skill } from '@aesyclaw/core/types';

const SKILL_SECTION_HEADER = `## 技能

以下是可用的专业技能模块。在使用任何技能之前，必须通过 \`load_skill\` 工具读取完整说明。

### 可用技能`;

const ROLE_SECTION_HEADER = `## 角色

### 可用角色`;

const ROLE_SECTION_RULES = `### 角色使用规则

1. **匹配** — 根据子任务需求选择对应专长的角色
2. **委托** — 使用 \`run_sub_agent(roleId="角色id", prompt="指令")\` 将任务委派给该角色
3. **临时** — 无需预定义角色时，使用 \`run_temp_sub_agent(systemPrompt="自定义提示", prompt="指令")\` 创建临时子代理
4. **分工** — 复杂任务拆分至多个子代理并行或串行执行`;

export function buildRoleSection(allRoles: RoleConfig[]): string {
  const lines = allRoles.map((r) => `- **${r.id}** — ${r.description}`);
  return `${ROLE_SECTION_HEADER}\n${lines.join('\n')}\n\n${ROLE_SECTION_RULES}`;
}

export function buildSkillSection(
  skills: Skill[],
  skillDirs?: { userDir?: string; systemDir?: string },
): string {
  const lines = skills.map((skill) => {
    const desc = skill.description || '无描述';
    return `- **${skill.name}**: ${desc}`;
  });

  let rules = `### 技能使用规则

1. **触发** — 任务匹配技能描述时使用
2. **读取** — 使用前必须 \`load_skill(skillName="技能名")\` 读取完整内容
3. **渐近** — 仅读取 SKILL.md 直接引用的文件，勿批量加载
4. **引用** — SKILL.md 引用的脚本，先 \`load_skill\` 读取文件内容再尝试执行
5. **降级** — 若技能无法应用，说明原因后继续`;

  if (skillDirs?.systemDir || skillDirs?.userDir) {
    const pathLines: string[] = [];
    if (skillDirs.systemDir) pathLines.push(`- 系统技能: \`${skillDirs.systemDir}\``);
    if (skillDirs.userDir) pathLines.push(`- 用户技能: \`${skillDirs.userDir}\``);
    rules += `\n\n6. **路径**\n${pathLines.join('\n')}`;
  }

  return `${SKILL_SECTION_HEADER}\n${lines.join('\n')}\n\n${rules}`;
}
