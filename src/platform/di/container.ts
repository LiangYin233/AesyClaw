type Factory<T> = (container: DIContainer) => T;
type LazyFactory<T> = () => T;

export class DIContainer {
  private readonly factories = new Map<string, Factory<unknown>>();
  private readonly instances = new Map<string, unknown>();
  private readonly lazyFactories = new Map<string, LazyFactory<unknown>>();

  register<T>(key: string, factory: Factory<T>): void {
    this.factories.set(key, factory as Factory<unknown>);
  }

  registerLazy<T>(key: string, factory: () => T): void {
    this.lazyFactories.set(key, factory as LazyFactory<unknown>);
  }

  resolve<T>(key: string): T {
    if (this.instances.has(key)) {
      return this.instances.get(key) as T;
    }

    const factory = this.factories.get(key);
    if (!factory) {
      throw new Error(`Service not registered: ${key}`);
    }

    const instance = factory(this);
    this.instances.set(key, instance);
    return instance as T;
  }

  resolveLazy<T>(key: string): T {
    const factory = this.lazyFactories.get(key);
    if (!factory) {
      throw new Error(`Lazy factory not registered: ${key}`);
    }
    return factory() as T;
  }

  has(key: string): boolean {
    return this.factories.has(key) || this.instances.has(key) || this.lazyFactories.has(key);
  }

  clear(): void {
    this.instances.clear();
  }
}

export const SERVICE_KEYS = {
  PathResolver: 'PathResolver',
  EventBus: 'EventBus',
  ConfigManager: 'ConfigManager',
  SQLiteManager: 'SQLiteManager',
  ToolRegistry: 'ToolRegistry',
  CronJobScheduler: 'CronJobScheduler',
  RoleManager: 'RoleManager',
  SkillManager: 'SkillManager',
  PluginManager: 'PluginManager',
  SystemPromptBuilder: 'SystemPromptBuilder',
  CommandRegistry: 'CommandRegistry',
  SessionRegistry: 'SessionRegistry',
  ChannelPluginManager: 'ChannelPluginManager',
  LLMProviderFactory: 'LLMProviderFactory',
  MediaDownloader: 'MediaDownloader',
} as const;

export type ServiceKey = typeof SERVICE_KEYS[keyof typeof SERVICE_KEYS];
