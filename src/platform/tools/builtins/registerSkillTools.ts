import type { ToolRegistry } from '../ToolRegistry.js';

interface SkillFile {
  name: string;
  isDirectory: boolean;
}

export interface SkillToolService {
  readSkillFile(name: string, file?: string): Promise<string | null>;
  listSkillFiles(name: string): Promise<SkillFile[] | string[] | null>;
}

export function registerSkillTools(args: {
  toolRegistry: ToolRegistry;
  skillManager: SkillToolService;
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
      const fileList = files as SkillFile[];
      return `Files in skill "${skillName}":\n${fileList.map((file) => `${file.name}${file.isDirectory ? '/' : ''}`).join('\n')}`;
    }
  }, 'built-in');
}
