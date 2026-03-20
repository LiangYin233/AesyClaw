<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1680px]">
      <header class="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p class="cn-kicker text-outline">插件</p>
          <h1 class="cn-page-title mt-2 text-on-surface">插件中心</h1>
          <p class="cn-body mt-2 max-w-3xl text-sm text-on-surface-variant">沿用 Stitch 的“市场卡片 + 右侧 Inspector”结构，集中管理插件启停与配置差异。</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button class="inline-flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-2.5 text-sm font-semibold text-on-surface shadow-sm transition hover:bg-surface-container-high" type="button" :disabled="loading" @click="loadPlugins">
            <AppIcon name="refresh" size="sm" />
            刷新
          </button>
        </div>
      </header>

      <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
        <p class="font-bold">插件数据加载失败</p>
        <p class="mt-2 leading-6">{{ error }}</p>
      </div>

      <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article class="hairline-card rounded-2xl p-5">
          <p class="cn-kicker text-outline">插件总数</p>
          <p class="cn-metric mt-2 text-on-surface">{{ plugins.length }}</p>
        </article>
        <article class="hairline-card rounded-2xl p-5">
          <p class="cn-kicker text-outline">已启用</p>
          <p class="cn-metric mt-2 text-emerald-600">{{ enabledCount }}</p>
        </article>
        <article class="hairline-card rounded-2xl p-5">
          <p class="cn-kicker text-outline">异常候选</p>
          <p class="cn-metric mt-2 text-error">{{ disabledCount }}</p>
        </article>
        <article class="hairline-card rounded-2xl p-5">
          <p class="cn-kicker text-outline">挂载工具</p>
          <p class="cn-metric mt-2 text-primary">{{ totalTools }}</p>
        </article>
      </div>

      <div class="flex flex-col gap-6 xl:flex-row">
        <section class="min-w-0 flex-1 space-y-4">
          <div class="flex items-center justify-between px-2">
            <h2 class="cn-section-title text-on-surface">活跃市场</h2>
            <span class="tech-text text-xs text-on-surface-variant">{{ plugins.length }} 个插件</span>
          </div>

          <article
            v-for="plugin in plugins"
            :key="plugin.name"
            class="rounded-[1.6rem] p-1 transition-all"
            :class="selectedName === plugin.name ? 'bg-primary-fixed/25 ring-1 ring-primary/15' : 'bg-surface-container-lowest ring-1 ring-outline-variant/10 hover:shadow-md'"
          >
            <div class="flex flex-col gap-5 rounded-[1.4rem] p-5 md:flex-row md:items-start md:gap-6">
              <button class="flex min-w-0 flex-1 items-start gap-5 text-left" type="button" @click="selectedName = plugin.name">
                <div class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-fixed text-primary">
                  <AppIcon name="plugins" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-3">
                    <h3 class="truncate text-lg font-bold text-on-surface">{{ plugin.name }}</h3>
                    <span class="rounded bg-surface-container-low px-2 py-0.5 text-[10px] font-bold text-outline">{{ plugin.version }}</span>
                    <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="plugin.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-error-container text-on-error-container'">
                      {{ plugin.enabled ? '已启用' : '已停用' }}
                    </span>
                  </div>
                  <p class="mt-2 text-sm leading-6 text-on-surface-variant">{{ plugin.description || '当前插件没有提供描述信息。' }}</p>
                  <div class="mt-4 flex flex-wrap gap-6">
                    <div>
                      <p class="text-[10px] font-bold tracking-[0.08em] text-outline">工具数</p>
                      <p class="tech-text mt-1 text-xs text-on-surface">{{ plugin.toolsCount }}</p>
                    </div>
                    <div>
                      <p class="text-[10px] font-bold tracking-[0.08em] text-outline">作者</p>
                      <p class="mt-1 text-xs text-on-surface">{{ plugin.author || '未知' }}</p>
                    </div>
                    <div>
                      <p class="text-[10px] font-bold tracking-[0.08em] text-outline">配置键</p>
                      <p class="tech-text mt-1 text-xs text-on-surface">{{ Object.keys(plugin.options || {}).length }}</p>
                    </div>
                  </div>
                </div>
              </button>

              <div class="flex gap-2 self-start">
                <button class="rounded-xl border border-outline-variant/20 px-3 py-2 text-xs font-semibold text-on-surface transition hover:bg-surface-container-high" type="button" @click="selectedName = plugin.name">
                  检视
                </button>
                <button class="rounded-xl border px-3 py-2 text-xs font-semibold transition" :class="plugin.enabled ? 'border-error/20 text-error hover:bg-error-container/60' : 'border-primary/20 text-primary hover:bg-primary-fixed/50'" type="button" @click="togglePlugin(plugin)">
                  {{ plugin.enabled ? '停用' : '启用' }}
                </button>
              </div>
            </div>
          </article>
        </section>

        <aside class="w-full shrink-0 xl:w-[400px]">
          <div class="space-y-6 xl:sticky xl:top-8">
            <section class="rounded-[1.6rem] bg-surface-container-low p-6">
              <div class="mb-6 flex items-center justify-between">
                <h3 class="cn-section-title text-on-surface">Inspector</h3>
                <AppIcon name="overview" size="sm" class="text-outline" />
              </div>

              <template v-if="selectedPlugin">
                <div class="rounded-2xl border border-primary/10 bg-primary-fixed/30 p-4">
                  <div class="flex items-center gap-2 text-primary">
                    <AppIcon name="warning" size="sm" />
                    <span class="text-xs font-bold tracking-[0.08em]">影响范围</span>
                  </div>
                  <p class="mt-3 text-sm leading-6 text-on-surface-variant">
                    该插件当前接入 <span class="font-bold text-primary">{{ selectedPlugin.toolsCount }}</span> 个工具，并可通过配置项参与消息链路与扩展动作。
                  </p>
                  <div class="mt-4 h-1.5 overflow-hidden rounded-full bg-outline-variant/20">
                    <div class="h-full rounded-full bg-primary" :style="{ width: `${impactWidth(selectedPlugin)}%` }"></div>
                  </div>
                </div>

                <div class="mt-6 space-y-4">
                  <div>
                    <p class="text-[10px] font-bold tracking-[0.12em] text-outline">能力摘要</p>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <span class="rounded-lg bg-surface-container-lowest px-3 py-1.5 text-[11px] font-semibold text-on-surface">{{ selectedPlugin.enabled ? '运行中' : '已停用' }}</span>
                      <span class="rounded-lg bg-surface-container-lowest px-3 py-1.5 text-[11px] font-semibold text-on-surface">{{ selectedPlugin.version }}</span>
                      <span class="rounded-lg bg-surface-container-lowest px-3 py-1.5 text-[11px] font-semibold text-on-surface">{{ selectedPlugin.toolsCount }} 个工具</span>
                    </div>
                  </div>

                  <div>
                    <div class="mb-3 flex items-center justify-between">
                      <p class="text-[10px] font-bold tracking-[0.12em] text-outline">配置 JSON</p>
                      <button class="text-[11px] font-bold tracking-[0.08em] text-primary" type="button" :disabled="saving" @click="savePluginConfig">
                        {{ saving ? '保存中...' : '保存配置' }}
                      </button>
                    </div>
                    <textarea
                      v-model="optionsDraft"
                      class="tech-text min-h-[14rem] w-full rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 text-xs text-on-surface outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
                      spellcheck="false"
                    ></textarea>
                    <p v-if="jsonError" class="mt-2 text-xs text-error">{{ jsonError }}</p>
                  </div>

                  <div class="rounded-2xl bg-slate-950 p-4 text-slate-100">
                    <p class="cn-kicker text-slate-500">配置快照</p>
                    <div class="mt-3 space-y-2">
                      <p class="tech-text text-[11px] text-slate-300">author = {{ selectedPlugin.author || 'unknown' }}</p>
                      <p class="tech-text text-[11px] text-slate-300">enabled = {{ String(selectedPlugin.enabled) }}</p>
                      <p class="tech-text text-[11px] text-slate-300">options_keys = {{ Object.keys(selectedPlugin.options || {}).length }}</p>
                    </div>
                  </div>
                </div>
              </template>

              <p v-else class="text-sm text-on-surface-variant">从左侧选择一个插件后，这里会显示配置与运行检视面板。</p>
            </section>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { getRouteToken } from '@/lib/auth';
import type { PluginInfo } from '@/lib/types';
import { useRoute } from 'vue-router';

const route = useRoute();
const token = getRouteToken(route);

const plugins = ref<PluginInfo[]>([]);
const selectedName = ref('');
const optionsDraft = ref('{}');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const jsonError = ref('');

const selectedPlugin = computed(() => plugins.value.find((plugin) => plugin.name === selectedName.value) || plugins.value[0] || null);
const enabledCount = computed(() => plugins.value.filter((plugin) => plugin.enabled).length);
const disabledCount = computed(() => plugins.value.filter((plugin) => !plugin.enabled).length);
const totalTools = computed(() => plugins.value.reduce((sum, plugin) => sum + plugin.toolsCount, 0));

function syncDraft(plugin: PluginInfo | null) {
  optionsDraft.value = JSON.stringify(plugin?.options || {}, null, 2);
  jsonError.value = '';
}

function impactWidth(plugin: PluginInfo) {
  return Math.min(95, 24 + plugin.toolsCount * 8 + Object.keys(plugin.options || {}).length * 4);
}

async function loadPlugins() {
  loading.value = true;
  error.value = '';

  const result = await apiGet<{ plugins: PluginInfo[] }>('/api/plugins', token);
  loading.value = false;

  if (result.error || !result.data) {
    error.value = result.error || '插件加载失败';
    plugins.value = [];
    return;
  }

  plugins.value = result.data.plugins;
  if (!plugins.value.some((plugin) => plugin.name === selectedName.value)) {
    selectedName.value = plugins.value[0]?.name || '';
  }
}

async function togglePlugin(plugin: PluginInfo) {
  const result = await apiPost<{ success: true }>(`/api/plugins/${encodeURIComponent(plugin.name)}/toggle`, token, {
    enabled: !plugin.enabled,
  });

  if (result.error) {
    error.value = result.error;
    return;
  }

  await loadPlugins();
}

async function savePluginConfig() {
  if (!selectedPlugin.value) {
    return;
  }

  try {
    jsonError.value = '';
    const options = JSON.parse(optionsDraft.value) as Record<string, unknown>;
    saving.value = true;
    const result = await apiPut<{ success: true }>(`/api/plugins/${encodeURIComponent(selectedPlugin.value.name)}/config`, token, {
      options,
    });
    saving.value = false;

    if (result.error) {
      error.value = result.error;
      return;
    }

    await loadPlugins();
  } catch (parseError) {
    jsonError.value = parseError instanceof Error ? parseError.message : 'JSON 解析失败';
  }
}

watch(selectedPlugin, (plugin) => {
  syncDraft(plugin);
}, { immediate: true });

onMounted(loadPlugins);
</script>
