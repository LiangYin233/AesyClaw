import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export class ConfigFileStore {
  private configPath: string;

  constructor(configPath = join(process.cwd(), 'config.toml')) {
    this.configPath = configPath;
  }

  setPath(configPath: string): void {
    this.configPath = configPath;
  }

  getPath(): string {
    return this.configPath;
  }

  exists(): boolean {
    return existsSync(this.configPath);
  }

  read(): string {
    return readFileSync(this.configPath, 'utf-8');
  }

  write(content: string): void {
    this.ensureDirectory();
    writeFileSync(this.configPath, content, 'utf-8');
  }

  private ensureDirectory(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
