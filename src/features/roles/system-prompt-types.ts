export interface SystemPromptBuildOptions {
  roleId: string;
  /** 预留参数：用于未来实现用户特定提示词（如用户偏好） */
  chatId?: string;
  /** 预留参数：用于未来实现发送者特定提示词（如用户身份） */
  senderId?: string;
}

export interface SystemVariables {
  date: string;
  os: string;
  systemLang: string;
}
