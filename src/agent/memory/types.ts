export interface SessionMemoryConfig {
  maxContextTokens: number;
  compressionThreshold: number;
}

const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
  maxContextTokens: 128000,
  compressionThreshold: 0.75,
};

export function createSessionMemoryConfig(partial?: Partial<SessionMemoryConfig>): SessionMemoryConfig {
  return {
    ...DEFAULT_SESSION_MEMORY_CONFIG,
    ...partial,
  };
}
