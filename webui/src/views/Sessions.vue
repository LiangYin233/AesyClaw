<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1680px]">
      <header class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">会话</p>
          <h1 class="cn-page-title mt-2 text-on-surface">会话总台</h1>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-error/18 bg-error-container/70 px-4 py-2.5 text-sm font-semibold text-on-error-container transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            :disabled="!selectedKeys.length || deleting"
            @click="deleteSelectedSessions"
          >
            <AppIcon name="delete" size="sm" />
            删除已选 {{ selectedKeys.length ? `(${selectedKeys.length})` : '' }}
          </button>
        </div>
      </header>

      <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
        <div class="flex items-start gap-3">
          <AppIcon name="warning" />
          <div>
            <p class="font-bold">会话数据加载失败</p>
            <p class="mt-1 leading-6">{{ error }}</p>
          </div>
        </div>
      </div>

      <section class="workspace-shell mb-6 rounded-[1.75rem] px-6 py-5">
        <div class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <div class="workspace-kpi">
            <span class="workspace-kpi-label">会话总数</span>
            <span class="workspace-kpi-value">{{ sessions.length }}</span>
            <span class="workspace-kpi-note">已选 {{ selectedKeys.length }} 个会话</span>
          </div>
          <div class="workspace-kpi">
            <span class="workspace-kpi-label">WebUI 来源</span>
            <span class="workspace-kpi-value">{{ webuiSessionCount }}</span>
            <span class="workspace-kpi-note">来自 `/dialogue` 的会话上下文</span>
          </div>
          <div class="workspace-kpi">
            <span class="workspace-kpi-label">消息总量</span>
            <span class="workspace-kpi-value">{{ totalMessages }}</span>
            <span class="workspace-kpi-note">平均 {{ averageMessageCount }} 条 / 会话</span>
          </div>
          <div class="workspace-kpi">
            <span class="workspace-kpi-label">活跃 Agent</span>
            <span class="workspace-kpi-value">{{ activeAgentCount }}</span>
            <span class="workspace-kpi-note">当前列表涉及的路由角色</span>
          </div>
        </div>
      </section>

      <div class="flex flex-col gap-6 2xl:flex-row">
        <section class="min-w-0 flex-1">
          <div class="workspace-shell overflow-hidden rounded-[1.75rem]">
            <div class="flex flex-col gap-3 border-b workspace-divider px-6 py-5 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 class="cn-section-title text-on-surface">会话列表</h2>
                <p class="mt-1 text-sm text-on-surface-variant">点击任意会话可查看完整消息流、当前路由角色或继续对话。</p>
              </div>
              <p class="tech-text text-xs text-on-surface-variant">已选 {{ selectedKeys.length }} / {{ sessions.length }}</p>
            </div>

            <div v-if="loading" class="px-6 py-12 text-center text-sm text-on-surface-variant">正在加载会话数据...</div>

            <template v-else-if="sortedSessions.length">
              <div class="hidden overflow-x-auto lg:block">
                <table class="min-w-full border-collapse text-left text-sm">
                  <thead class="text-outline">
                    <tr>
                      <th class="w-12 px-6 py-4">
                        <input
                          :checked="allSelected"
                          class="size-4 rounded border border-outline-variant/50 bg-transparent"
                          type="checkbox"
                          @change="handleToggleAll"
                        />
                      </th>
                      <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">会话标识</th>
                      <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">Agent</th>
                      <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">消息数</th>
                      <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="session in sortedSessions"
                      :key="session.key"
                      class="cursor-pointer border-t border-outline-variant/12 transition-colors hover:bg-surface-container-low/28"
                      :class="detail?.key === session.key ? 'bg-primary-fixed/35' : ''"
                      @click="openSession(session.key)"
                    >
                      <td class="px-6 py-4" @click.stop>
                        <input
                          :checked="selectedSet.has(session.key)"
                          class="size-4 rounded border border-outline-variant/50 bg-transparent"
                          type="checkbox"
                          @change="handleToggleSelection(session.key, $event)"
                        />
                      </td>
                      <td class="px-6 py-4">
                        <div class="tech-text break-all text-xs text-on-surface">{{ session.key }}</div>
                        <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-outline">
                          <span class="rounded-full bg-surface-container-low px-2 py-1">{{ session.channel || '-' }}</span>
                          <span v-if="session.uuid" class="tech-text rounded-full bg-surface-container-low px-2 py-1">{{ session.uuid }}</span>
                        </div>
                      </td>
                      <td class="px-6 py-4">
                        <span class="rounded-full bg-surface-container-low px-2.5 py-1 text-xs font-semibold text-on-surface">{{ session.agentName || 'main' }}</span>
                      </td>
                      <td class="px-6 py-4">
                        <div class="cn-section-title text-base text-on-surface">{{ session.messageCount }}</div>
                        <div class="text-xs text-on-surface-variant">已记录消息</div>
                      </td>
                      <td class="px-6 py-4">
                        <div class="flex flex-wrap gap-2">
                          <button class="rounded-lg border border-outline-variant/25 px-3 py-2 text-xs font-semibold text-on-surface transition hover:bg-surface-container-low" type="button" @click.stop="goToDialogue(session.key)">
                            继续对话
                          </button>
                          <button class="rounded-lg border border-error/20 px-3 py-2 text-xs font-semibold text-error transition hover:bg-error-container/60" type="button" @click.stop="deleteSingleSession(session.key)">
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="space-y-3 p-4 lg:hidden">
                <article
                  v-for="session in sortedSessions"
                  :key="session.key"
                  class="workspace-subtle rounded-2xl p-4 transition-colors"
                  :class="detail?.key === session.key ? 'border-primary/24 bg-primary-fixed/28' : ''"
                >
                  <div class="flex items-start gap-3">
                    <input
                      :checked="selectedSet.has(session.key)"
                      class="mt-1 size-4 rounded border border-outline-variant/50 bg-transparent"
                      type="checkbox"
                      @change="handleToggleSelection(session.key, $event)"
                    />
                    <button class="min-w-0 flex-1 text-left" type="button" @click="openSession(session.key)">
                      <p class="tech-text break-all text-xs text-on-surface">{{ session.key }}</p>
                      <div class="mt-3 flex flex-wrap gap-2 text-[11px] text-outline">
                        <span class="rounded-full bg-surface-container-low px-2 py-1">{{ session.channel || '-' }}</span>
                        <span class="rounded-full bg-primary-fixed px-2 py-1 text-on-primary-fixed">{{ session.agentName || 'main' }}</span>
                        <span class="rounded-full bg-surface-container-low px-2 py-1">{{ session.messageCount }} 条消息</span>
                      </div>
                      <p class="mt-3 text-sm text-on-surface-variant">{{ channelDescription(session.channel) }}</p>
                    </button>
                  </div>
                  <div class="mt-4 flex gap-2">
                    <button class="flex-1 rounded-xl border border-outline-variant/25 px-3 py-2 text-sm font-semibold text-on-surface" type="button" @click="goToDialogue(session.key)">继续对话</button>
                    <button class="rounded-xl border border-error/20 px-3 py-2 text-sm font-semibold text-error" type="button" @click="deleteSingleSession(session.key)">删除</button>
                  </div>
                </article>
              </div>
            </template>

            <div v-else class="px-6 py-14 text-center">
              <p class="cn-section-title text-on-surface">当前没有活跃会话</p>
              <p class="cn-body mt-2 text-sm text-on-surface-variant">你可以前往对话页新建一轮对话，或等待其他渠道发来新的会话。</p>
              <button class="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white" type="button" @click="goToDialogue()">
                <AppIcon name="rocket" size="sm" />
                打开对话页
              </button>
            </div>
          </div>
        </section>

        <aside class="hidden w-[430px] shrink-0 2xl:block">
          <div class="sidebar-rail-scroll-2xl">
            <section class="workspace-shell flex h-[calc(100vh-6rem)] min-h-[38rem] flex-col overflow-hidden rounded-[1.75rem] p-5">
              <SessionDetailPanel
                :detail="detail"
                :detail-error="detailError"
                :detail-loading="detailLoading"
                @open-dialogue="goToDialogue(detail?.key)"
                @delete-session="handleDeleteDetailSession"
              />
            </section>
          </div>
        </aside>
      </div>

      <div v-if="detailVisibleOnMobile" class="fixed inset-0 z-50 2xl:hidden">
        <div class="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" @click="closeDetail"></div>
        <div class="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-surface-container-lowest shadow-2xl">
          <section class="min-h-0 flex-1 overflow-y-auto p-5">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="cn-section-title text-on-surface">会话详情</h2>
              <button class="rounded-xl border border-outline-variant/20 p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface" type="button" @click="closeDetail">
                <AppIcon name="close" size="sm" />
              </button>
            </div>
            <SessionDetailPanel
              :detail="detail"
              :detail-error="detailError"
              :detail-loading="detailLoading"
              @open-dialogue="goToDialogue(detail?.key)"
              @delete-session="handleDeleteDetailSession"
            />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import SessionDetailPanel from '@/components/SessionDetailPanel.vue';
import { getRouteToken } from '@/lib/auth';
import { useSessionListState } from '@/composables/useSessionListState';

const route = useRoute();
const router = useRouter();
const token = getRouteToken(route);
const {
  sessions,
  loading,
  deleting,
  error,
  detail,
  detailLoading,
  detailError,
  selectedKeys,
  sortedSessions,
  selectedSet,
  allSelected,
  totalMessages,
  averageMessageCount,
  webuiSessionCount,
  activeAgentCount,
  detailVisibleOnMobile,
  openSession,
  closeDetail,
  channelDescription,
  handleToggleSelection,
  handleToggleAll,
  deleteSingleSession,
  deleteSelectedSessions,
  handleDeleteDetailSession
} = useSessionListState(token);

function goToDialogue(sessionKey?: string) {
  router.push({
    path: sessionKey ? `/dialogue/${sessionKey}` : '/dialogue',
    query: token ? { token } : {},
  });
}

</script>
