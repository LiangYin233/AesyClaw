export interface SystemPromptBuildOptions {
  roleId: string;
  chatId?: string;
  senderId?: string;
}

export interface SystemVariables {
  date: string;
  os: string;
  systemLang: string;
}

export interface CapabilityDescription {
  name: string;
  description: string;
}

export interface BuildResult {
  raw: string;
  withVariables: string;
  full: string;
}
