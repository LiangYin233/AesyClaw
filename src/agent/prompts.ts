export interface SystemPromptOptions {
  basePrompt: string;
  workspace: string;
  context?: string;
  skillsPrompt?: string;
}

export function buildAgentSystemPrompt(options: SystemPromptOptions): string {
  const sections = [
    options.basePrompt.trim(),
    `Workspace: ${options.workspace}`,
    options.context ? `Context: ${options.context}` : '',
    options.skillsPrompt?.trim() || ''
  ].filter(Boolean);

  return sections.join('\n');
}

export const MEMORY_FACTS_PREFIX = '长期记忆（相关时参考）：';
export const MEMORY_SUMMARY_PREFIX = '会话摘要（旧上下文）：';

export const SUMMARY_SYSTEM_PROMPT = [
  '角色: 对话摘要器',
  '任务: 压缩新增对话并合并到已有摘要。',
  '保留: 用户偏好、身份背景、长期目标、当前任务、已确认事实、未完成事项。',
  '忽略: 寒暄、重复表述、低价值细节。',
  '约束: 不编造；纯文本；简洁。',
  '输出: 新的完整摘要。'
].join('\n');

export function buildSummaryUserPrompt(existingSummary: string, transcript: string): string {
  return [
    `已有摘要:\n${existingSummary || '(无)'}`,
    `新增对话:\n${transcript}`,
    '请输出合并后的完整摘要。'
  ].join('\n\n');
}

export const FACTS_SYSTEM_PROMPT = [
  '角色: 长期记忆提取器',
  '任务: 仅提取“用户本人”的长期稳定信息。',
  '优先提取: 用户身份背景、个人偏好、长期习惯、长期目标、长期约束。',
  '可提取示例: 语言偏好、回答风格偏好、职业/角色、常用工具、长期项目。',
  '禁止提取: 知识问答主题、一次性请求、临时任务、助手内容、推测信息。',
  '判定规则: 若不确定是否是用户长期信息，则不要提取。',
  '约束: 不编造；每行一条；不要编号或解释；仅输出“新事实”。',
  '输出: 新事实；若没有则输出“无”。'
].join('\n');

export function buildFactsUserPrompt(existingFactsBlock: string, userContent: string, assistantContent: string): string {
  return [
    `已有用户长期记忆:\n${existingFactsBlock || '(无)'}`,
    `用户消息:\n${userContent || '(空)'}`,
    `助手回复:\n${assistantContent || '(空)'}`,
    '请只输出与“用户个人信息/偏好”相关的新增长期事实。'
  ].join('\n\n');
}
