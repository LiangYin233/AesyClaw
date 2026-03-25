import type { SkillManager } from './application/SkillManager.js';

export class SkillRepository {
  constructor(private readonly skillManager: SkillManager) {}

  list() {
    return this.skillManager.listSkills();
  }

  getByName(name: string) {
    return this.skillManager.getSkill(name);
  }

  async reload() {
    return this.skillManager.reload();
  }

  async toggle(name: string, enabled: boolean): Promise<boolean> {
    return this.skillManager.toggleSkill(name, enabled);
  }
}
