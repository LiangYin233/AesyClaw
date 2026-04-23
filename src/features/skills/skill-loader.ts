/** @file 技能加载器
 *
 * 从 YAML frontmatter + markdown 文件加载技能定义。
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/** 技能定义 */
export interface AgentSkill {
    /** 技能名称 */
    name: string;
    /** 技能描述 */
    description: string;
    /** 技能元数据 */
    metadata: Record<string, unknown>;
    /** 技能内容（markdown） */
    content: string;
}

/** 解析 frontmatter + markdown 格式的技能文件内容 */
function parseSkillFile(fileContent: string, fileName: string): AgentSkill {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = frontmatterRegex.exec(fileContent);

    if (!match) {
        // 没有 frontmatter，整个文件作为内容
        return {
            name: fileName.replace(/\.md$/i, ''),
            description: '',
            metadata: {},
            content: fileContent.trim(),
        };
    }

    const frontmatterText = match[1];
    const content = match[2].trim();

    // 简单解析 YAML frontmatter（只处理 key: value 格式）
    const metadata: Record<string, unknown> = {};
    const lines = frontmatterText.split('\n');
    let currentKey: string | null = null;
    let currentValue: string[] = [];

    for (const line of lines) {
        const keyValueMatch = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(line);
        if (keyValueMatch) {
            if (currentKey) {
                metadata[currentKey] = currentValue.join('\n').trim();
            }
            currentKey = keyValueMatch[1];
            currentValue = [keyValueMatch[2]];
        } else if (currentKey && line.startsWith(' ')) {
            currentValue.push(line.trim());
        }
    }

    if (currentKey) {
        metadata[currentKey] = currentValue.join('\n').trim();
    }

    const name = String(metadata.name || fileName.replace(/\.md$/i, ''));
    const description = String(metadata.description || '');

    // 移除已提取的字段，保留其他元数据
    const remainingMetadata = { ...metadata };
    delete remainingMetadata.name;
    delete remainingMetadata.description;

    return {
        name,
        description,
        metadata: remainingMetadata,
        content,
    };
}

/** 加载指定目录下的所有技能文件 */
export async function loadSkills(directoryPath: string): Promise<AgentSkill[]> {
    let entries;
    try {
        entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('ENOENT')) {
            throw new Error(`Skills root directory not found: ${directoryPath}`, { cause: error });
        }
        throw error;
    }

    const skillFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name);

    const skills: AgentSkill[] = [];

    for (const fileName of skillFiles) {
        const filePath = path.join(directoryPath, fileName);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const skill = parseSkillFile(fileContent, fileName);
        skills.push(skill);
    }

    return skills;
}
