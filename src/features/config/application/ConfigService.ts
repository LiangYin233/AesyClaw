import { logger } from '../../../platform/observability/index.js';
import type { Config } from '../schema/index.js';
import { ConfigFileStore } from '../infrastructure/file/ConfigFileStore.js';
import { FsConfigWatcher } from '../infrastructure/file/FsConfigWatcher.js';
import { TomlConfigCodec } from '../infrastructure/codec/TomlConfigCodec.js';
import { ConfigSnapshotStore } from '../infrastructure/runtime/ConfigSnapshotStore.js';
import { ConfigMutationService, type ConfigMutator } from './ConfigMutationService.js';
import { ConfigReloadCoordinator } from './ConfigReloadCoordinator.js';
import type { ConfigReloadTargets } from '../reload/ports/ReloadTargets.js';
import { sanitizePublicConfig, preserveServerTokenInPublicConfig } from '../contracts/publicConfig.js';
import { getConfigValidationIssue } from '../index.js';
import { DomainValidationError } from '../../../platform/errors/domain.js';

type ReloadListener = (previousConfig: Config | null, nextConfig: Config) => void | Promise<void>;

export class ConfigService {
  private static readonly WATCH_DEBOUNCE_MS = 150;
  private static readonly WATCH_RETRY_MS = 200;
  private static readonly MAX_WATCH_RESTART_ATTEMPTS = 20;

  private readonly log = logger.child('ConfigService');
  private readonly fileStore: ConfigFileStore;
  private readonly mutationService: ConfigMutationService;
  private readonly reloadCoordinator: ConfigReloadCoordinator;
  private readonly reloadListeners = new Set<ReloadListener>();
  private readonly watcher: FsConfigWatcher;
  private snapshotStore: ConfigSnapshotStore | null = null;
  private lastAppliedSignature: string | null = null;

  constructor(args?: {
    fileStore?: ConfigFileStore;
    codec?: TomlConfigCodec;
    mutationService?: ConfigMutationService;
    reloadCoordinator?: ConfigReloadCoordinator;
  }) {
    const fileStore = args?.fileStore ?? new ConfigFileStore();
    const codec = args?.codec ?? new TomlConfigCodec();
    this.fileStore = fileStore;
    this.mutationService = args?.mutationService ?? new ConfigMutationService(codec);
    this.reloadCoordinator = args?.reloadCoordinator ?? new ConfigReloadCoordinator(this.log);
    this.watcher = new FsConfigWatcher({
      getConfigPath: () => this.fileStore.getPath(),
      log: this.log,
      onReloadRequested: () => {
        void this.reloadFromDisk();
      },
      watchDebounceMs: ConfigService.WATCH_DEBOUNCE_MS,
      watchRetryMs: ConfigService.WATCH_RETRY_MS,
      maxWatchRestartAttempts: ConfigService.MAX_WATCH_RESTART_ATTEMPTS
    });
  }

  setPath(configPath: string): void {
    if (this.fileStore.getPath() !== configPath) {
      this.stopWatching();
      this.snapshotStore = null;
      this.lastAppliedSignature = null;
      this.fileStore.setPath(configPath);
    }
  }

  getPath(): string {
    return this.fileStore.getPath();
  }

  setReloadTargets(targets: ConfigReloadTargets): void {
    this.reloadCoordinator.setTargets(targets);
  }

  getSnapshotStore(): ConfigSnapshotStore {
    if (!this.snapshotStore) {
      throw new Error('Config not loaded');
    }

    return this.snapshotStore;
  }

  setConfig(config: Config): void {
    if (this.snapshotStore) {
      this.snapshotStore.setConfig(config);
    } else {
      this.snapshotStore = new ConfigSnapshotStore(config);
    }

    this.lastAppliedSignature = this.mutationService.serialize(config);
  }

  async load(configPath?: string): Promise<Config> {
    if (configPath) {
      this.setPath(configPath);
    }

    if (this.snapshotStore) {
      return this.snapshotStore.getConfig();
    }

    if (!this.fileStore.exists()) {
      const nextConfig = this.mutationService.createDefaultConfig();
      this.fileStore.write(this.mutationService.serialize(nextConfig));
      this.setConfig(nextConfig);
      this.startWatching();
      return nextConfig;
    }

    const raw = this.fileStore.read();
    const nextConfig = this.mutationService.parsePersisted(raw);
    this.setConfig(nextConfig);
    if (raw !== this.mutationService.serialize(nextConfig)) {
      this.fileStore.write(this.mutationService.serialize(nextConfig));
    }
    this.startWatching();
    return nextConfig;
  }

  get(): Config {
    return this.getSnapshotStore().getConfig();
  }

  async save(config: unknown): Promise<Config> {
    const nextConfig = this.mutationService.parseInput(config);
    await this.persistAndApply(nextConfig);
    return nextConfig;
  }

  async update(mutator: ConfigMutator): Promise<Config> {
    const nextConfig = await this.mutationService.applyUpdate(this.get(), mutator);
    await this.persistAndApply(nextConfig);
    return nextConfig;
  }

  getPublicConfig(): ReturnType<typeof sanitizePublicConfig> {
    return sanitizePublicConfig(this.get());
  }

  async updatePublicConfig(nextConfig: Record<string, unknown>): Promise<{ success: true }> {
    try {
      const currentConfig = this.get();
      await this.update(
        () => preserveServerTokenInPublicConfig(nextConfig, currentConfig) as Config
      );
      return { success: true };
    } catch (error) {
      const issue = getConfigValidationIssue(error);
      if (issue) {
        throw new DomainValidationError(issue.message, issue.field);
      }
      throw error;
    }
  }

  onReload(listener: ReloadListener): () => void {
    this.reloadListeners.add(listener);
    return () => this.reloadListeners.delete(listener);
  }

  startWatching(): void {
    this.watcher.start();
  }

  stopWatching(): void {
    this.watcher.stop();
  }

  private async persistAndApply(nextConfig: Config): Promise<void> {
    const previousConfig = this.snapshotStore ? structuredClone(this.snapshotStore.getConfig()) : null;
    const previousSignature = this.lastAppliedSignature;
    const serialized = this.mutationService.serialize(nextConfig);
    this.lastAppliedSignature = serialized;
    this.fileStore.write(serialized);

    try {
      await this.applyNextConfig(previousConfig, nextConfig);
    } catch (error) {
      this.lastAppliedSignature = previousSignature;
      if (previousConfig) {
        this.fileStore.write(this.mutationService.serialize(previousConfig));
      }
      throw error;
    }
  }

  private async reloadFromDisk(): Promise<void> {
    try {
      const raw = this.fileStore.read();
      const parsedConfig = this.mutationService.parsePersisted(raw);
      const signature = this.mutationService.serialize(parsedConfig);

      if (signature === this.lastAppliedSignature) {
        return;
      }
      const previousConfig = this.snapshotStore ? structuredClone(this.snapshotStore.getConfig()) : null;
      const previousSignature = this.lastAppliedSignature;
      this.lastAppliedSignature = signature;

      try {
        await this.applyNextConfig(previousConfig, parsedConfig);
      } catch (error) {
        this.lastAppliedSignature = previousSignature;
        throw error;
      }

      const currentRaw = this.fileStore.read();
      if (currentRaw === raw && currentRaw !== signature) {
        this.fileStore.write(signature);
      }
    } catch {
    }
  }

  private async applyNextConfig(previousConfig: Config | null, nextConfig: Config): Promise<void> {
    if (previousConfig) {
      await this.reloadCoordinator.reload(previousConfig, nextConfig);
    }

    for (const listener of this.reloadListeners) {
      await listener(previousConfig, nextConfig);
    }
    this.setConfig(nextConfig);
  }
}
