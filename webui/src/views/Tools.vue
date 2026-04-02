<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1680px]">
      <div class="flex flex-col gap-6 xl:flex-row">
        <section class="min-w-0 flex-1">
          <header class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p class="cn-kicker text-outline">工具</p>
              <h1 class="cn-page-title mt-2 text-on-surface">工具目录</h1>
            </div>
          </header>

          <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
            <p class="font-bold">工具目录加载失败</p>
            <p class="mt-2 leading-6">{{ error }}</p>
          </div>

          <div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <article class="hairline-card rounded-2xl p-5">
              <p class="cn-kicker text-outline">工具总数</p>
              <p class="cn-metric mt-2 text-on-surface">{{ tools.length }}</p>
            </article>
          </div>

          <div class="hairline-card overflow-hidden rounded-[1.6rem]">
            <table class="min-w-full border-collapse text-left text-sm">
              <thead class="bg-surface-container-low text-outline">
                <tr>
                  <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">工具名</th>
                  <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">描述</th>
                  <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">参数键</th>
                  <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em] text-right">检视</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline-variant/12">
                <tr
                  v-for="tool in tools"
                  :key="tool.name"
                  class="cursor-pointer transition hover:bg-surface-container-low/50"
                  :class="selectedName === tool.name ? 'bg-primary-fixed/35' : ''"
                  @click="selectTool(tool.name)"
                >
                  <td class="px-6 py-5">
                    <p class="tech-text text-xs font-bold text-on-surface">{{ tool.name }}</p>
                  </td>
                  <td class="px-6 py-5 text-sm text-on-surface-variant">{{ tool.description || '暂无描述' }}</td>
                  <td class="px-6 py-5 tech-text text-xs text-on-surface">{{ Object.keys(tool.parameters || {}).join(', ') || '--' }}</td>
                  <td class="px-6 py-5 text-right">
                    <span class="text-xs font-bold text-primary">查看结构</span>
                  </td>
                </tr>
                <tr v-if="!tools.length">
                  <td colspan="4" class="px-6 py-14 text-center text-sm text-on-surface-variant">当前没有可用工具定义。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <aside class="w-full shrink-0 xl:w-[380px]">
          <div class="sidebar-rail-scroll space-y-6">
            <section class="hairline-card rounded-[1.6rem] p-6">
              <h3 class="cn-section-title text-on-surface">参数结构</h3>
              <template v-if="selectedTool">
                <div class="mt-5 rounded-2xl bg-surface-container-low px-4 py-4">
                  <p class="tech-text break-anywhere text-xs text-primary">{{ selectedTool.name }}</p>
                  <p class="mt-2 text-sm leading-6 text-on-surface-variant">{{ selectedTool.description || '暂无描述' }}</p>
                </div>
                <pre class="tech-text mt-4 max-h-[28rem] overflow-auto rounded-2xl bg-slate-950 p-4 text-[11px] leading-6 text-slate-200">{{ formattedParameters }}</pre>
              </template>
              <p v-else class="mt-5 text-sm text-on-surface-variant">从左侧选择工具后，这里会显示参数结构。</p>
            </section>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue';
import { getRouteToken } from '@/lib/auth';
import { useToolsState } from '@/composables/useToolsState';
import { useRoute } from 'vue-router';

const route = useRoute();
const token = getRouteToken(route);

const {
  tools,
  selectedName,
  selectedTool,
  formattedParameters,
  error,
  selectTool
} = useToolsState(token);
</script>
