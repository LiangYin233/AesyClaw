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
  '任务: 提取适合长期保留的新事实。',
  '保留: 用户偏好、身份背景、长期目标、项目背景、明确约束。',
  '忽略: 临时寒暄、一次性细节、推测。',
  '约束: 不编造；每行一条；不要编号或解释。',
  '输出: 新事实；若没有则输出“无”。'
].join('\n');

export function buildFactsUserPrompt(existingFactsBlock: string, userContent: string, assistantContent: string): string {
  return [
    `已有长期记忆:\n${existingFactsBlock || '(无)'}`,
    `用户消息:\n${userContent || '(空)'}`,
    `助手回复:\n${assistantContent || '(空)'}`,
    '请只输出新增长期事实。'
  ].join('\n\n');
}
