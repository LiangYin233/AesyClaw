/** @file 工作区路径工具
 *
 * 提供插件可使用的工作区目录路径获取与自动创建功能。
 * 工作区位于项目根目录下 `.aesyclaw/workspace/`，用于存放插件运行时文件。
 */

import * as fs from 'fs';
import * as path from 'path';

const AESYCLAW_DIR = '.aesyclaw';
const WORKSPACE_DIR = 'workspace';

/** 返回工作区目录路径（不保证目录已存在） */
export function getWorkspaceDir(): string {
    return path.join(process.cwd(), AESYCLAW_DIR, WORKSPACE_DIR);
}

/** 确保工作区目录存在并返回其路径
 *
 * 若目录不存在则递归创建。插件初始化时可调用此函数
 * 获取可靠的文件存放路径。
 */
export function ensureWorkspaceDir(): string {
    const workspaceDir = getWorkspaceDir();
    if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
    }

    return workspaceDir;
}
