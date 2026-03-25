import type { SkillManager } from '../../../skills/index.js';
import type { ToolRegistry } from '../ToolRegistry.js';

export function registerSkillTools(args: {
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
}): void {
  const { toolRegistry, skillManager } = args;

  toolRegistry.register({
    name: 'read_skill',
    description: '读取 skill 文件；优先读 SKILL.md。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'skill 名称' },
        file: { type: 'string', description: '文件名；默认 SKILL.md' }
      },
      required: ['name']
    },
    execute: async (params: Record<string, any>) => {
      const skillName = String(params.name);
      const fileName = typeof params.file === 'string' ? params.file : undefined;
      const content = await skillManager.readSkillFile(skillName, fileName);
      return content || `Skill "${skillName}" or file not found`;
    }
  }, 'built-in');

  toolRegistry.register({
    name: 'list_skill_files',
    description: '列出 skill 内文件。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'skill 名称' }
      },
      required: ['name']
    },
    execute: async (params: Record<string, any>) => {
      const skillName = String(params.name);
      const files = await skillManager.listSkillFiles(skillName);
      if (!files) return `Skill "${skillName}" not found`;
      if (typeof files === 'string') return files;
      if (files.length === 0) return `No files found in skill "${skillName}"`;
      return `Files in skill "${skillName}":\n${files.map((file) => `${file.name}${file.isDirectory ? '/' : ''}`).join('\n')}`;
    }
  }, 'built-in');
}
