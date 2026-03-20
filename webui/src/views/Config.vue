<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1600px]">
      <header class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">设置</p>
          <h1 class="cn-page-title mt-2 text-on-surface">系统配置</h1>
          <p class="cn-body mt-2 max-w-3xl text-sm text-on-surface-variant">按 Stitch 的工作台结构组织服务参数、主 Agent、记忆策略和扩展模块，不再保留旧后台式配置页。</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
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

      <div class="grid grid-cols-1 gap-8 xl:grid-cols-12">
        <div class="space-y-8 xl:col-span-8">
          <section v-if="configDraft" class="hairline-card rounded-2xl p-8">
            <div class="mb-8 flex items-start justify-between gap-4">
              <div class="flex items-center gap-4">
                <div class="flex size-12 items-center justify-center rounded-lg bg-surface-container-low text-primary">
                  <AppIcon name="panel" />
                </div>
                <div>
                  <h3 class="cn-section-title text-on-surface">服务设置</h3>
                  <p class="mt-1 text-sm text-on-surface-variant">网关主机、端口与接口开关。</p>
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
              <label class="space-y-1.5 md:col-span-2">
                <span class="text-xs font-bold tracking-[0.08em] text-outline">访问 Token</span>
                <input v-model="configDraft.server!.token" class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none ring-0 transition focus:ring-2 focus:ring-primary/20" type="text" />
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

          <section v-if="configDraft" class="hairline-card rounded-2xl p-8">
            <div class="mb-8 flex items-start justify-between gap-4">
              <div class="flex items-center gap-4">
                <div class="flex size-12 items-center justify-center rounded-lg bg-surface-container-low text-primary">
                  <AppIcon name="agents" />
                </div>
                <div>
                  <h3 class="cn-section-title text-on-surface">主 Agent</h3>
                  <p class="mt-1 text-sm text-on-surface-variant">默认角色的模型与能力参数。</p>
                </div>
              </div>
              <span class="rounded-full bg-orange-100 px-3 py-1 text-[10px] font-bold tracking-[0.08em] text-orange-700">部分变更需重载</span>
            </div>

            <div class="space-y-6">
              <label class="space-y-1.5">
                <span class="text-xs font-bold tracking-[0.08em] text-outline">模型</span>
                <input v-model="mainRole.model" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" />
              </label>

              <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">Provider</span>
                  <input v-model="mainRole.provider" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" />
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">Vision Provider</span>
                  <input v-model="mainRole.visionProvider" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" />
                </label>
                <label class="space-y-1.5">
                  <span class="text-xs font-bold tracking-[0.08em] text-outline">Vision Model</span>
                  <input v-model="mainRole.visionModel" class="w-full rounded-lg bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20" type="text" />
                </label>
              </div>

              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="flex items-center justify-between rounded-lg bg-surface px-4 py-3">
                  <div>
                    <p class="text-sm font-medium text-on-surface">启用视觉</p>
                    <p class="mt-1 text-xs text-on-surface-variant">允许视觉模型参与当前主角色。</p>
                  </div>
                  <button class="relative h-5 w-10 rounded-full transition" :class="mainRole.vision ? 'bg-primary-container' : 'bg-surface-container-high'" type="button" @click="mainRole.vision = !mainRole.vision">
                    <span class="absolute top-0.5 size-4 rounded-full bg-white transition" :class="mainRole.vision ? 'right-0.5' : 'left-0.5'"></span>
                  </button>
                </div>
                <div class="flex items-center justify-between rounded-lg bg-surface px-4 py-3">
                  <div>
                    <p class="text-sm font-medium text-on-surface">推理模式</p>
                    <p class="mt-1 text-xs text-on-surface-variant">启用后允许更重的思考路径。</p>
                  </div>
                  <button class="relative h-5 w-10 rounded-full transition" :class="mainRole.reasoning ? 'bg-primary-container' : 'bg-surface-container-high'" type="button" @click="mainRole.reasoning = !mainRole.reasoning">
                    <span class="absolute top-0.5 size-4 rounded-full bg-white transition" :class="mainRole.reasoning ? 'right-0.5' : 'left-0.5'"></span>
                  </button>
                </div>
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
              <h3 class="cn-section-title text-on-surface">扩展能力</h3>
              <span class="text-xs font-bold tracking-[0.08em] text-primary">已载入结构总览</span>
            </div>
            <div class="divide-y divide-outline-variant/10">
              <div class="flex items-center justify-between py-4">
                <div>
                  <p class="text-sm font-bold text-on-surface">Providers</p>
                  <p class="tech-text mt-1 text-[10px] text-outline">{{ providerNames.join(' · ') || '无' }}</p>
                </div>
                <span class="text-sm font-bold text-on-surface">{{ providerNames.length }}</span>
              </div>
              <div class="flex items-center justify-between py-4">
                <div>
                  <p class="text-sm font-bold text-on-surface">Channels</p>
                  <p class="tech-text mt-1 text-[10px] text-outline">{{ channelNames.join(' · ') || '无' }}</p>
                </div>
                <span class="text-sm font-bold text-on-surface">{{ channelNames.length }}</span>
              </div>
              <div class="flex items-center justify-between py-4">
                <div>
                  <p class="text-sm font-bold text-on-surface">MCP Servers</p>
                  <p class="tech-text mt-1 text-[10px] text-outline">{{ mcpNames.join(' · ') || '无' }}</p>
                </div>
                <span class="text-sm font-bold text-on-surface">{{ mcpNames.length }}</span>
              </div>
              <div class="flex items-center justify-between py-4">
                <div>
                  <p class="text-sm font-bold text-on-surface">Plugins / Skills</p>
                  <p class="tech-text mt-1 text-[10px] text-outline">{{ pluginNames.length }} 插件 · {{ skillNames.length }} 技能</p>
                </div>
                <span class="text-sm font-bold text-on-surface">{{ pluginNames.length + skillNames.length }}</span>
              </div>
            </div>
          </section>
        </div>

        <aside class="space-y-8 xl:col-span-4">
          <section class="rounded-2xl border border-white/20 bg-surface-container-lowest/80 p-6 shadow-xl shadow-blue-900/5 backdrop-blur-xl">
            <h5 class="text-xs font-bold tracking-[0.2em] text-outline">配置健康</h5>
            <div class="mt-6 space-y-4">
              <div class="flex items-start gap-4">
                <span class="mt-1 size-2 rounded-full" :class="serverHealthTone"></span>
                <div>
                  <p class="text-sm font-bold text-on-surface">端口配置检查</p>
                  <p class="mt-1 text-xs text-on-surface-variant">当前网关监听 {{ configDraft?.server?.host || '-' }}:{{ configDraft?.server?.apiPort || '-' }}。</p>
                </div>
              </div>
              <div class="flex items-start gap-4">
                <span class="mt-1 size-2 rounded-full bg-emerald-500"></span>
                <div>
                  <p class="text-sm font-bold text-on-surface">Provider 结构</p>
                  <p class="mt-1 text-xs text-on-surface-variant">检测到 {{ providerNames.length }} 个 provider，可直接复用在 Agent 与记忆配置中。</p>
                </div>
              </div>
              <div class="flex items-start gap-4">
                <span class="mt-1 size-2 rounded-full" :class="mcpNames.length ? 'bg-orange-500' : 'bg-slate-300'"></span>
                <div>
                  <p class="text-sm font-bold text-on-surface">MCP 扩展</p>
                  <p class="mt-1 text-xs text-on-surface-variant">当前配置中有 {{ mcpNames.length }} 个 MCP 服务项，建议结合连接状态页继续检查。</p>
                </div>
              </div>
            </div>
            <div class="mt-8 border-t border-outline-variant/10 pt-6">
              <button class="w-full rounded-lg bg-surface-container-high py-2 text-xs font-bold tracking-[0.12em] text-on-surface-variant transition hover:bg-surface-container-highest" type="button" @click="loadConfig">
                重新拉取配置
              </button>
            </div>
          </section>

          <section class="rounded-2xl bg-surface-container-low p-6">
            <div class="mb-6 flex items-center justify-between">
              <h5 class="text-xs font-bold tracking-[0.2em] text-outline">当前快照</h5>
              <span class="tech-text text-[10px] text-primary">配置实时映射</span>
            </div>
            <div class="space-y-5">
              <div class="rounded-lg bg-surface-container-lowest px-4 py-3">
                <p class="tech-text text-xs text-outline">环境</p>
                <p class="mt-1 text-sm font-bold text-on-surface">WEBUI_CONFIG_SYNC</p>
              </div>
              <div class="rounded-lg bg-surface-container-lowest px-4 py-3">
                <p class="tech-text text-xs text-outline">默认主模型</p>
                <p class="mt-1 text-sm font-bold text-on-surface">{{ mainRole.model || '-' }}</p>
              </div>
              <div class="rounded-lg bg-surface-container-lowest px-4 py-3">
                <p class="tech-text text-xs text-outline">上下文模式</p>
                <p class="mt-1 text-sm font-bold text-on-surface">{{ configDraft?.agent?.defaults?.contextMode || '-' }}</p>
              </div>
              <div class="rounded-lg bg-surface-container-lowest px-4 py-3">
                <p class="tech-text text-xs text-outline">日志等级</p>
                <p class="mt-1 text-sm font-bold text-on-surface">{{ configDraft?.observability?.level || '-' }}</p>
              </div>
            </div>
          </section>
        </aside>
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
import type { AppConfig, AgentRoleConfig } from '@/lib/types';

const route = useRoute();
const router = useRouter();
const token = getRouteToken(route);

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const saveMessage = ref('');
const config = ref<AppConfig | null>(null);
const configDraft = ref<AppConfig | null>(null);

const mainRole = computed<AgentRoleConfig>(() => {
  const target = configDraft.value?.agents?.roles?.main as AgentRoleConfig | undefined;
  return target || {
    name: 'main',
    description: '',
    provider: '',
    model: '',
    systemPrompt: '',
    vision: false,
    reasoning: false,
    visionProvider: '',
    visionModel: '',
    allowedSkills: [],
    allowedTools: [],
  };
});

const providerNames = computed(() => Object.keys(configDraft.value?.providers || {}));
const channelNames = computed(() => Object.keys(configDraft.value?.channels || {}));
const mcpNames = computed(() => Object.keys(configDraft.value?.mcp || {}));
const pluginNames = computed(() => Object.keys(configDraft.value?.plugins || {}));
const skillNames = computed(() => Object.keys(configDraft.value?.skills || {}));
const serverHealthTone = computed(() => (configDraft.value?.server?.apiEnabled ? 'bg-emerald-500' : 'bg-orange-500'));

function normalizeConfig(source: AppConfig): AppConfig {
  const next = structuredClone(source || {});

  next.server ||= { host: '0.0.0.0', apiPort: 18792, apiEnabled: true, token: '' };
  next.agent ||= { defaults: {} };
  next.agent.defaults ||= {};
  next.agent.defaults.memorySummary ||= { enabled: false, provider: '', model: '', compressRounds: 5 };
  next.agent.defaults.memoryFacts ||= {
    enabled: false,
    provider: '',
    model: '',
    retrievalProvider: '',
    retrievalModel: '',
    retrievalThreshold: 0.59,
    retrievalTopK: 5,
  };
  next.agents ||= { roles: {} };
  next.agents.roles ||= {};
  next.agents.roles.main ||= {
    name: 'main',
    description: '',
    provider: '',
    model: '',
    systemPrompt: '',
    vision: false,
    reasoning: false,
    visionProvider: '',
    visionModel: '',
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
  loading.value = false;
}

function resetDraft() {
  if (!config.value) return;
  configDraft.value = normalizeConfig(config.value);
  saveMessage.value = '';
}

async function saveConfig() {
  if (!configDraft.value) return;

  saving.value = true;
  error.value = '';
  const result = await apiPut<{ success: true }>('/api/config', token, configDraft.value);
  saving.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  config.value = normalizeConfig(configDraft.value);
  saveMessage.value = '配置已写回磁盘。部分模块可能需要重载后生效。';
}

function goToLogs() {
  router.push({
    path: '/observability/logs',
    query: token ? { token } : {},
  });
}

loadConfig();
</script>
