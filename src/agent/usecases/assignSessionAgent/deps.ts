export interface AssignSessionAgentDeps {
  getDefaultRoleName: () => string;
  getSession: (sessionKey: string) => Promise<{ key: string; channel: string; chatId: string }>;
  getResolvedRole: (agentName: string) => { name: string } | null;
  clearConversationAgent: (channel: string, chatId: string) => void;
  setConversationAgent: (channel: string, chatId: string, agentName: string) => void;
}
