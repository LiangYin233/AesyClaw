import { NotFoundError, ValidationError } from '../../../platform/errors/index.js';
import type { SkillManager } from './SkillManager.js';

export class SkillsService {
  constructor(private readonly skillManager: SkillManager) {}

  listSkills(): { skills: ReturnType<SkillManager['listSkills']> } {
    return { skills: this.skillManager.listSkills() };
  }

  getSkill(name: string): { skill: NonNullable<ReturnType<SkillManager['getSkill']>> } {
    const skill = this.skillManager.getSkill(name);
    if (!skill) {
      throw new NotFoundError('Skill', name);
    }
    return { skill };
  }

  async reload(): Promise<{ success: true; summary: Awaited<ReturnType<SkillManager['reload']>> }> {
    const summary = await this.skillManager.reload();
    return { success: true, summary };
  }

  async toggleSkill(name: string, enabled: boolean): Promise<{ success: true }> {
    const skill = this.skillManager.getSkill(name);
    if (!skill) {
      throw new NotFoundError('Skill', name);
    }
    if (!skill.configurable) {
      throw new ValidationError('built-in skill cannot be toggled', 'name');
    }

    const success = await this.skillManager.toggleSkill(name, enabled);
    if (!success) {
      throw new NotFoundError('Skill', name);
    }

    return { success: true };
  }
}
