<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1600px]">
      <header class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">设置</p>
          <h1 class="cn-page-title mt-2 text-on-surface">系统配置</h1>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="rounded-xl border border-outline-variant/16 bg-surface-container-lowest/80 px-5 py-2.5 text-sm font-semibold text-on-surface transition hover:bg-surface-container-low"
            type="button"
            :disabled="loading || saving"
            @click="loadConfig"
          >
            重新拉取配置
          </button>
          <button
            class="rounded-xl border border-outline-variant/16 bg-surface-container-lowest/80 px-5 py-2.5 text-sm font-semibold text-on-surface transition hover:bg-surface-container-low"
            type="button"
            :disabled="loading || saving"
            @click="resetDraft"
          >
            放弃更改
          </button>
          <button
            class="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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

      <div v-if="saveMessage" class="workspace-shell mb-6 flex items-center justify-between rounded-2xl px-4 py-4">
        <div class="flex items-center gap-3">
          <AppIcon name="overview" class="text-primary" />
          <p class="text-sm font-medium text-on-primary-fixed">{{ saveMessage }}</p>
        </div>
        <button class="text-xs font-bold tracking-[0.08em] text-primary hover:underline" type="button" @click="goToLogs">查看观测</button>
      </div>

      <datalist id="configured-model-refs">
        <option value=""></option>
        <option v-for="modelRef in modelRefOptions" :key="modelRef" :value="modelRef"></option>
      </datalist>

      <div class="space-y-8">
        <section v-if="configDraft" class="workspace-shell rounded-[1.75rem] p-8">
          <div class="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p class="cn-section-title text-on-surface">服务设置</p>
              <p class="mt-1 text-sm text-on-surface-variant">服务地址、端口与 API 开关。</p>
            </div>
            <span class="rounded-full bg-surface-container-low px-3 py-1 text-[10px] font-bold tracking-[0.08em] text-on-surface-variant">基础参数</span>
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
            <div class="workspace-subtle flex items-center justify-between rounded-lg px-4 py-3 md:col-span-2">
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
          <section class="workspace-shell rounded-[1.75rem] p-8">
            <h4 class="cn-section-title text-on-surface">主 Agent 与会话策略</h4>
            <div class="mt-5 grid grid-cols-1 gap-4">
              <label class="space-y-1.5">
                <span class="text-xs font-bold tracking-[0.08em] text-outline">主 Agent 模型</span>
                <input v-model="configDraft.agents!.roles!.main!.model" class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" list="configured-model-refs" placeholder="从下方已配置模型中选择" />
              </label>
              <label class="space-y-1.5">
                <span class="text-xs font-bold tracking-[0.08em] text-outline">视觉回退模型</span>
                <input v-model="configDraft.agent!.defaults!.visionFallbackModel" class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" list="configured-model-refs" placeholder="provider/model" />
              </label>
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
            </div>
          </section>

          <section class="workspace-shell rounded-[1.75rem] p-8">
            <h4 class="cn-section-title text-on-surface">记忆摘要</h4>
            <div class="mt-5 space-y-4">
              <div class="workspace-subtle flex items-center justify-between rounded-lg px-4 py-3">
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
                <input v-model="configDraft.agent!.defaults!.memorySummary!.model" class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" list="configured-model-refs" placeholder="provider/model" />
              </label>
              <label class="space-y-1.5">
                <span class="text-xs font-bold tracking-[0.08em] text-outline">压缩轮次</span>
                <input v-model.number="configDraft.agent!.defaults!.memorySummary!.compressRounds" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="number" />
              </label>
            </div>
          </section>

          <section class="workspace-shell rounded-[1.75rem] p-8">
            <h4 class="cn-section-title text-on-surface">长期事实</h4>
            <div class="mt-5 space-y-4">
              <div class="workspace-subtle flex items-center justify-between rounded-lg px-4 py-3">
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
                  <input v-model="configDraft.agent!.defaults!.memoryFacts!.model" class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" list="configured-model-refs" placeholder="provider/model" />
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">检索模型</span>
                  <input v-model="configDraft.agent!.defaults!.memoryFacts!.retrievalModel" class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" list="configured-model-refs" placeholder="provider/model" />
                </label>
              </div>
              <label class="space-y-1.5">
                <span class="text-xs font-bold tracking-[0.08em] text-outline">检索 TopK</span>
                <input v-model.number="configDraft.agent!.defaults!.memoryFacts!.retrievalTopK" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="number" />
              </label>
            </div>
          </section>

          <section class="workspace-shell rounded-[1.75rem] p-8">
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

        <section v-if="configDraft" class="workspace-shell rounded-[1.75rem] p-8">
          <div class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 class="cn-section-title text-on-surface">Provider 与模型</h3>
            </div>
            <div class="flex items-center gap-3">
              <span class="rounded-full bg-surface-container-low px-3 py-1 text-[10px] font-bold tracking-[0.08em] text-on-surface-variant">已配置模型 {{ modelRefOptions.length }}</span>
              <button
                class="rounded-xl border border-outline-variant/16 bg-surface-container-lowest/80 px-4 py-2 text-sm font-semibold text-on-surface transition hover:bg-surface-container-low"
                type="button"
                @click="addProvider"
              >
                新增 Provider
              </button>
            </div>
          </div>

          <div class="space-y-5">
            <article
              v-for="[providerName, provider] in providerEntries"
              :key="providerName"
              class="workspace-subtle rounded-[1.5rem] p-5"
            >
              <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
                  删除 Provider
                </button>
              </div>

              <div class="mt-5 grid grid-cols-1 gap-4 border-t workspace-divider pt-5 xl:grid-cols-2">
                <div class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">Headers</span>
                  <KeyValueEditor :model-value="provider.headers || {}" @update:model-value="provider.headers = $event" />
                </div>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">Extra Body JSON</span>
                  <textarea
                    :value="providerExtraBodyDrafts[providerName] || '{}'"
                    class="tech-text min-h-[14rem] w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20"
                    @input="updateProviderExtraBodyDraft(providerName, ($event.target as HTMLTextAreaElement).value)"
                  ></textarea>
                  <p class="text-[11px] text-on-surface-variant">保留 JSON 形式以支持数字、布尔值和嵌套对象。</p>
                  <p v-if="providerJsonErrors[providerName]?.extraBody" class="text-[11px] text-error">{{ providerJsonErrors[providerName]?.extraBody }}</p>
                </label>
              </div>

              <div class="mt-6 border-t workspace-divider pt-6">
                <div class="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h4 class="text-sm font-bold text-on-surface">模型列表</h4>
                    <p class="mt-1 text-xs text-on-surface-variant">在这里定义该 Provider 下可被引用的模型与能力开关。</p>
                  </div>
                  <button
                    class="rounded-xl border border-outline-variant/16 bg-surface-container-lowest/80 px-4 py-2 text-sm font-semibold text-on-surface transition hover:bg-surface-container-low"
                    type="button"
                    @click="addModel(providerName)"
                  >
                    新增模型
                  </button>
                </div>

                <div class="space-y-3">
                  <div
                    v-for="[modelName, modelConfig] in Object.entries(provider.models || {})"
                    :key="`${providerName}/${modelName}`"
                    class="workspace-subtle grid grid-cols-1 gap-4 rounded-2xl p-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(120px,0.7fr)_minmax(140px,0.8fr)_minmax(140px,0.8fr)_auto]"
                  >
                    <label class="space-y-1.5">
                      <span class="text-xs font-bold tracking-[0.08em] text-outline">模型名</span>
                      <input
                        :value="modelName"
                        class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20"
                        type="text"
                        @change="renameModel(providerName, modelName, ($event.target as HTMLInputElement).value)"
                      />
                    </label>
                    <label class="space-y-1.5">
                      <span class="text-xs font-bold tracking-[0.08em] text-outline">Context</span>
                      <input v-model.number="modelConfig.maxContextTokens" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="number" min="1" placeholder="可选" />
                    </label>
                    <label class="space-y-1.5">
                      <span class="text-xs font-bold tracking-[0.08em] text-outline">Reasoning</span>
                      <div class="flex min-h-[42px] items-center justify-between rounded-lg bg-surface-container-low px-3 py-2.5">
                        <span class="text-xs font-medium text-on-surface-variant">{{ modelConfig.reasoning ? '已启用' : '未启用' }}</span>
                        <button class="relative h-5 w-10 rounded-full transition" :class="modelConfig.reasoning ? 'bg-primary-container' : 'bg-surface-container-high'" type="button" @click="modelConfig.reasoning = !modelConfig.reasoning">
                          <span class="absolute top-0.5 size-4 rounded-full bg-white transition" :class="modelConfig.reasoning ? 'right-0.5' : 'left-0.5'"></span>
                        </button>
                      </div>
                    </label>
                    <label class="space-y-1.5">
                      <span class="text-xs font-bold tracking-[0.08em] text-outline">Vision</span>
                      <div class="flex min-h-[42px] items-center justify-between rounded-lg bg-surface-container-low px-3 py-2.5">
                        <span class="text-xs font-medium text-on-surface-variant">{{ modelConfig.supportsVision ? '已启用' : '未启用' }}</span>
                        <button class="relative h-5 w-10 rounded-full transition" :class="modelConfig.supportsVision ? 'bg-primary-container' : 'bg-surface-container-high'" type="button" @click="modelConfig.supportsVision = !modelConfig.supportsVision">
                          <span class="absolute top-0.5 size-4 rounded-full bg-white transition" :class="modelConfig.supportsVision ? 'right-0.5' : 'left-0.5'"></span>
                        </button>
                      </div>
                    </label>
                    <button
                      class="rounded-xl border border-error/20 px-4 py-2 text-sm font-semibold text-error transition hover:bg-error-container/60 lg:self-end"
                      type="button"
                      @click="removeModel(providerName, modelName)"
                    >
                      删除模型
                    </button>
                  </div>

                  <div v-if="!Object.keys(provider.models || {}).length" class="workspace-subtle rounded-xl px-4 py-4 text-sm text-on-surface-variant">
                    当前 Provider 还没有模型。添加模型后，这里的 `provider/model` 会出现在上方引用输入的候选列表中。
                  </div>
                </div>
              </div>
            </article>

            <div v-if="!providerEntries.length" class="workspace-subtle rounded-2xl px-4 py-5 text-sm text-on-surface-variant">
              当前没有 Provider。先创建 Provider 和模型，再回到上方选择主 Agent、视觉回退或记忆模型。
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
import KeyValueEditor from '@/components/config/KeyValueEditor.vue';
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
const providerExtraBodyDrafts = ref<Record<string, string>>({});
const providerJsonErrors = ref<Record<string, { extraBody?: string }>>({});

const providerEntries = computed(() => Object.entries(configDraft.value?.providers || {}) as Array<[string, ProviderConfig]>);
const modelRefOptions = computed(() => {
  const refs: string[] = [];
  for (const [providerName, provider] of Object.entries(configDraft.value?.providers || {})) {
    for (const modelName of Object.keys(provider.models || {})) {
      refs.push(`${providerName}/${modelName}`);
    }
  }
  return refs.sort((left, right) => left.localeCompare(right));
});
const hasProviderJsonErrors = computed(() => Object.values(providerJsonErrors.value).some((item) => Boolean(item?.extraBody)));

function createEmptyProvider(): ProviderConfig {
  return {
    type: 'openai',
    apiKey: '',
    apiBase: '',
    headers: {},
    extraBody: {},
    models: {}
  };
}

function createEmptyModel(): ProviderModelConfig {
  return {
    maxContextTokens: undefined,
    reasoning: false,
    supportsVision: false
  };
}

function formatJsonObject(value: Record<string, unknown> | undefined) {
  return JSON.stringify(value || {}, null, 2);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

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

function syncProviderEditors() {
  const providers = configDraft.value?.providers || {};
  providerExtraBodyDrafts.value = {};
  providerJsonErrors.value = {};

  for (const [name, provider] of Object.entries(providers)) {
    providerExtraBodyDrafts.value[name] = formatJsonObject(provider.extraBody as Record<string, unknown> | undefined);
  }
}

function updateProviderExtraBodyDraft(name: string, value: string) {
  if (!configDraft.value?.providers?.[name]) {
    return;
  }

  providerExtraBodyDrafts.value[name] = value;
  const nextErrors = { ...(providerJsonErrors.value[name] || {}) };

  try {
    configDraft.value.providers[name].extraBody = parseJsonObject(value, 'Extra Body');
    delete nextErrors.extraBody;
  } catch (parseError) {
    nextErrors.extraBody = parseError instanceof Error ? parseError.message : 'JSON 解析失败';
  }

  providerJsonErrors.value[name] = nextErrors;
}

function rewriteModelReferences(rewriter: (ref: string) => string) {
  if (!configDraft.value) {
    return;
  }

  const roles = configDraft.value.agents?.roles || {};
  for (const role of Object.values(roles)) {
    if (!role) {
      continue;
    }
    role.model = rewriter(role.model || '');
  }

  const defaults = configDraft.value.agent?.defaults;
  if (!defaults) {
    return;
  }

  defaults.visionFallbackModel = rewriter(defaults.visionFallbackModel || '');
  defaults.memorySummary!.model = rewriter(defaults.memorySummary!.model || '');
  defaults.memoryFacts!.model = rewriter(defaults.memoryFacts!.model || '');
  defaults.memoryFacts!.retrievalModel = rewriter(defaults.memoryFacts!.retrievalModel || '');
}

function addProvider() {
  if (!configDraft.value) {
    return;
  }

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
  if (!configDraft.value?.providers) {
    return;
  }

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
  rewriteModelReferences((ref) => ref.startsWith(`${oldName}/`) ? `${nextName}/${ref.slice(oldName.length + 1)}` : ref);
  error.value = '';
  syncProviderEditors();
}

function removeProvider(name: string) {
  if (!configDraft.value?.providers?.[name]) {
    return;
  }

  delete configDraft.value.providers[name];
  rewriteModelReferences((ref) => ref.startsWith(`${name}/`) ? '' : ref);
  syncProviderEditors();
}

function addModel(providerName: string) {
  const provider = configDraft.value?.providers?.[providerName];
  if (!provider) {
    return;
  }

  provider.models ||= {};
  let index = 1;
  let name = `model${index}`;
  while (provider.models[name]) {
    index += 1;
    name = `model${index}`;
  }
  provider.models[name] = createEmptyModel();
}

function renameModel(providerName: string, oldModelName: string, nextModelNameRaw: string) {
  const provider = configDraft.value?.providers?.[providerName];
  if (!provider?.models) {
    return;
  }

  const nextModelName = nextModelNameRaw.trim();
  if (!nextModelName || nextModelName === oldModelName) {
    return;
  }
  if (provider.models[nextModelName]) {
    error.value = `模型名 "${providerName}/${nextModelName}" 已存在`;
    return;
  }

  const nextModels: Record<string, ProviderModelConfig> = {};
  for (const [modelName, modelConfig] of Object.entries(provider.models)) {
    nextModels[modelName === oldModelName ? nextModelName : modelName] = modelConfig;
  }
  provider.models = nextModels;
  rewriteModelReferences((ref) => ref === `${providerName}/${oldModelName}` ? `${providerName}/${nextModelName}` : ref);
  error.value = '';
}

function removeModel(providerName: string, modelName: string) {
  const provider = configDraft.value?.providers?.[providerName];
  if (!provider?.models?.[modelName]) {
    return;
  }

  delete provider.models[modelName];
  rewriteModelReferences((ref) => ref === `${providerName}/${modelName}` ? '' : ref);
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
    retrievalTopK: 5
  };
  next.agents ||= { roles: {} };
  next.agents.roles ||= {};
  next.agents.roles.main ||= {
    name: 'main',
    description: '',
    model: '',
    systemPrompt: '',
    allowedSkills: [],
    allowedTools: []
  };
  next.providers ||= {};
  for (const provider of Object.values(next.providers)) {
    provider.headers ||= {};
    provider.extraBody ||= {};
    provider.models ||= {};
  }
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
  if (!config.value) {
    return;
  }

  configDraft.value = normalizeConfig(config.value);
  saveMessage.value = '';
  syncProviderEditors();
}

async function saveConfig() {
  if (!configDraft.value) {
    return;
  }
  if (hasProviderJsonErrors.value) {
    error.value = 'Provider 配置存在格式错误，请先修正后再保存';
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
    query: token ? { token } : {}
  });
}

loadConfig();
</script>
