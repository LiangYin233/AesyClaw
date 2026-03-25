import { NotFoundError, ValidationError } from '../../platform/errors/index.js';
import { SkillRepository } from './SkillRepository.js';

export class SkillApiService {
  constructor(private readonly skillRepository: SkillRepository) {}

  listSkills(): { skills: ReturnType<SkillRepository['list']> } {
    return { skills: this.skillRepository.list() };
  }

  getSkill(name: string): { skill: NonNullable<ReturnType<SkillRepository['getByName']>> } {
    const skill = this.skillRepository.getByName(name);
    if (!skill) {
      throw new NotFoundError('Skill', name);
    }
    return { skill };
  }

  async reload(): Promise<{ success: true; summary: Awaited<ReturnType<SkillRepository['reload']>> }> {
    const summary = await this.skillRepository.reload();
    return { success: true, summary };
  }

  async toggleSkill(name: string, enabled: boolean): Promise<{ success: true }> {
    const skill = this.skillRepository.getByName(name);
    if (!skill) {
      throw new NotFoundError('Skill', name);
    }
    if (!skill.configurable) {
      throw new ValidationError('built-in skill cannot be toggled', 'name');
    }

    const success = await this.skillRepository.toggle(name, enabled);
    if (!success) {
      throw new NotFoundError('Skill', name);
    }

    return { success: true };
  }
}
