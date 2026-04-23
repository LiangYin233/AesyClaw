import type { AgentSkill } from './skill-loader.js';

export type SkillSource = 'system' | 'user';

export interface RegisteredSkill {
    skill: AgentSkill;
    source: SkillSource;
}
