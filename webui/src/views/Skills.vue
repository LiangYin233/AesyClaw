<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1680px]">
      <div class="flex flex-col gap-6 xl:flex-row">
        <section class="min-w-0 flex-1">
          <header class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p class="cn-kicker text-outline">技能</p>
              <h1 class="cn-page-title mt-2 text-on-surface">技能目录</h1>
              <p class="cn-body mt-2 max-w-3xl text-sm text-on-surface-variant">统一查看系统内建与项目自定义技能，支持重载、启停和文件结构检查。</p>
            </div>
            <div class="flex flex-wrap gap-3">
              <button class="inline-flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-2.5 text-sm font-semibold text-on-surface shadow-sm transition hover:bg-surface-container-high" type="button" :disabled="loading || reloading" @click="reloadSkills">
                <AppIcon name="refresh" size="sm" />
                {{ reloading ? '重载中...' : '重载技能' }}
              </button>
            </div>
          </header>

          <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
            <p class="font-bold">技能数据加载失败</p>
            <p class="mt-2 leading-6">{{ error }}</p>
          </div>

          <div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article class="rounded-2xl bg-surface-container-low p-4">
              <p class="tech-text text-[10px] tracking-[0.14em] text-outline">技能总数</p>
              <p class="cn-metric mt-2 text-primary">{{ skills.length }}</p>
            </article>
            <article class="rounded-2xl bg-surface-container-low p-4">
              <p class="tech-text text-[10px] tracking-[0.14em] text-outline">系统内建</p>
              <p class="cn-metric mt-2 text-on-surface">{{ builtinCount }}</p>
            </article>
            <article class="rounded-2xl bg-surface-container-low p-4">
              <p class="tech-text text-[10px] tracking-[0.14em] text-outline">项目自定义</p>
              <p class="cn-metric mt-2 text-on-surface">{{ externalCount }}</p>
            </article>
            <article class="rounded-2xl bg-surface-container-low p-4">
              <p class="tech-text text-[10px] tracking-[0.14em] text-outline">已启用</p>
              <p class="cn-metric mt-2 text-tertiary">{{ enabledCount }}</p>
            </article>
          </div>

          <div class="hairline-card overflow-hidden rounded-[1.6rem]">
            <div class="hidden overflow-x-auto lg:block">
              <table class="min-w-full border-collapse text-left text-sm">
                <thead class="bg-surface-container-low text-outline">
                  <tr>
                    <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">状态 / 类型</th>
                    <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">技能包</th>
                    <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">源路径</th>
                    <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em]">来源</th>
                    <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em] text-right">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline-variant/12">
                  <tr
                    v-for="skill in skills"
                    :key="skill.name"
                    class="cursor-pointer transition hover:bg-surface-container-low/50"
                    :class="selectedName === skill.name ? 'border-l-4 border-l-primary bg-primary-fixed/35' : ''"
                    @click="selectSkill(skill.name)"
                  >
                    <td class="px-6 py-5">
                      <div class="flex items-center gap-3">
                        <span class="inline-block size-2 rounded-full" :class="skill.enabled ? 'bg-primary shadow-[0_0_10px_rgba(0,74,198,0.35)]' : 'bg-outline-variant'"></span>
                        <span class="rounded px-2 py-0.5 text-[10px] font-bold tracking-[0.08em]" :class="skill.builtin ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-high text-on-surface-variant'">
                          {{ skill.builtin ? '系统' : '项目' }}
                        </span>
                      </div>
                    </td>
                    <td class="px-6 py-5">
                      <div class="flex flex-col">
                        <span class="text-sm font-bold" :class="selectedName === skill.name ? 'text-primary' : 'text-on-surface'">{{ skill.name }}</span>
                        <span class="mt-1 text-xs text-on-surface-variant">{{ skill.description || '暂无描述' }}</span>
                      </div>
                    </td>
                    <td class="px-6 py-5 tech-text text-[11px] text-outline">{{ skill.path }}</td>
                    <td class="px-6 py-5 text-xs text-on-surface-variant">{{ skill.source === 'builtin' ? '内建目录' : '工作区目录' }}</td>
                    <td class="px-6 py-5 text-right">
                      <button
                        v-if="skill.configurable"
                        class="rounded-lg border border-outline-variant/25 px-3 py-2 text-xs font-semibold text-on-surface transition hover:bg-surface-container-low"
                        type="button"
                        @click.stop="toggleSkill(skill)"
                      >
                        {{ skill.enabled ? '停用' : '启用' }}
                      </button>
                      <span v-else class="text-xs font-semibold text-outline">系统内建</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="space-y-3 p-4 lg:hidden">
              <article
                v-for="skill in skills"
                :key="skill.name"
                class="rounded-2xl border border-outline-variant/18 bg-surface-container-lowest p-4"
                :class="selectedName === skill.name ? 'border-primary/30 bg-primary-fixed/30' : ''"
              >
                <button class="w-full text-left" type="button" @click="selectSkill(skill.name)">
                  <div class="flex items-center gap-2">
                    <span class="inline-block size-2 rounded-full" :class="skill.enabled ? 'bg-primary' : 'bg-outline-variant'"></span>
                    <span class="rounded px-2 py-0.5 text-[10px] font-bold" :class="skill.builtin ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-high text-on-surface-variant'">
                      {{ skill.builtin ? '系统' : '项目' }}
                    </span>
                  </div>
                  <p class="mt-3 text-sm font-bold text-on-surface">{{ skill.name }}</p>
                  <p class="mt-2 text-sm text-on-surface-variant">{{ skill.description || '暂无描述' }}</p>
                  <p class="tech-text mt-3 text-[11px] text-outline">{{ skill.path }}</p>
                </button>
                <button v-if="skill.configurable" class="mt-4 w-full rounded-xl border border-outline-variant/25 px-3 py-2 text-sm font-semibold text-on-surface" type="button" @click="toggleSkill(skill)">
                  {{ skill.enabled ? '停用' : '启用' }}
                </button>
              </article>
            </div>
          </div>
        </section>

        <aside class="w-full shrink-0 xl:w-[380px]">
          <div class="sidebar-rail-scroll space-y-6">
            <section class="hairline-card overflow-hidden rounded-[1.6rem]">
              <div class="flex items-center justify-between bg-surface-container-low px-4 py-3">
                <span class="tech-text text-[10px] tracking-[0.16em] text-outline">SKILL.md 概览</span>
                <button v-if="selectedSkill?.configurable" class="text-[11px] font-bold tracking-[0.08em] text-primary" type="button" @click="toggleSkill(selectedSkill)">
                  {{ selectedSkill.enabled ? '停用' : '启用' }}
                </button>
              </div>
              <div class="p-6">
                <template v-if="detailLoading">
                  <p class="text-sm text-on-surface-variant">正在读取技能详情...</p>
                </template>
                <template v-else-if="selectedSkill">
                  <h3 class="text-xl font-bold text-on-surface">{{ selectedSkill.name }}</h3>
                  <p class="break-anywhere mt-4 text-sm leading-7 text-on-surface-variant">
                    {{ selectedSkill.content || selectedSkill.description || '当前技能没有附带更多文档内容。' }}
                  </p>
                  <div class="mt-5 grid grid-cols-2 gap-3 text-xs">
                    <div class="rounded-xl bg-surface-container-low px-4 py-3">
                      <p class="text-outline">来源</p>
                      <p class="mt-1 font-bold text-on-surface">{{ selectedSkill.source === 'builtin' ? '系统内建' : '项目自定义' }}</p>
                    </div>
                    <div class="rounded-xl bg-surface-container-low px-4 py-3">
                      <p class="text-outline">文件数</p>
                      <p class="mt-1 font-bold text-on-surface">{{ selectedSkill.files?.length || 0 }}</p>
                    </div>
                  </div>
                </template>
                <p v-else class="text-sm text-on-surface-variant">从左侧选择一个技能后，这里会显示文档摘要。</p>
              </div>
            </section>

            <section class="hairline-card overflow-hidden rounded-[1.6rem]">
              <div class="flex items-center gap-2 bg-surface-container-low px-4 py-3">
                <AppIcon name="sessions" size="sm" class="text-outline" />
                <span class="tech-text text-[10px] tracking-[0.16em] text-outline">文件树</span>
              </div>
              <div class="max-h-[24rem] space-y-2 overflow-y-auto p-4">
                <template v-if="selectedSkill?.files?.length">
                  <div v-for="file in selectedSkill.files" :key="file.path" class="rounded-lg bg-surface-container-lowest px-3 py-2.5">
                    <p class="tech-text text-[11px] text-on-surface">{{ file.name }}</p>
                    <p class="tech-text break-anywhere mt-1 text-[10px] text-outline">{{ file.path }}</p>
                  </div>
                </template>
                <p v-else class="text-sm text-on-surface-variant">当前技能没有可列出的额外文件。</p>
              </div>
            </section>

          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import { apiGet, apiPost } from '@/lib/api';
import { getRouteToken } from '@/lib/auth';
import type { SkillInfo } from '@/lib/types';
import { useRoute } from 'vue-router';

const route = useRoute();
const token = getRouteToken(route);

const skills = ref<SkillInfo[]>([]);
const selectedName = ref('');
const selectedSkill = ref<SkillInfo | null>(null);
const loading = ref(false);
const detailLoading = ref(false);
const reloading = ref(false);
const error = ref('');

const builtinCount = computed(() => skills.value.filter((skill) => skill.builtin).length);
const externalCount = computed(() => skills.value.filter((skill) => !skill.builtin).length);
const enabledCount = computed(() => skills.value.filter((skill) => skill.enabled).length);

async function loadSkills() {
  loading.value = true;
  error.value = '';

  const result = await apiGet<{ skills: SkillInfo[] }>('/api/skills', token);
  loading.value = false;

  if (result.error || !result.data) {
    error.value = result.error || '技能加载失败';
    skills.value = [];
    return;
  }

  skills.value = result.data.skills;
  if (!skills.value.some((skill) => skill.name === selectedName.value)) {
    selectedName.value = skills.value[0]?.name || '';
  }
  await loadSkillDetail(selectedName.value);
}

async function loadSkillDetail(name: string) {
  if (!name) {
    selectedSkill.value = null;
    return;
  }

  detailLoading.value = true;
  const result = await apiGet<{ skill: SkillInfo }>(`/api/skills/${encodeURIComponent(name)}`, token);
  detailLoading.value = false;

  if (result.error || !result.data) {
    error.value = result.error || '技能详情加载失败';
    return;
  }

  selectedSkill.value = result.data.skill;
}

async function selectSkill(name: string) {
  selectedName.value = name;
  await loadSkillDetail(name);
}

async function reloadSkills() {
  reloading.value = true;
  const result = await apiPost<{ success: true }>('/api/skills/reload', token);
  reloading.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  await loadSkills();
}

async function toggleSkill(skill: SkillInfo) {
  if (!skill.configurable) {
    return;
  }

  const result = await apiPost<{ success: true }>(`/api/skills/${encodeURIComponent(skill.name)}/toggle`, token, {
    enabled: !skill.enabled,
  });

  if (result.error) {
    error.value = result.error;
    return;
  }

  await loadSkills();
}

onMounted(loadSkills);
</script>
