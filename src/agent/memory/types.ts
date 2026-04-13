export interface MemoryConfig {
  maxContextTokens: number;
  compressionThreshold: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  maxContextTokens: 128000,
  compressionThreshold: 0.75,
};

export function createMemoryConfig(partial?: Partial<MemoryConfig>): MemoryConfig {
  return {
    ...DEFAULT_MEMORY_CONFIG,
    ...partial,
  };
}
