<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1600px]">
      <header class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">设置</p>
          <h1 class="cn-page-title mt-2 text-on-surface">系统配置</h1>
          <p class="cn-body mt-2 max-w-3xl text-sm text-on-surface-variant">在这里调整服务参数、记忆策略和扩展模块配置，保存后立即生效。</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="rounded-xl bg-surface-container-high px-5 py-2.5 text-sm font-semibold text-on-surface transition hover:bg-surface-container-highest"
            type="button"
            :disabled="loading || saving"
            @click="loadConfig"
          >
            重新拉取配置
          </button>
          <button
            class="rounded-xl bg-surface-container-high px-5 py-2.5 text-sm font-semibold text-on-surface transition hover:bg-surface-container-highest"
            type="button"
            :disabled="loading || saving"
            @click="resetDraft"
          >
            放弃更改
          </button>
          <button
            class="rounded-xl bg-gradient-to-br from-primary to-primary-container px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            :disabled="loading || saving || !configDraft"
            @click="saveConfig"
          >
            {{ saving ? '保存中...' : '应用更改' }}
          </button>
        </div>
      </header>

      <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
        <p class="font-bold">配置读取失败</p>
        <p class="mt-2 leading-6">{{ error }}</p>
      </div>

      <div v-if="saveMessage" class="mb-6 flex items-center justify-between rounded-r-xl border-l-4 border-primary bg-primary-fixed/30 p-4">
        <div class="flex items-center gap-3">
          <AppIcon name="overview" class="text-primary" />
          <p class="text-sm font-medium text-on-primary-fixed">{{ saveMessage }}</p>
        </div>
        <button class="text-xs font-bold tracking-[0.08em] text-primary hover:underline" type="button" @click="goToLogs">查看观测</button>
      </div>

      <div class="space-y-8">
          <section v-if="configDraft" class="hairline-card rounded-2xl p-8">
            <div class="mb-8 flex items-start justify-between gap-4">
              <div class="flex items-center gap-4">
                <div class="flex size-12 items-center justify-center rounded-lg bg-surface-container-low text-primary">
                  <AppIcon name="panel" />
                </div>
                <div>
                  <h3 class="cn-section-title text-on-surface">服务设置</h3>
                  <p class="mt-1 text-sm text-on-surface-variant">服务地址、端口与 API 开关。</p>
                </div>
              </div>
              <span class="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold tracking-[0.08em] text-emerald-700">已接入</span>
            </div>

            <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
              <label class="space-y-1.5">
                <span class="text-xs font-bold tracking-[0.08em] text-outline">服务地址</span>
                <input v-model="configDraft.server!.host" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none ring-0 transition focus:ring-2 focus:ring-primary/20" type="text" />
              </label>
              <label class="space-y-1.5">
                <span class="text-xs font-bold tracking-[0.08em] text-outline">端口</span>
                <input v-model.number="configDraft.server!.apiPort" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none ring-0 transition focus:ring-2 focus:ring-primary/20" type="number" />
              </label>
              <div class="md:col-span-2 flex items-center justify-between rounded-lg bg-surface px-4 py-3">
                <div>
                  <p class="text-sm font-medium text-on-surface">启用 API 服务</p>
                  <p class="mt-1 text-xs text-on-surface-variant">关闭后仅保留本地运行环境。</p>
                </div>
                <button class="relative h-5 w-10 rounded-full transition" :class="configDraft.server!.apiEnabled ? 'bg-primary-container' : 'bg-surface-container-high'" type="button" @click="configDraft.server!.apiEnabled = !configDraft.server!.apiEnabled">
                  <span class="absolute top-0.5 size-4 rounded-full bg-white transition" :class="configDraft.server!.apiEnabled ? 'right-0.5' : 'left-0.5'"></span>
                </button>
              </div>
            </div>
          </section>

          <div v-if="configDraft" class="grid grid-cols-1 gap-8 md:grid-cols-2">
            <section class="hairline-card rounded-2xl p-8">
              <h4 class="cn-section-title text-on-surface">会话与记忆策略</h4>
              <div class="mt-5 grid grid-cols-1 gap-4">
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">上下文模式</span>
                  <select v-model="configDraft.agent!.defaults!.contextMode" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20">
                    <option value="session">session</option>
                    <option value="channel">channel</option>
                  </select>
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">最大会话数</span>
                  <input v-model.number="configDraft.agent!.defaults!.maxSessions" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="number" />
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">记忆窗口</span>
                  <input v-model.number="configDraft.agent!.defaults!.memoryWindow" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="number" />
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">最大工具迭代</span>
                  <input v-model.number="configDraft.agent!.defaults!.maxToolIterations" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="number" />
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">视觉回退模型</span>
                  <input v-model="configDraft.agent!.defaults!.visionFallbackModel" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" placeholder="provider/model" />
                </label>
              </div>
            </section>

            <section class="hairline-card rounded-2xl p-8">
              <h4 class="cn-section-title text-on-surface">记忆摘要</h4>
              <div class="mt-5 space-y-4">
                <div class="flex items-center justify-between rounded-lg bg-surface px-4 py-3">
                  <div>
                    <p class="text-sm font-medium text-on-surface">启用摘要</p>
                    <p class="mt-1 text-xs text-on-surface-variant">自动生成会话摘要。</p>
                  </div>
                  <button class="relative h-5 w-10 rounded-full transition" :class="configDraft.agent!.defaults!.memorySummary!.enabled ? 'bg-primary-container' : 'bg-surface-container-high'" type="button" @click="configDraft.agent!.defaults!.memorySummary!.enabled = !configDraft.agent!.defaults!.memorySummary!.enabled">
                    <span class="absolute top-0.5 size-4 rounded-full bg-white transition" :class="configDraft.agent!.defaults!.memorySummary!.enabled ? 'right-0.5' : 'left-0.5'"></span>
                  </button>
                </div>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">模型</span>
                  <input v-model="configDraft.agent!.defaults!.memorySummary!.model" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" placeholder="provider/model" />
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">压缩轮次</span>
                  <input v-model.number="configDraft.agent!.defaults!.memorySummary!.compressRounds" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="number" />
                </label>
              </div>
            </section>

            <section class="hairline-card rounded-2xl p-8">
              <h4 class="cn-section-title text-on-surface">长期事实</h4>
              <div class="mt-5 space-y-4">
                <div class="flex items-center justify-between rounded-lg bg-surface px-4 py-3">
                  <div>
                    <p class="text-sm font-medium text-on-surface">启用事实</p>
                    <p class="mt-1 text-xs text-on-surface-variant">存储和检索长期事实。</p>
                  </div>
                  <button class="relative h-5 w-10 rounded-full transition" :class="configDraft.agent!.defaults!.memoryFacts!.enabled ? 'bg-primary-container' : 'bg-surface-container-high'" type="button" @click="configDraft.agent!.defaults!.memoryFacts!.enabled = !configDraft.agent!.defaults!.memoryFacts!.enabled">
                    <span class="absolute top-0.5 size-4 rounded-full bg-white transition" :class="configDraft.agent!.defaults!.memoryFacts!.enabled ? 'right-0.5' : 'left-0.5'"></span>
                  </button>
                </div>
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label class="space-y-1.5">
                    <span class="text-xs font-bold tracking-[0.08em] text-outline">维护模型</span>
                    <input v-model="configDraft.agent!.defaults!.memoryFacts!.model" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" placeholder="provider/model" />
                  </label>
                  <label class="space-y-1.5">
                    <span class="text-xs font-bold tracking-[0.08em] text-outline">检索模型</span>
                    <input v-model="configDraft.agent!.defaults!.memoryFacts!.retrievalModel" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" placeholder="provider/model" />
                  </label>
                </div>
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label class="space-y-1.5">
                    <span class="text-xs font-bold tracking-[0.08em] text-outline">检索 TopK</span>
                    <input v-model.number="configDraft.agent!.defaults!.memoryFacts!.retrievalTopK" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="number" />
                  </label>
                </div>
              </div>
            </section>

            <section class="hairline-card rounded-2xl p-8">
              <h4 class="cn-section-title text-on-surface">观测与超时</h4>
              <div class="mt-5 grid grid-cols-1 gap-4">
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">日志等级</span>
                  <select v-model="configDraft.observability!.level" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20">
                    <option value="debug">debug</option>
                    <option value="info">info</option>
                    <option value="warn">warn</option>
                    <option value="error">error</option>
                  </select>
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">工具超时 (ms)</span>
                  <input v-model.number="configDraft.tools!.timeoutMs" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="number" />
                </label>
              </div>
            </section>
          </div>

          <section v-if="configDraft" class="hairline-card rounded-2xl p-8">
            <div class="mb-6 flex items-center justify-between">
              <div>
                <h3 class="cn-section-title text-on-surface">Provider 配置</h3>
                <p class="mt-1 text-sm text-on-surface-variant">这里直接编辑模型提供商配置，主 Agent 与记忆模块可复用这些 provider 名称。</p>
              </div>
              <button
                class="rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition hover:bg-surface-container-highest"
                type="button"
                @click="addProvider"
              >
                新增 Provider
              </button>
            </div>
            <div class="space-y-5">
              <article
                v-for="[providerName, provider] in providerEntries"
                :key="providerName"
                class="rounded-2xl border border-outline-variant/12 bg-surface-container-lowest p-5"
              >
                <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div class="grid min-w-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
                    <label class="space-y-1.5">
                      <span class="text-xs font-bold tracking-[0.08em] text-outline">Provider 名称</span>
                      <input
                        :value="providerName"
                        class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20"
                        type="text"
                        @change="renameProvider(providerName, ($event.target as HTMLInputElement).value)"
                      />
                    </label>
                    <label class="space-y-1.5">
                      <span class="text-xs font-bold tracking-[0.08em] text-outline">类型</span>
                      <select v-model="provider.type" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20">
                        <option value="openai">openai</option>
                        <option value="openai_responses">openai_responses</option>
                        <option value="anthropic">anthropic</option>
                      </select>
                    </label>
                    <label class="space-y-1.5 md:col-span-2">
                      <span class="text-xs font-bold tracking-[0.08em] text-outline">API Base</span>
                      <input v-model="provider.apiBase" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" placeholder="https://api.example.com/v1" />
                    </label>
                    <label class="space-y-1.5 md:col-span-2">
                      <span class="text-xs font-bold tracking-[0.08em] text-outline">API Key</span>
                      <input v-model="provider.apiKey" class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" placeholder="sk-..." />
                    </label>
                  </div>
                  <button
                    class="rounded-xl border border-error/20 px-4 py-2 text-sm font-semibold text-error transition hover:bg-error-container/60"
                    type="button"
                    @click="removeProvider(providerName)"
                  >
                    删除
                  </button>
                </div>

                <div class="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <label class="space-y-1.5">
                    <span class="text-xs font-bold tracking-[0.08em] text-outline">Headers JSON</span>
                    <textarea
                      :value="providerHeadersDrafts[providerName] || '{}'"
                      class="tech-text min-h-[9rem] w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20"
                      @input="updateProviderJsonDraft(providerName, 'headers', ($event.target as HTMLTextAreaElement).value)"
                    ></textarea>
                    <p class="text-[11px] text-on-surface-variant">用于写额外请求头，需保持 JSON 对象格式。</p>
                    <p v-if="providerJsonErrors[providerName]?.headers" class="text-[11px] text-error">{{ providerJsonErrors[providerName]?.headers }}</p>
                  </label>
                  <label class="space-y-1.5">
                    <span class="text-xs font-bold tracking-[0.08em] text-outline">Extra Body JSON</span>
                    <textarea
                      :value="providerExtraBodyDrafts[providerName] || '{}'"
                      class="tech-text min-h-[9rem] w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20"
                      @input="updateProviderJsonDraft(providerName, 'extraBody', ($event.target as HTMLTextAreaElement).value)"
                    ></textarea>
                    <p class="text-[11px] text-on-surface-variant">用于补充供应商私有请求体字段，需保持 JSON 对象格式。</p>
                    <p v-if="providerJsonErrors[providerName]?.extraBody" class="text-[11px] text-error">{{ providerJsonErrors[providerName]?.extraBody }}</p>
                  </label>
                  <label class="space-y-1.5 xl:col-span-2">
                    <span class="text-xs font-bold tracking-[0.08em] text-outline">模型能力 JSON</span>
                    <textarea
                      :value="providerModelsDrafts[providerName] || '{}'"
                      class="tech-text min-h-[10rem] w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20"
                      @input="updateProviderJsonDraft(providerName, 'models', ($event.target as HTMLTextAreaElement).value)"
                    ></textarea>
                    <p class="text-[11px] text-on-surface-variant">键为模型名，值为能力对象，例如 <code>{"qwen3.5-plus":{"supportsVision":true}}</code></p>
                    <p v-if="providerJsonErrors[providerName]?.models" class="text-[11px] text-error">{{ providerJsonErrors[providerName]?.models }}</p>
                  </label>
                </div>
              </article>

              <div v-if="!providerEntries.length" class="rounded-2xl bg-surface-container-low px-4 py-5 text-sm text-on-surface-variant">
                当前没有 provider，点击上方“新增 Provider”开始配置。
              </div>
            </div>
          </section>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { apiGet, apiPut } from '@/lib/api';
import { getRouteToken } from '@/lib/auth';
import type { AppConfig, ProviderConfig, ProviderModelConfig } from '@/lib/types';

const route = useRoute();
const router = useRouter();
const token = getRouteToken(route);

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const saveMessage = ref('');
const config = ref<AppConfig | null>(null);
const configDraft = ref<AppConfig | null>(null);
const providerHeadersDrafts = ref<Record<string, string>>({});
const providerExtraBodyDrafts = ref<Record<string, string>>({});
const providerModelsDrafts = ref<Record<string, string>>({});
const providerJsonErrors = ref<Record<string, { headers?: string; extraBody?: string; models?: string }>>({});

const providerEntries = computed(() => Object.entries(configDraft.value?.providers || {}) as Array<[string, ProviderConfig]>);
const providerNames = computed(() => Object.keys(configDraft.value?.providers || {}));
const hasProviderJsonErrors = computed(() => Object.values(providerJsonErrors.value).some((item) => Boolean(item?.headers || item?.extraBody)));

function createEmptyProvider(): ProviderConfig {
  return {
    type: 'openai',
    apiKey: '',
    apiBase: '',
    headers: {},
    extraBody: {},
    models: {},
  };
}

function formatJsonObject(value: Record<string, unknown> | undefined) {
  return JSON.stringify(value || {}, null, 2);
}

function syncProviderEditors() {
  const providers = configDraft.value?.providers || {};
  providerHeadersDrafts.value = {};
  providerExtraBodyDrafts.value = {};
  providerModelsDrafts.value = {};
  providerJsonErrors.value = {};

  for (const [name, provider] of Object.entries(providers)) {
    providerHeadersDrafts.value[name] = formatJsonObject(provider.headers);
    providerExtraBodyDrafts.value[name] = formatJsonObject(provider.extraBody as Record<string, unknown> | undefined);
    providerModelsDrafts.value[name] = formatJsonObject(provider.models as Record<string, unknown> | undefined);
  }
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} 必须是有效的 JSON 格式`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} 必须是 JSON 对象`);
  }

  return parsed as Record<string, unknown>;
}

function normalizeProviderModels(parsed: Record<string, unknown>): Record<string, ProviderModelConfig> {
  const next: Record<string, ProviderModelConfig> = {};

  for (const [modelName, rawConfig] of Object.entries(parsed)) {
    if (!rawConfig || Array.isArray(rawConfig) || typeof rawConfig !== 'object') {
      throw new Error(`模型 ${modelName} 的能力配置必须是对象`);
    }

    const entry = rawConfig as Record<string, unknown>;
    next[modelName] = {
      maxContextTokens: typeof entry.maxContextTokens === 'number' ? entry.maxContextTokens : undefined,
      reasoning: entry.reasoning === true,
      supportsVision: entry.supportsVision === true,
    };
  }

  return next;
}

function updateProviderJsonDraft(name: string, field: 'headers' | 'extraBody' | 'models', value: string) {
  if (!configDraft.value?.providers?.[name]) return;

  if (field === 'headers') {
    providerHeadersDrafts.value[name] = value;
  } else if (field === 'extraBody') {
    providerExtraBodyDrafts.value[name] = value;
  } else {
    providerModelsDrafts.value[name] = value;
  }

  const nextErrors = { ...(providerJsonErrors.value[name] || {}) };

  try {
    const parsed = parseJsonObject(value, field === 'headers' ? 'Headers' : 'Extra Body');
    if (field === 'headers') {
      configDraft.value.providers[name].headers = Object.fromEntries(
        Object.entries(parsed).map(([key, item]) => [key, String(item ?? '')])
      );
      delete nextErrors.headers;
    } else if (field === 'extraBody') {
      configDraft.value.providers[name].extraBody = parsed;
      delete nextErrors.extraBody;
    } else {
      configDraft.value.providers[name].models = normalizeProviderModels(parsed);
      delete nextErrors.models;
    }
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : 'JSON 解析失败';
    if (field === 'headers') {
      nextErrors.headers = message;
    } else if (field === 'extraBody') {
      nextErrors.extraBody = message;
    } else {
      nextErrors.models = message;
    }
  }

  providerJsonErrors.value[name] = nextErrors;
}

function addProvider() {
  if (!configDraft.value) return;

  let index = 1;
  let name = `provider${index}`;
  while (configDraft.value.providers?.[name]) {
    index += 1;
    name = `provider${index}`;
  }

  configDraft.value.providers ||= {};
  configDraft.value.providers[name] = createEmptyProvider();
  syncProviderEditors();
}

function renameProvider(oldName: string, nextNameRaw: string) {
  if (!configDraft.value?.providers) return;

  const nextName = nextNameRaw.trim();
  if (!nextName || nextName === oldName) {
    return;
  }
  if (configDraft.value.providers[nextName]) {
    error.value = `Provider 名称 "${nextName}" 已存在`;
    return;
  }

  const nextProviders: Record<string, ProviderConfig> = {};
  for (const [name, provider] of Object.entries(configDraft.value.providers)) {
    nextProviders[name === oldName ? nextName : name] = provider;
  }
  configDraft.value.providers = nextProviders;
  error.value = '';
  syncProviderEditors();
}

function removeProvider(name: string) {
  if (!configDraft.value?.providers?.[name]) return;
  delete configDraft.value.providers[name];
  syncProviderEditors();
}

function normalizeConfig(source: AppConfig): AppConfig {
  const next = structuredClone(source || {});

  next.server ||= { host: '0.0.0.0', apiPort: 18792, apiEnabled: true };
  next.agent ||= { defaults: {} };
  next.agent.defaults ||= {};
  next.agent.defaults.visionFallbackModel ||= '';
  next.agent.defaults.memorySummary ||= { enabled: false, model: '', compressRounds: 5 };
  next.agent.defaults.memoryFacts ||= {
    enabled: false,
    model: '',
    retrievalModel: '',
    retrievalThreshold: 0.59,
    retrievalTopK: 5,
  };
  next.agents ||= { roles: {} };
  next.agents.roles ||= {};
  next.agents.roles.main ||= {
    name: 'main',
    description: '',
    model: '',
    systemPrompt: '',
    allowedSkills: [],
    allowedTools: [],
  };
  next.providers ||= {};
  next.channels ||= {};
  next.plugins ||= {};
  next.skills ||= {};
  next.mcp ||= {};
  next.observability ||= { level: 'info' };
  next.tools ||= { timeoutMs: 120000 };

  return next;
}

async function loadConfig() {
  loading.value = true;
  error.value = '';
  saveMessage.value = '';

  const result = await apiGet<AppConfig>('/api/config', token);
  if (result.error || !result.data) {
    error.value = result.error || '配置加载失败';
    loading.value = false;
    return;
  }

  config.value = normalizeConfig(result.data);
  configDraft.value = normalizeConfig(result.data);
  syncProviderEditors();
  loading.value = false;
}

function resetDraft() {
  if (!config.value) return;
  configDraft.value = normalizeConfig(config.value);
  saveMessage.value = '';
  syncProviderEditors();
}

async function saveConfig() {
  if (!configDraft.value) return;
  if (hasProviderJsonErrors.value) {
    error.value = 'Provider JSON 配置存在格式错误，请先修正后再保存';
    return;
  }

  saving.value = true;
  error.value = '';
  const result = await apiPut<{ success: true }>('/api/config', token, configDraft.value);
  saving.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  config.value = normalizeConfig(configDraft.value);
  syncProviderEditors();
  saveMessage.value = '配置已保存。部分模块可能需要重启后生效。';
}

function goToLogs() {
  router.push({
    path: '/observability/logs',
    query: token ? { token } : {},
  });
}

loadConfig();
</script>
