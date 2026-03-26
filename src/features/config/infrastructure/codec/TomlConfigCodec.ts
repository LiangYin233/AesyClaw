import { parse, stringify } from 'smol-toml';
import { parseConfig, type Config } from '../../schema/index.js';
import { flattenProviderModelTables, toSerializableConfig } from './providerTableCodec.js';

export class TomlConfigCodec {
  decode(raw: string): Config {
    return parseConfig(parse(raw) as unknown);
  }

  normalizeInput(config: unknown): unknown {
    return flattenProviderModelTables(config);
  }

  parseInput(config: unknown): Config {
    return parseConfig(this.normalizeInput(config));
  }

  encode(config: Config): string {
    return stringify(toSerializableConfig(config));
  }
}
