/**
 * 配置状态管理 Store
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { configService, type Config, type ConfigSchema } from '@/services/configService';

export const useConfigStore = defineStore('config', () => {
  // State
  const config = ref<Config>({});
  const schema = ref<ConfigSchema | null>(null);
  const plugins = ref<Array<{ name: string; version: string; enabled: boolean }>>([]);
  const channels = ref<Array<{ name: string; version: string; enabled: boolean }>>([]);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const providers = computed(() => config.value.providers || {});
  const mcpServers = computed(() => config.value.mcp || []);
  const hasProviders = computed(() => Object.keys(providers.value).length > 0);
  const hasMcpServers = computed(() => mcpServers.value.length > 0);
  const enabledPlugins = computed(() => plugins.value.filter((p) => p.enabled));
  const enabledChannels = computed(() => channels.value.filter((c) => c.enabled));

  // Actions
  async function loadSchema() {
    loading.value = true;
    error.value = null;
    try {
      schema.value = await configService.getConfigSchema();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load config schema';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadConfig() {
    loading.value = true;
    error.value = null;
    try {
      config.value = await configService.getConfig();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load config';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function saveConfig(newConfig: Config) {
    saving.value = true;
    error.value = null;
    try {
      await configService.updateConfig(newConfig);
      config.value = newConfig;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save config';
      throw err;
    } finally {
      saving.value = false;
    }
  }

  async function reloadConfig() {
    loading.value = true;
    error.value = null;
    try {
      await configService.reloadConfig();
      await loadConfig();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to reload config';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadPlugins() {
    loading.value = true;
    error.value = null;
    try {
      plugins.value = await configService.getPlugins();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load plugins';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function loadChannels() {
    loading.value = true;
    error.value = null;
    try {
      channels.value = await configService.getChannels();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load channels';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function updateConfig(key: string, value: unknown) {
    config.value = { ...config.value, [key]: value };
  }

  function clearConfig() {
    config.value = {};
    schema.value = null;
    plugins.value = [];
    channels.value = [];
  }

  // Setup config update listeners
  function setupListeners() {
    configService.onConfigUpdate((newConfig) => {
      config.value = newConfig;
    });
  }

  // Cleanup listeners
  function cleanupListeners() {
    // Note: We need to store the handler references to properly remove them
    // This is a simplified version - in production, you'd want to store the handlers
  }

  return {
    // State
    config,
    schema,
    plugins,
    channels,
    loading,
    saving,
    error,

    // Getters
    providers,
    mcpServers,
    hasProviders,
    hasMcpServers,
    enabledPlugins,
    enabledChannels,

    // Actions
    loadSchema,
    loadConfig,
    saveConfig,
    reloadConfig,
    loadPlugins,
    loadChannels,
    updateConfig,
    clearConfig,
    setupListeners,
    cleanupListeners,
  };
});
