<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1600px]">
      <header class="mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">Agent</p>
          <h1 class="cn-page-title mt-2 text-on-surface">Agent 编排中心</h1>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <router-link
            :to="{ path: '/agents/runtime', query: token ? { token } : {} }"
            class="inline-flex items-center gap-2 rounded-xl border border-outline-variant/14 bg-surface-container-lowest px-5 py-2.5 text-sm font-bold text-on-surface shadow-sm transition hover:bg-surface-container-low"
          >
            <AppIcon name="deployed" size="sm" />
            查看执行链
          </router-link>
          <button class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-primary-container px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/10 transition hover:scale-[1.01]" type="button" @click="openCreateDrawer">
            <AppIcon name="plus" size="sm" />
            新建 Agent
          </button>
        </div>
      </header>

      <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/50 px-5 py-4 text-sm text-on-error-container">
        <div class="flex items-start gap-3">
          <AppIcon name="warning" />
          <div>
            <p class="font-bold">Agent 数据加载失败</p>
            <p class="mt-1 leading-6">{{ error }}</p>
          </div>
        </div>
      </div>

      <div class="mb-10 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <div class="flex h-32 flex-col justify-between rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm">
          <div class="flex items-start justify-between">
            <span class="cn-kicker text-outline">角色总数</span>
            <AppIcon name="agents" class="text-primary" />
          </div>
          <div class="cn-metric text-on-surface">{{ agents.length }}</div>
        </div>
        <div class="flex h-32 flex-col justify-between rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm">
          <div class="flex items-start justify-between">
            <span class="cn-kicker text-outline">视觉已启用</span>
            <AppIcon name="eye" class="text-tertiary" />
          </div>
          <div class="cn-metric text-on-surface">{{ visionEnabled }}</div>
        </div>
        <div class="flex h-32 flex-col justify-between rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm">
          <div class="flex items-start justify-between">
            <span class="cn-kicker text-outline">工具引用总量</span>
            <AppIcon name="tools" class="text-sky-600" />
          </div>
          <div class="cn-metric text-on-surface">{{ totalLinkedTools }}</div>
        </div>
        <div class="flex h-32 flex-col justify-between rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5 shadow-sm">
          <div class="flex items-start justify-between">
            <span class="cn-kicker text-outline">缺失资源角色</span>
            <AppIcon name="warning" class="text-error" />
          </div>
          <div class="cn-metric text-on-surface">{{ missingResourcesCount }}</div>
        </div>
      </div>

      <div class="relative flex flex-col gap-8 2xl:flex-row">
        <div class="grid w-full min-w-0 flex-1 self-start grid-cols-1 gap-6 pb-20 xl:grid-cols-2">
          <div v-if="mainAgent" class="col-span-1 flex flex-col gap-6 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary-fixed to-surface-container-lowest p-6 shadow-sm xl:col-span-2 md:flex-row">
            <div class="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-xl shadow-primary/20">
              <AppIcon name="robot" size="xl" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div class="min-w-0">
                  <h3 class="flex flex-wrap items-center gap-2 font-headline text-xl font-bold tracking-tight text-on-surface">
                    {{ mainAgent.name }}
                    <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.06em] text-primary">系统主角色</span>
                  </h3>
                  <p class="mt-2 text-sm font-medium text-on-surface-variant">{{ mainAgent.description || '负责全局调度、上下文管理与子角色路由。' }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="font-mono text-[10px] text-outline">模型：{{ mainAgent.model || '-' }}</span>
                  <button class="rounded-lg border border-primary/15 bg-white px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary hover:text-white" type="button" @click="selectAgent(mainAgent)">
                    编辑主角色
                  </button>
                </div>
              </div>
              <div class="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <div class="rounded-xl border border-white/80 bg-white/60 p-3">
                  <span class="block text-[10px] tracking-[0.08em] text-outline">视觉</span>
                  <span class="mt-1 block text-xs font-bold text-on-surface">{{ mainAgent.vision ? '已启用' : '未启用' }}</span>
                </div>
                <div class="rounded-xl border border-white/80 bg-white/60 p-3">
                  <span class="block text-[10px] tracking-[0.08em] text-outline">技能数</span>
                  <span class="mt-1 block text-xs font-bold text-on-surface">{{ mainAgent.availableSkills.length }}</span>
                </div>
                <div class="rounded-xl border border-white/80 bg-white/60 p-3">
                  <span class="block text-[10px] tracking-[0.08em] text-outline">工具数</span>
                  <span class="mt-1 block text-xs font-bold text-on-surface">{{ mainAgent.availableTools.length }}</span>
                </div>
                <div class="rounded-xl border border-white/80 bg-white/60 p-3">
                  <span class="block text-[10px] tracking-[0.08em] text-outline">推理模式</span>
                  <span class="mt-1 block text-xs font-bold text-on-surface">{{ mainAgent.reasoning ? '开启' : '关闭' }}</span>
                </div>
              </div>
            </div>
          </div>

          <button
            v-for="agent in secondaryAgents"
            :key="agent.name"
            class="group rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6 text-left transition-all hover:border-slate-300 hover:shadow-xl hover:shadow-slate-200/50"
            type="button"
            @click="selectAgent(agent)"
          >
            <div class="mb-4 flex items-start justify-between gap-4">
              <div class="flex gap-4">
                <div class="flex size-12 items-center justify-center rounded-xl" :class="agentVisualTone(agent).iconBg">
                  <AppIcon :name="agentVisualTone(agent).icon" :class="agentVisualTone(agent).iconText" />
                </div>
                <div class="min-w-0">
                  <h4 class="font-headline font-bold text-on-surface">{{ agent.name }}</h4>
                  <span class="mt-1 block font-mono text-[10px] text-outline">{{ agent.model }}</span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <div class="size-2 rounded-full" :class="agentStatusDot(agent)"></div>
                <span class="text-[11px] font-semibold tracking-[0.08em] text-outline">{{ agentStatusLabel(agent) }}</span>
              </div>
            </div>

            <p class="mb-5 line-clamp-2 min-h-10 text-xs leading-5 text-on-surface-variant">{{ agent.description || '暂无描述' }}</p>

            <div class="mb-5 flex h-6 flex-wrap gap-2 overflow-hidden">
              <span v-for="skill in agent.allowedSkills.slice(0, 4)" :key="skill" class="rounded-md bg-surface-container-low px-2 py-1 text-[10px] font-bold text-on-surface-variant">{{ skill }}</span>
              <span v-if="agent.allowedSkills.length === 0" class="rounded-md bg-surface-container-low px-2 py-1 text-[10px] font-bold text-outline">未绑定技能</span>
            </div>

            <div v-if="agent.missingSkills.length || agent.missingTools.length" class="mb-4 rounded-xl border border-error/15 bg-error-container/25 px-3 py-3 text-[11px] leading-5 text-on-error-container">
              缺失资源：
              <span v-if="agent.missingSkills.length">技能 {{ agent.missingSkills.join('、') }}</span>
              <span v-if="agent.missingSkills.length && agent.missingTools.length">；</span>
              <span v-if="agent.missingTools.length">工具 {{ agent.missingTools.join('、') }}</span>
            </div>

            <div class="flex items-center justify-between border-t border-outline-variant/10 pt-4">
              <span class="font-mono text-[10px] text-outline">{{ agent.vision ? '视觉开启' : '纯文本模式' }}</span>
              <span class="text-xs font-bold text-primary group-hover:underline">编辑边界</span>
            </div>
          </button>
        </div>

        <aside v-if="selectedAgent || drawerMode === 'create'" class="hidden w-[460px] shrink-0 rounded-[1.4rem] border border-outline-variant/20 bg-surface-container-lowest shadow-xl shadow-slate-200/40 2xl:block 2xl:sticky 2xl:top-8 2xl:self-start">
          <AgentEditor
            :form="form"
            :saving="saving"
            :drawer-mode="drawerMode"
            :selected-agent="selectedAgent"
            :provider-options="providerOptions"
            :skills="skills"
            :tools="tools"
            @update:form="applyForm"
            @close="resetSelection"
            @save="saveAgent"
            @delete="deleteAgent"
          />
        </aside>
      </div>

      <div v-if="selectedAgent || drawerMode === 'create'" class="fixed inset-0 z-50 2xl:hidden">
        <div class="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" @click="resetSelection"></div>
        <div class="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-surface-container-lowest shadow-2xl">
          <AgentEditor
            :form="form"
            :saving="saving"
            :drawer-mode="drawerMode"
            :selected-agent="selectedAgent"
            :provider-options="providerOptions"
            :skills="skills"
            :tools="tools"
            @update:form="applyForm"
            @close="resetSelection"
            @save="saveAgent"
            @delete="deleteAgent"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import AgentEditor from '@/components/AgentEditor.vue';
import AppIcon from '@/components/AppIcon.vue';
import { getRouteToken } from '@/lib/auth';
import { useAgentsState } from '@/composables/useAgentsState';

const route = useRoute();
const token = getRouteToken(route);

const {
  agents,
  skills,
  tools,
  error,
  saving,
  drawerMode,
  selectedAgent,
  form,
  mainAgent,
  secondaryAgents,
  visionEnabled,
  totalLinkedTools,
  missingResourcesCount,
  providerOptions,
  applyForm,
  openCreateDrawer,
  selectAgent,
  resetSelection,
  saveAgent,
  deleteAgent,
  agentStatusLabel,
  agentStatusDot,
  agentVisualTone
} = useAgentsState(token);
</script>
