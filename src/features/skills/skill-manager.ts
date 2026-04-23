import { loadSkills, type AgentSkill } from './skill-loader.js';
import { logger } from '@/platform/observability/logger.js';
import { pathResolver } from '@/platform/utils/paths.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import type { RegisteredSkill, SkillSource } from './types.js';

function isMissingSkillsDirectory(error: unknown): boolean {
    return toErrorMessage(error).includes('Skills root directory not found');
}

export class SkillManager {
    private skills: Map<string, RegisteredSkill> = new Map();
    private initialized = false;

    private getAllSkills(): AgentSkill[] {
        return Array.from(this.skills.values(), (entry) => entry.skill);
    }

    private getSystemSkills(): AgentSkill[] {
        return Array.from(this.skills.values())
            .filter((entry) => entry.source === 'system')
            .map((entry) => entry.skill);
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.warn({}, 'SkillManager already initialized');
            return;
        }

        await this.reload();
        this.initialized = true;
        logger.info(this.getStats(), 'SkillManager initialized');
    }

    async shutdown(): Promise<void> {
        this.skills.clear();
        this.initialized = false;
    }

    async reload(): Promise<void> {
        const systemDir = pathResolver.getSystemSkillsDir();
        const userDir = pathResolver.getUserSkillsDir();

        logger.info({ systemDir, userDir }, 'Loading skills');

        const [systemSkills, userSkills] = await Promise.all([
            this.loadDirectory(systemDir, 'system'),
            this.loadDirectory(userDir, 'user'),
        ]);

        this.skills.clear();

        for (const entry of systemSkills) {
            this.skills.set(entry.skill.name, entry);
        }

        for (const entry of userSkills) {
            this.skills.set(entry.skill.name, entry);
        }
    }

    private async loadDirectory(
        directoryPath: string,
        source: SkillSource,
    ): Promise<RegisteredSkill[]> {
        try {
            const skills = await loadSkills(directoryPath);
            return skills.map((skill) => ({ skill, source }));
        } catch (error) {
            if (isMissingSkillsDirectory(error)) {
                logger.debug({ directoryPath, source }, 'Skills directory not found, skipping');
                return [];
            }

            throw error;
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    getStats(): { total: number; system: number; user: number } {
        let system = 0;
        let user = 0;

        for (const entry of this.skills.values()) {
            if (entry.source === 'system') {
                system += 1;
            } else {
                user += 1;
            }
        }

        return {
            total: this.skills.size,
            system,
            user,
        };
    }

    getSkillNames(): string[] {
        return Array.from(this.skills.keys()).sort((left, right) => left.localeCompare(right));
    }

    getSkillsForRole(allowedSkillIds: string[]): AgentSkill[] {
        if (allowedSkillIds.includes('*')) {
            return this.getAllSkills();
        }

        const allowedUserSkills = allowedSkillIds
            .map((skillName) => this.skills.get(skillName))
            .filter((entry): entry is RegisteredSkill => Boolean(entry && entry.source === 'user'))
            .map((entry) => entry.skill);

        return [...this.getSystemSkills(), ...allowedUserSkills];
    }
}

export const skillManager = new SkillManager();
