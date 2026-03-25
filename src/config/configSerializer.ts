import type { Config } from './schema.js';
import { TomlConfigCodec } from './infrastructure/codec/TomlConfigCodec.js';

const codec = new TomlConfigCodec();

export function serializeConfig(config: Config): string {
  return codec.encode(config);
}
