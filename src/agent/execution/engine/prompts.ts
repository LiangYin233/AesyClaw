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
  '任务: 将历史对话压缩成简洁摘要，并与已有摘要合并。',
  '核心要求: 这是“对话内容摘要”，不是写给用户的新回复。要概括对话中讨论了什么、用户表达了什么、助手给出了什么关键结论、当前进展到哪里。',
  '保留: 用户偏好、身份背景、长期目标、当前任务、关键结论、已确认事实、未完成事项、下一步。',
  '忽略: 寒暄、重复表述、低价值细节、纯客套语。',
  '约束: 不编造；纯文本；不使用标题；尽量简短但信息完整。',
  '输出: 新的完整对话摘要。'
].join('\n');

export function buildSummaryUserPrompt(existingSummary: string, transcript: string): string {
  return [
    `已有摘要:\n${existingSummary || '(无)'}`,
    `需要压缩并合并的新增对话:\n${transcript || '(无新增对话)'}`,
    '请输出合并后的完整对话摘要。'
  ].join('\n\n');
}

export const FACTS_SYSTEM_PROMPT = [
  '角色: 长期记忆提取器',
  '任务: 仅提取“用户本人”的长期稳定信息。',
  '优先提取: 用户身份背景、个人偏好、长期习惯、长期目标、长期约束。',
  '可提取示例: 语言偏好、回答风格偏好、职业/角色、常用工具、长期项目。',
  '禁止提取: 知识问答主题、一次性请求、临时任务、助手内容、推测信息。',
  '判定规则: 若不确定是否是用户长期信息，则不要提取。',
  '约束: 只能依据用户原话；不编造；每行一条；不要编号或解释。',
  '输出: 从本条用户消息中能确认的长期事实；可重复输出已存在事实用于再次确认；若没有则输出“无”。'
].join('\n');

export function buildFactsUserPrompt(existingFactsBlock: string, userContent: string): string {
  return [
    `已有用户长期记忆:\n${existingFactsBlock || '(无)'}`,
    `用户消息:\n${userContent || '(空)'}`,
    '请只依据用户消息，输出其中能确认的长期稳定事实。'
  ].join('\n\n');
}
