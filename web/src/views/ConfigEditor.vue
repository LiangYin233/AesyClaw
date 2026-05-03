<template>
  <div>
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="page-title">Config</h1>
        <p class="page-subtitle" style="margin: 0.25rem 0 0">
          Tune core runtime settings. Channel and plugin settings now live in their own pages.
        </p>
      </div>
      <div class="flex items-center gap-2.5 flex-wrap mb-0 justify-end">
        <button
          class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-primary rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-primary text-white hover:bg-primary-hover hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(217,119,87,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          :disabled="saving"
          @click="saveConfig"
        >
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <button
          class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-[var(--color-border)] rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-transparent text-mid-gray hover:bg-light-gray hover:text-dark hover:border-mid-gray"
          @click="loadConfig"
        >
          Reset
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-mid-gray text-center py-10 font-body italic text-sm">
      Loading configuration...
    </div>
    <div v-else-if="error" class="text-danger text-sm mt-3 font-body">{{ error }}</div>
    <div v-else class="flex flex-col gap-5">
      <section class="min-w-0 flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="font-heading text-base font-semibold text-dark m-0">Providers</h2>
            <p class="font-body text-sm text-mid-gray m-[0.2rem_0_0]">
              Configure provider credentials, protocol type, base URLs, and model presets visually.
            </p>
          </div>
          <button
            type="button"
            class="inline-flex items-center justify-center gap-1.5 px-[0.7rem] py-[0.35rem] border border-transparent rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-[#121212] text-white hover:bg-[#2a2a2a] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(18,18,18,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            @click="addProvider"
          >
            + Add provider
          </button>
        </div>

        <div
          v-if="providerEntries.length === 0"
          class="text-mid-gray text-center py-10 font-body italic text-sm border border-dashed border-[var(--color-border)] rounded"
        >
          No providers configured.
        </div>

        <div
          v-for="provider in providerEntries"
          :key="provider.key"
          class="p-4 border border-[var(--color-border)] rounded bg-surface shadow-sm"
        >
          <div class="flex items-center justify-between gap-4 mb-4">
            <div>
              <div class="font-heading text-sm font-semibold text-dark mb-[0.35rem]">
                {{ provider.key || 'New provider' }}
              </div>
              <span
                class="inline-flex items-center px-[0.65rem] py-[0.2rem] rounded-full font-heading text-[0.7rem] font-medium tracking-[0.03em] bg-[rgba(176,174,165,0.2)] text-[#8a8880]"
                >{{ provider.apiType }}</span
              >
            </div>
            <button
              type="button"
              class="inline-flex items-center justify-center p-1.5 border border-transparent rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-[#CF3A3A] text-white hover:bg-[#b83333] disabled:opacity-50 disabled:cursor-not-allowed"
              @click="removeProvider(provider.key)"
            >
              <TrashIcon class="w-4 h-4" />
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="mb-5">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >Provider key/name</label
              >
              <input
                :value="provider.key"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                placeholder="openai"
                @change="renameProvider(provider.key, ($event.target as HTMLInputElement).value)"
              />
            </div>
            <div class="mb-5">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >API type</label
              >
              <select
                :value="provider.apiType"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                @change="
                  updateProviderField(
                    provider.key,
                    'apiType',
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="openai_responses">openai_responses</option>
                <option value="openai_completion">openai_completion</option>
                <option value="anthropic">anthropic</option>
              </select>
            </div>
            <div class="mb-5">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >Base URL</label
              >
              <input
                :value="provider.baseUrl ?? ''"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                placeholder="https://api.example.com/v1"
                @input="
                  updateProviderOptionalString(
                    provider.key,
                    'baseUrl',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </div>
            <div class="mb-5 col-span-full">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >API key</label
              >
              <input
                :value="provider.apiKey ?? ''"
                type="text"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                placeholder="Provider API key"
                @input="
                  updateProviderOptionalString(
                    provider.key,
                    'apiKey',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </div>
          </div>

          <div
            class="flex flex-col gap-[0.85rem] mt-4 pt-4 border-t border-dashed border-[var(--color-border)]"
          >
            <div class="flex items-center justify-between gap-4">
              <div>
                <div class="font-heading text-sm font-semibold text-dark">Model presets</div>
                <p class="font-body text-sm text-mid-gray m-[0.2rem_0_0]">
                  Edit preset keys and common model fields while preserving future fields.
                </p>
              </div>
              <button
                type="button"
                class="inline-flex items-center justify-center gap-1.5 px-[0.7rem] py-[0.35rem] border border-transparent rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-[#121212] text-white hover:bg-[#2a2a2a] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(18,18,18,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                @click="addProviderModel(provider.key)"
              >
                + Add model
              </button>
            </div>

            <div
              v-if="provider.models.length === 0"
              class="text-mid-gray text-center py-10 font-body italic text-sm border border-dashed border-[var(--color-border)] rounded"
            >
              No model presets configured.
            </div>

            <div
              v-for="model in provider.models"
              :key="model.key"
              class="p-[0.85rem] border border-[var(--color-border)] rounded bg-[rgba(250,249,245,0.75)]"
            >
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div class="mb-5">
                  <label
                    class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                    >Model preset key</label
                  >
                  <input
                    :value="model.key"
                    class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                    placeholder="gpt-4o"
                    @change="
                      renameProviderModel(
                        provider.key,
                        model.key,
                        ($event.target as HTMLInputElement).value,
                      )
                    "
                  />
                </div>
                <div class="mb-5">
                  <label
                    class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                    >Context window</label
                  >
                  <input
                    :value="model.contextWindow ?? ''"
                    type="number"
                    class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                    placeholder="128000"
                    @input="
                      updateProviderModelNumber(
                        provider.key,
                        model.key,
                        ($event.target as HTMLInputElement).value,
                      )
                    "
                  />
                </div>
                <button
                  type="button"
                  class="inline-flex items-center justify-center p-1.5 border border-transparent rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-[#CF3A3A] text-white hover:bg-[#b83333] disabled:opacity-50 disabled:cursor-not-allowed self-end mb-5"
                  @click="removeProviderModel(provider.key, model.key)"
                >
                  <TrashIcon class="w-4 h-4" />
                </button>
                <div class="mb-5 col-span-full">
                  <label
                    class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                    >Extra body JSON</label
                  >
                  <JsonEditor
                    :model-value="toJson(model.extraBody ?? {})"
                    placeholder="{}"
                    @update:model-value="
                      updateProviderModelExtraBody(provider.key, model.key, $event)
                    "
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        v-for="section in configSections"
        :key="section.key"
        class="min-w-0 flex flex-col gap-4"
      >
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="font-heading text-base font-semibold text-dark m-0">{{ section.title }}</h2>
            <p class="font-body text-sm text-mid-gray m-[0.2rem_0_0]">{{ section.subtitle }}</p>
          </div>
        </div>

        <div
          v-if="section.key === 'server'"
          class="p-4 border border-[var(--color-border)] rounded bg-surface shadow-sm"
        >
          <SchemaForm
            :schema="section.schema"
            :model-value="editableConfig[section.key]"
            @update:model-value="updateConfigSection(section.key, $event)"
          />
        </div>
        <div v-else>
          <SchemaForm
            :schema="section.schema"
            :model-value="editableConfig[section.key]"
            @update:model-value="updateConfigSection(section.key, $event)"
          />
        </div>
      </section>

      <section
        v-if="configSections.length === 0"
        class="text-mid-gray text-center py-10 font-body italic text-sm border border-dashed border-[var(--color-border)] rounded"
      >
        No core configuration sections available.
      </section>

      <section class="min-w-0 flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="font-heading text-base font-semibold text-dark m-0">MCP servers</h2>
            <p class="font-body text-sm text-mid-gray m-[0.2rem_0_0]">
              Configure enabled state, transport, connection details, args, and environment.
            </p>
          </div>
          <button
            type="button"
            class="inline-flex items-center justify-center gap-1.5 px-[0.7rem] py-[0.35rem] border border-transparent rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-[#121212] text-white hover:bg-[#2a2a2a] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(18,18,18,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            @click="addMcpServer"
          >
            + Add MCP
          </button>
        </div>

        <div
          v-if="mcpServers.length === 0"
          class="text-mid-gray text-center py-10 font-body italic text-sm border border-dashed border-[var(--color-border)] rounded"
        >
          No MCP servers configured.
        </div>

        <div
          v-for="(server, index) in mcpServers"
          :key="`${server.name}-${index}`"
          class="p-4 border border-[var(--color-border)] rounded bg-surface shadow-sm"
        >
          <div class="flex items-center justify-between gap-4 mb-4">
            <div>
              <div class="font-heading text-sm font-semibold text-dark mb-[0.35rem]">
                {{ server.name || `MCP server ${index + 1}` }}
              </div>
              <span
                class="inline-flex items-center px-[0.65rem] py-[0.2rem] rounded-full font-heading text-[0.7rem] font-medium tracking-[0.03em]"
                :class="
                  server.enabled
                    ? 'bg-[rgba(120,140,93,0.12)] text-[#5a6e47]'
                    : 'bg-[rgba(176,174,165,0.2)] text-[#8a8880]'
                "
              >
                {{ server.enabled ? 'Enabled' : 'Disabled' }}
              </span>
            </div>
            <button
              type="button"
              class="inline-flex items-center justify-center p-1.5 border border-transparent rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-[#CF3A3A] text-white hover:bg-[#b83333] disabled:opacity-50 disabled:cursor-not-allowed"
              @click="removeMcpServer(index)"
            >
              <TrashIcon class="w-4 h-4" />
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="mb-5">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >Name</label
              >
              <input
                :value="server.name"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                placeholder="memory"
                @input="updateMcpField(index, 'name', ($event.target as HTMLInputElement).value)"
              />
            </div>
            <div class="mb-5">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >Transport</label
              >
              <select
                :value="server.transport"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                @change="
                  updateMcpField(index, 'transport', ($event.target as HTMLSelectElement).value)
                "
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="http">http</option>
              </select>
            </div>
            <div class="flex flex-col items-start gap-2 mb-5">
              <label
                class="block mb-0 font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >Enabled</label
              >
              <button
                type="button"
                class="w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-[0.15s] ease p-0"
                :class="server.enabled ? 'bg-accent-green' : 'bg-mid-gray'"
                @click="updateMcpField(index, 'enabled', !server.enabled)"
              >
                <span
                  class="absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform duration-[0.15s] ease"
                  :class="{ 'translate-x-5': server.enabled }"
                ></span>
              </button>
            </div>
            <div v-if="server.transport === 'stdio'" class="mb-5 col-span-full">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >Command</label
              >
              <input
                :value="server.command ?? ''"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                placeholder="npx"
                @input="
                  updateOptionalStringField(
                    index,
                    'command',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </div>
            <div v-else class="mb-5 col-span-full">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >URL</label
              >
              <input
                :value="server.url ?? ''"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                placeholder="https://example.com/mcp"
                @input="
                  updateOptionalStringField(index, 'url', ($event.target as HTMLInputElement).value)
                "
              />
            </div>
            <div class="mb-5 col-span-full">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >Args</label
              >
              <textarea
                :value="argsToText(server.args)"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)] min-h-[76px] resize-y font-mono text-xs"
                placeholder="One argument per line"
                @input="updateArgs(index, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
            </div>
            <div class="mb-5 col-span-full">
              <label
                class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                >Environment</label
              >
              <textarea
                :value="envToText(server.env)"
                class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)] min-h-[76px] resize-y font-mono text-xs"
                placeholder="KEY=value, one per line"
                @input="updateEnv(index, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div
      v-if="toast"
      class="fixed top-5 right-5 px-5 py-[0.85rem] rounded-sm text-white font-heading font-medium text-sm z-[200] animate-[slideInRight_0.3s_cubic-bezier(0.16,1,0.3,1)] shadow-lg"
      :class="toast.type === 'toast-success' ? 'bg-accent-green' : 'bg-danger'"
    >
      {{ toast.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';
import { useToast } from '@/composables/useToast';
import SchemaForm from '@/components/SchemaForm.vue';
import JsonEditor from '@/components/JsonEditor.vue';
import { TrashIcon } from '@heroicons/vue/24/outline';

type McpTransport = 'stdio' | 'sse' | 'http';

interface JsonSchemaRecord extends Record<string, unknown> {
  properties?: Record<string, unknown>;
}

interface ConfigSectionView {
  key: string;
  title: string;
  subtitle: string;
  schema: Record<string, unknown>;
}

interface McpServerForm extends Record<string, unknown> {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

type ApiType = 'openai_responses' | 'openai_completion' | 'anthropic';

interface ProviderModelForm extends Record<string, unknown> {
  key: string;
  contextWindow?: number;
  extraBody?: Record<string, unknown>;
}

interface ProviderForm extends Record<string, unknown> {
  key: string;
  apiType: ApiType;
  baseUrl?: string;
  apiKey?: string;
  models: ProviderModelForm[];
}

const { api } = useAuth();
const { toast, showToast } = useToast();

const editableSchema = ref<Record<string, unknown>>({});
const editableConfig = ref<Record<string, unknown>>({});
const fullConfig = ref<Record<string, unknown>>({});
const loading = ref(true);
const saving = ref(false);
const error = ref('');

const excludedTopLevelKeys = new Set(['channels', 'plugins']);
const hiddenSchemaKeys = new Set(['channels', 'plugins', 'providers', 'mcp', 'cors']);

const configSections = computed<ConfigSectionView[]>(() => {
  const properties = getSchemaProperties(editableSchema.value);
  return Object.entries(properties).map(([key, schema]) => ({
    key,
    title: formatSectionTitle(key),
    subtitle: getSectionSubtitle(key),
    schema: isRecord(schema) ? schema : {},
  }));
});

const mcpServers = computed<McpServerForm[]>(() => {
  const value = editableConfig.value['mcp'];
  if (!Array.isArray(value)) return [];
  return value.map(normalizeMcpServer);
});

const providerEntries = computed<ProviderForm[]>(() => {
  const value = editableConfig.value['providers'];
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, provider]) => normalizeProvider(key, provider));
});

async function loadSchema() {
  try {
    const res = await api.get('/config/schema');
    if (res.data.ok) {
      editableSchema.value = omitTopLevelSchemaProperties(res.data.data, hiddenSchemaKeys);
    }
  } catch (err) {
    console.error('Failed to load schema', err);
  }
}

async function loadConfig() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/config');
    if (res.data.ok) {
      fullConfig.value = res.data.data;
      editableConfig.value = omitTopLevelConfigKeys(res.data.data, excludedTopLevelKeys);
    } else {
      error.value = res.data.error ?? 'Failed to load config';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load config';
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    const res = await api.put('/config', editableConfig.value);
    if (res.data.ok) {
      fullConfig.value = { ...fullConfig.value, ...editableConfig.value };
      showToast('toast-success', 'Configuration saved successfully');
    } else {
      showToast('toast-error', res.data.error ?? 'Save failed');
    }
  } catch (err) {
    showToast('toast-error', err instanceof Error ? err.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

function updateConfigSection(key: string, value: unknown) {
  editableConfig.value = { ...editableConfig.value, [key]: value };
}

function addProvider() {
  const providers = getRawProviders();
  let nextKey = 'new-provider';
  let suffix = 1;
  while (Object.prototype.hasOwnProperty.call(providers, nextKey)) {
    suffix += 1;
    nextKey = `new-provider-${suffix}`;
  }
  editableConfig.value = {
    ...editableConfig.value,
    providers: { ...providers, [nextKey]: { apiType: 'openai_responses', models: {} } },
  };
}

function removeProvider(key: string) {
  const providers = getRawProviders();
  delete providers[key];
  editableConfig.value = { ...editableConfig.value, providers };
}

function renameProvider(oldKey: string, newKeyRaw: string) {
  const newKey = newKeyRaw.trim();
  const providers = getRawProviders();
  if (!newKey || newKey === oldKey) return;
  if (Object.prototype.hasOwnProperty.call(providers, newKey)) {
    showToast('toast-error', `A provider named "${newKey}" already exists`);
    return;
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(providers)) {
    next[key === oldKey ? newKey : key] = value;
  }
  editableConfig.value = { ...editableConfig.value, providers: next };
}

function updateProviderField(providerKey: string, key: 'apiType', value: unknown) {
  updateProvider(providerKey, (provider) => ({
    ...provider,
    [key]: isApiType(value) ? value : 'openai_responses',
  }));
}

function updateProviderOptionalString(
  providerKey: string,
  key: 'apiKey' | 'baseUrl',
  value: string,
) {
  updateProvider(providerKey, (provider) => updateOptionalProperty(provider, key, value));
}

function addProviderModel(providerKey: string) {
  updateProvider(providerKey, (provider) => {
    const models = getRawModels(provider);
    let nextKey = 'new-model';
    let suffix = 1;
    while (Object.prototype.hasOwnProperty.call(models, nextKey)) {
      suffix += 1;
      nextKey = `new-model-${suffix}`;
    }
    return { ...provider, models: { ...models, [nextKey]: {} } };
  });
}

function removeProviderModel(providerKey: string, modelKey: string) {
  updateProvider(providerKey, (provider) => {
    const models = getRawModels(provider);
    delete models[modelKey];
    return { ...provider, models };
  });
}

function renameProviderModel(providerKey: string, oldKey: string, newKeyRaw: string) {
  const newKey = newKeyRaw.trim();
  if (!newKey || newKey === oldKey) return;
  updateProvider(providerKey, (provider) => {
    const models = getRawModels(provider);
    if (Object.prototype.hasOwnProperty.call(models, newKey)) {
      showToast('toast-error', `A model preset named "${newKey}" already exists`);
      return provider;
    }
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(models)) {
      next[key === oldKey ? newKey : key] = value;
    }
    return { ...provider, models: next };
  });
}

function updateProviderModelNumber(providerKey: string, modelKey: string, value: string) {
  updateProviderModel(providerKey, modelKey, (model) => {
    const next = { ...model };
    const parsed = Number(value);
    if (value.trim() && Number.isFinite(parsed)) {
      next['contextWindow'] = parsed;
    } else {
      delete next['contextWindow'];
    }
    return next;
  });
}

function updateProviderModelExtraBody(providerKey: string, modelKey: string, value: string) {
  const parsed = parseJson(value);
  if (parsed === undefined) return;
  updateProviderModel(providerKey, modelKey, (model) => {
    const next = { ...model };
    if (isRecord(parsed) && Object.keys(parsed).length > 0) {
      next['extraBody'] = parsed;
    } else {
      delete next['extraBody'];
    }
    return next;
  });
}

function updateProvider(
  providerKey: string,
  updater: (provider: Record<string, unknown>) => Record<string, unknown>,
) {
  const providers = getRawProviders();
  const current = providers[providerKey];
  if (!isRecord(current)) return;
  providers[providerKey] = updater(current);
  editableConfig.value = { ...editableConfig.value, providers };
}

function updateProviderModel(
  providerKey: string,
  modelKey: string,
  updater: (model: Record<string, unknown>) => Record<string, unknown>,
) {
  updateProvider(providerKey, (provider) => {
    const models = getRawModels(provider);
    const current = models[modelKey];
    if (!isRecord(current)) return provider;
    models[modelKey] = updater(current);
    return { ...provider, models };
  });
}

function updateOptionalProperty(
  source: Record<string, unknown>,
  key: string,
  value: string,
): Record<string, unknown> {
  const next = { ...source };
  if (value.trim()) {
    next[key] = value;
  } else {
    delete next[key];
  }
  return next;
}

function addMcpServer() {
  const next = [...getRawMcpServers(), { name: '', transport: 'stdio', enabled: true }];
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function removeMcpServer(index: number) {
  const next = [...getRawMcpServers()];
  next.splice(index, 1);
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function updateMcpField(index: number, key: keyof McpServerForm, value: unknown) {
  const next = [...getRawMcpServers()];
  const current = next[index];
  if (!current) return;
  next[index] = { ...current, [key]: value };
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function updateOptionalStringField(index: number, key: 'command' | 'url', value: string) {
  const next = [...getRawMcpServers()];
  const current = next[index];
  if (!current) return;
  const updated = { ...current };
  if (value.trim()) {
    updated[key] = value;
  } else {
    delete updated[key];
  }
  next[index] = updated;
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function updateArgs(index: number, value: string) {
  const args = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const next = [...getRawMcpServers()];
  const current = next[index];
  if (!current) return;
  const updated = { ...current };
  if (args.length > 0) {
    updated['args'] = args;
  } else {
    delete updated['args'];
  }
  next[index] = updated;
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function updateEnv(index: number, value: string) {
  const env: Record<string, string> = {};
  for (const line of value.split('\n')) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;
    env[key] = line.slice(separatorIndex + 1);
  }
  const next = [...getRawMcpServers()];
  const current = next[index];
  if (!current) return;
  const updated = { ...current };
  if (Object.keys(env).length > 0) {
    updated['env'] = env;
  } else {
    delete updated['env'];
  }
  next[index] = updated;
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function argsToText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').join('\n')
    : '';
}

function envToText(value: unknown): string {
  if (!isStringRecord(value)) return '';
  return Object.entries(value)
    .map(([key, envValue]) => `${key}=${envValue}`)
    .join('\n');
}

function normalizeMcpServer(value: unknown): McpServerForm {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    name: typeof source['name'] === 'string' ? source['name'] : '',
    transport: isMcpTransport(source['transport']) ? source['transport'] : 'stdio',
    enabled: typeof source['enabled'] === 'boolean' ? source['enabled'] : true,
    command: typeof source['command'] === 'string' ? source['command'] : undefined,
    args: Array.isArray(source['args'])
      ? source['args'].filter((item): item is string => typeof item === 'string')
      : undefined,
    env: isStringRecord(source['env']) ? source['env'] : undefined,
    url: typeof source['url'] === 'string' ? source['url'] : undefined,
  };
}

function normalizeProvider(key: string, value: unknown): ProviderForm {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    key,
    apiType: isApiType(source['apiType']) ? source['apiType'] : 'openai_responses',
    baseUrl: typeof source['baseUrl'] === 'string' ? source['baseUrl'] : undefined,
    apiKey: typeof source['apiKey'] === 'string' ? source['apiKey'] : undefined,
    models: normalizeProviderModels(source['models']),
  };
}

function normalizeProviderModels(value: unknown): ProviderModelForm[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, model]) => {
    const source = isRecord(model) ? model : {};
    return {
      ...source,
      key,
      contextWindow: typeof source['contextWindow'] === 'number' ? source['contextWindow'] : undefined,
      extraBody: isRecord(source['extraBody']) ? source['extraBody'] : undefined,
    };
  });
}

function getRawProviders(): Record<string, unknown> {
  const value = editableConfig.value['providers'];
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, provider]) => [
      key,
      isRecord(provider) ? { ...provider } : {},
    ]),
  );
}

function getRawModels(provider: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(provider['models'])) return {};
  return Object.fromEntries(
    Object.entries(provider['models']).map(([key, model]) => [
      key,
      isRecord(model) ? { ...model } : {},
    ]),
  );
}

function getRawMcpServers(): Record<string, unknown>[] {
  const value = editableConfig.value['mcp'];
  if (!Array.isArray(value)) return [];
  return value.map((item) => (isRecord(item) ? { ...item } : {}));
}

function isMcpTransport(value: unknown): value is McpTransport {
  return value === 'stdio' || value === 'sse' || value === 'http';
}

function isApiType(value: unknown): value is ApiType {
  return value === 'openai_responses' || value === 'openai_completion' || value === 'anthropic';
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function omitTopLevelConfigKeys(
  source: unknown,
  topLevelKeysToOmit: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (topLevelKeysToOmit.has(key.toLowerCase()) || key.toLowerCase() === 'cors') continue;
    next[key] = value;
  }
  return next;
}

function omitTopLevelSchemaProperties(
  source: unknown,
  keysToOmit: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const next: Record<string, unknown> = { ...source };
  if (isRecord(source['properties'])) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source['properties'])) {
      if (!keysToOmit.has(key.toLowerCase())) properties[key] = value;
    }
    next['properties'] = properties;
  }
  if (Array.isArray(source['required'])) {
    next['required'] = source['required'].filter(
      (item): item is string => typeof item === 'string' && !keysToOmit.has(item.toLowerCase()),
    );
  }
  return next;
}

function getSchemaProperties(schema: JsonSchemaRecord): Record<string, unknown> {
  return isRecord(schema['properties']) ? schema['properties'] : {};
}

function formatSectionTitle(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (char) => char.toUpperCase());
}

function getSectionSubtitle(key: string): string {
  const subtitles: Record<string, string> = {
    server: 'Host, port, logging, and WebUI authentication settings.',
    providers: 'Provider credentials, protocol choices, and model presets.',
    agent: 'Agent memory and multimodal model defaults.',
  };
  return (
    subtitles[key] ??
    'Edit this config section while preserving unknown fields from the config API.'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

onMounted(() => {
  void loadSchema();
  void loadConfig();
});
</script>
