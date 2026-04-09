import type { SkillRoute, SkillMetadata } from '../features/skills/types.js';

export interface ISkillManager {
  getSkill(route: string): SkillMetadata | undefined;
  getAllSkills(): SkillRoute[];
  getSkillsForRole(roleId: string): SkillRoute[];
  isInitialized(): boolean;
  initialize(): Promise<void>;
}
