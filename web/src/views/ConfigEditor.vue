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
          :disabled="saving || hasExtraBodyErrors"
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
                <option value="openai-responses">openai-responses</option>
                <option value="openai-completions">openai-completions</option>
                <option value="anthropic-messages">anthropic-messages</option>
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
                    :model-value="getExtraBodyText(provider.key, model.key, model.extraBody ?? {})"
                    placeholder="{}"
                    @update:model-value="
                      updateProviderModelExtraBody(provider.key, model.key, $event)
                    "
                  />
                  <p
                    v-if="getExtraBodyError(provider.key, model.key)"
                    class="text-danger text-xs mt-2 font-body"
                  >
                    {{ getExtraBodyError(provider.key, model.key) }}
                  </p>
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
          :class="{
            'p-4 border border-[var(--color-border)] rounded bg-surface shadow-sm':
              section.key === 'server',
          }"
        >
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
              <ToggleSwitch
                :model-value="server.enabled"
                @update:model-value="updateMcpField(index, 'enabled', $event)"
              />
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
  </div>
</template>

<script setup lang="ts">
import SchemaForm from '@/components/SchemaForm.vue';
import JsonEditor from '@/components/JsonEditor.vue';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import { TrashIcon } from '@heroicons/vue/24/outline';
import { useConfigEditor } from '@/composables/useConfigEditor';

const {
  editableConfig,
  loading,
  saving,
  error,
  configSections,
  mcpServers,
  providerEntries,
  hasExtraBodyErrors,
  loadConfig,
  saveConfig,
  updateConfigSection,
  addProvider,
  removeProvider,
  renameProvider,
  updateProviderField,
  updateProviderOptionalString,
  addProviderModel,
  removeProviderModel,
  renameProviderModel,
  updateProviderModelNumber,
  updateProviderModelExtraBody,
  addMcpServer,
  removeMcpServer,
  updateMcpField,
  updateOptionalStringField,
  updateArgs,
  updateEnv,
  argsToText,
  envToText,
  getExtraBodyError,
  getExtraBodyText,
} = useConfigEditor();
</script>
