/** 技能 Service — 只读。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';

/**
 * 获取所有已注册技能。
 */
export function getSkills(
  deps: WebUiManagerDependencies,
): Array<{ name: string; description: string; isSystem: boolean }> {
  const skills = deps.skillManager.getAllSkills();
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    isSystem: skill.isSystem,
  }));
}
