import type { AgentSkill } from 'aesyiu';

export type SkillSource = 'system' | 'user';

export interface RegisteredSkill {
  skill: AgentSkill;
  source: SkillSource;
}
