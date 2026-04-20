import type { AgentEngine } from '../engine.js';
import type { SessionMemoryManager } from '../memory/session-memory-manager.js';

export interface ChatSession {
    channel: string;
    type: string;
    chatId: string;
    roleId: string;
}

export interface ChatContext {
    session: ChatSession;
    agent: AgentEngine;
    memory: SessionMemoryManager;
}
