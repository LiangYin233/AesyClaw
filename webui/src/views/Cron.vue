<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1720px]">
      <div class="flex min-h-[calc(100vh-8rem)] flex-col xl:flex-row">
        <div class="min-w-0 flex-1">
          <header class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p class="cn-kicker text-outline">定时任务</p>
              <h1 class="cn-page-title mt-2 text-on-surface">Cron 调度台</h1>
              <p class="cn-body mt-2 max-w-3xl text-sm text-on-surface-variant">统一管理自动化任务、执行计划和投递目标，便于集中查看调度状态与修改配置。</p>
            </div>
            <div class="flex flex-wrap gap-3">
              <button class="inline-flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-2.5 text-sm font-semibold text-on-surface shadow-sm transition hover:bg-surface-container-high" type="button" :disabled="loading" @click="loadJobs">
                <AppIcon name="refresh" size="sm" />
                刷新
              </button>
              <button class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-primary-container px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:opacity-90" type="button" @click="startCreate">
                <AppIcon name="plus" size="sm" />
                新建任务
              </button>
            </div>
          </header>

          <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
            <p class="font-bold">定时任务加载失败</p>
            <p class="mt-2 leading-6">{{ error }}</p>
          </div>

          <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <article class="hairline-card rounded-2xl p-5">
              <p class="tech-text text-[10px] tracking-[0.14em] text-on-surface-variant">任务总数</p>
              <div class="mt-2 flex items-end gap-2">
                <span class="cn-metric text-on-surface">{{ jobs.length }}</span>
                <span class="text-xs font-bold text-primary">当前总量</span>
              </div>
            </article>
            <article class="hairline-card rounded-2xl p-5">
              <p class="tech-text text-[10px] tracking-[0.14em] text-on-surface-variant">已启用</p>
              <div class="mt-2 flex items-end gap-2">
                <span class="cn-metric text-on-surface">{{ enabledCount }}</span>
                <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{{ enabledRate }}%</span>
              </div>
            </article>
            <article class="hairline-card rounded-2xl p-5">
              <p class="tech-text text-[10px] tracking-[0.14em] text-on-surface-variant">下次执行</p>
              <div class="mt-2 flex items-end gap-2">
                <span class="cn-metric text-on-surface">{{ nextExecutionLabel }}</span>
              </div>
            </article>
          </div>

          <div class="overflow-x-auto rounded-2xl border border-outline-variant/10 bg-surface-container-lowest">
            <div v-if="loading" class="px-6 py-14 text-center text-sm text-on-surface-variant">正在加载任务列表...</div>

            <table v-else class="min-w-full border-collapse text-left text-sm">
              <thead class="bg-surface-container-low">
                <tr>
                  <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em] text-outline">任务与目标</th>
                  <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em] text-outline">计划表达式</th>
                  <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em] text-outline">状态</th>
                  <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em] text-outline">最近执行</th>
                  <th class="px-6 py-4 text-[11px] font-bold tracking-[0.08em] text-outline">下次执行</th>
                  <th class="px-6 py-4 text-right text-[11px] font-bold tracking-[0.08em] text-outline">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline-variant/10">
                <tr
                  v-for="job in jobs"
                  :key="job.id"
                  class="cursor-pointer transition hover:bg-surface-container-high/50"
                  :class="selectedId === job.id ? 'bg-surface-container-high/15' : ''"
                  @click="selectJob(job.id)"
                >
                  <td class="px-6 py-5">
                    <div class="flex items-center gap-3">
                      <div class="flex size-10 items-center justify-center rounded-xl bg-primary-fixed text-primary">
                        <AppIcon name="cron" size="sm" />
                      </div>
                      <div>
                        <p class="text-sm font-bold text-on-surface">{{ job.name }}</p>
                        <p class="tech-text mt-1 text-[11px] text-on-surface-variant">TARGET: {{ job.payload.target || job.payload.channel || '-' }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-5">
                    <p class="tech-text inline-flex rounded-lg bg-surface-container-low px-2 py-1 text-xs text-on-surface">{{ scheduleToken(job.schedule) }}</p>
                    <p class="mt-2 text-[11px] italic text-on-surface-variant">{{ scheduleSummary(job.schedule) }}</p>
                  </td>
                  <td class="px-6 py-5 whitespace-nowrap">
                    <span class="inline-flex rounded-full px-3 py-1 text-[10px] font-bold tracking-[0.08em]" :class="job.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-container-high text-on-surface-variant'">
                      {{ job.enabled ? '已启用' : '已停用' }}
                    </span>
                  </td>
                  <td class="px-6 py-5 whitespace-nowrap tech-text text-xs text-on-surface-variant">{{ job.lastRunAtMs ? formatDateTime(job.lastRunAtMs) : '--' }}</td>
                  <td class="px-6 py-5 whitespace-nowrap tech-text text-xs text-on-surface-variant">{{ job.nextRunAtMs ? formatDateTime(job.nextRunAtMs) : '--' }}</td>
                  <td class="px-6 py-5 whitespace-nowrap text-right">
                    <div class="flex justify-end gap-2">
                      <button class="rounded-lg border border-outline-variant/20 px-3 py-2 text-xs font-semibold text-on-surface transition hover:bg-surface-container-high" type="button" @click.stop="toggleJob(job)">
                        {{ job.enabled ? '停用' : '启用' }}
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="!jobs.length">
                  <td colspan="6" class="px-6 py-14 text-center text-sm text-on-surface-variant">还没有定时任务，点击右上角开始创建。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <aside class="mt-6 w-full shrink-0 border-outline-variant/10 xl:mt-0 xl:ml-6 xl:w-[390px] xl:border-l">
          <div class="h-full rounded-[1.6rem] bg-surface-container-low xl:rounded-none xl:bg-transparent">
            <div class="sidebar-rail-scroll rounded-[1.6rem] bg-surface-container-lowest xl:ml-6">
              <div class="border-b border-outline-variant/10 bg-surface-container-lowest px-6 py-6">
                <div class="mb-4 flex items-center justify-between">
                  <h3 class="cn-section-title text-on-surface">任务详情</h3>
                  <button v-if="selectedId" class="rounded-lg border border-outline-variant/20 px-3 py-2 text-xs font-semibold text-on-surface transition hover:bg-surface-container-low" type="button" @click="startCreate">
                    新建
                  </button>
                </div>
                <div class="rounded-2xl bg-surface-container-low px-4 py-4">
                  <div class="flex items-center gap-2">
                    <span class="inline-block size-2 rounded-full" :class="draft.enabled ? 'bg-primary' : 'bg-outline-variant'"></span>
                    <span class="text-xs font-bold tracking-[0.08em] text-on-surface-variant">{{ selectedId ? '当前选中' : '新建任务' }}</span>
                  </div>
                  <p class="mt-3 text-base font-bold text-primary">{{ draft.name || '未命名任务' }}</p>
                  <p class="tech-text mt-1 text-[11px] text-on-surface-variant">ID: {{ selectedId || '待创建' }}</p>
                </div>
              </div>

              <div class="space-y-8 p-6">
                <div class="space-y-4">
                  <div>
                    <label class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">任务名称</label>
                    <input v-model="draft.name" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition focus:border-primary/30 focus:ring-2 focus:ring-primary/15" type="text" />
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <label>
                      <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">调度类型</span>
                      <select v-model="draft.schedule.kind" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none">
                        <option value="once">once</option>
                        <option value="interval">interval</option>
                        <option value="daily">daily</option>
                        <option value="cron">cron</option>
                      </select>
                    </label>
                    <label class="flex items-center justify-between rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3">
                      <div>
                        <p class="text-sm font-semibold text-on-surface">启用任务</p>
                        <p class="mt-1 text-[11px] text-on-surface-variant">保存后立即生效</p>
                      </div>
                      <button class="relative h-5 w-10 rounded-full transition" :class="draft.enabled ? 'bg-primary-container' : 'bg-surface-container-high'" type="button" @click="draft.enabled = !draft.enabled">
                        <span class="absolute top-0.5 size-4 rounded-full bg-white transition" :class="draft.enabled ? 'right-0.5' : 'left-0.5'"></span>
                      </button>
                    </label>
                  </div>

                  <div v-if="draft.schedule.kind === 'once'">
                    <label class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">执行时间</label>
                    <input v-model="draft.schedule.onceAt" class="tech-text w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none" type="datetime-local" />
                  </div>
                  <div v-else-if="draft.schedule.kind === 'interval'">
                    <label class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">间隔毫秒</label>
                    <input v-model.number="draft.schedule.intervalMs" class="tech-text w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none" type="number" min="1000" />
                  </div>
                  <div v-else-if="draft.schedule.kind === 'daily'" class="grid grid-cols-2 gap-3">
                    <label>
                      <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">每日时间</span>
                      <input v-model="draft.schedule.dailyAt" class="tech-text w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none" type="time" />
                    </label>
                    <label>
                      <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">时区</span>
                      <input v-model="draft.schedule.tz" class="tech-text w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none" type="text" placeholder="Asia/Shanghai" />
                    </label>
                  </div>
                  <div v-else>
                    <label class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">Cron 表达式</label>
                    <input v-model="draft.schedule.cronExpr" class="tech-text w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none" type="text" placeholder="*/15 * * * *" />
                  </div>
                </div>

                <div class="space-y-4">
                  <h4 class="cn-kicker text-outline">投递内容</h4>
                  <label>
                    <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">描述</span>
                    <input v-model="draft.payload.description" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none" type="text" />
                  </label>
                  <label>
                    <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">详细内容</span>
                    <textarea v-model="draft.payload.detail" class="min-h-28 w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none"></textarea>
                  </label>
                  <div class="grid grid-cols-2 gap-3">
                    <label>
                      <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">渠道</span>
                      <input v-model="draft.payload.channel" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none" type="text" placeholder="telegram" />
                    </label>
                    <label>
                      <span class="mb-1 ml-1 block text-[10px] font-bold tracking-[0.12em] text-on-surface-variant">目标</span>
                      <input v-model="draft.payload.target" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none" type="text" placeholder="ops-room" />
                    </label>
                  </div>
                </div>
              </div>

              <div class="border-t border-outline-variant/10 bg-surface-container-lowest p-6">
                <button class="mb-3 w-full rounded-xl bg-surface-container-high py-3 text-sm font-bold text-on-surface transition hover:bg-surface-container-highest" type="button" :disabled="saving" @click="saveJob">
                  {{ saving ? '保存中...' : selectedId ? '保存更改' : '创建任务' }}
                </button>
                <button v-if="selectedId" class="w-full rounded-xl py-3 text-sm font-bold text-error transition hover:bg-error/10" type="button" :disabled="saving" @click="deleteJob">
                  删除任务配置
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { CronJob } from '@/lib/types';
import { useRoute } from 'vue-router';
import { getRouteToken } from '@/lib/auth';

const route = useRoute();
const token = getRouteToken(route);

const jobs = ref<CronJob[]>([]);
const selectedId = ref('');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const draft = ref<CronJob>(createEmptyJob());

const enabledCount = computed(() => jobs.value.filter((job) => job.enabled).length);
const enabledRate = computed(() => {
  if (!jobs.value.length) return '0.0';
  return ((enabledCount.value / jobs.value.length) * 100).toFixed(1);
});
const nextExecutionLabel = computed(() => {
  const nextRun = [...jobs.value]
    .filter((job) => typeof job.nextRunAtMs === 'number')
    .sort((left, right) => (left.nextRunAtMs || 0) - (right.nextRunAtMs || 0))[0];
  return nextRun?.nextRunAtMs ? formatDateTime(nextRun.nextRunAtMs) : '--';
});

function createEmptyJob(): CronJob {
  return {
    id: '',
    name: '',
    enabled: true,
    schedule: {
      kind: 'cron',
      cronExpr: '*/15 * * * *',
      tz: 'Asia/Shanghai',
    },
    payload: {
      description: '',
      detail: '',
      channel: '',
      target: '',
    },
  };
}

function normalizeDraft(job: CronJob) {
  return structuredClone({
    ...createEmptyJob(),
    ...job,
    schedule: {
      ...createEmptyJob().schedule,
      ...job.schedule,
    },
    payload: {
      ...createEmptyJob().payload,
      ...job.payload,
    },
  });
}

function scheduleToken(schedule: CronJob['schedule']) {
  if (schedule.kind === 'cron') return schedule.cronExpr || '--';
  if (schedule.kind === 'interval') return `${schedule.intervalMs || 0}ms`;
  if (schedule.kind === 'daily') return schedule.dailyAt || '--';
  return schedule.onceAt || '--';
}

function scheduleSummary(schedule: CronJob['schedule']) {
  if (schedule.kind === 'cron') return '按 cron 表达式循环执行';
  if (schedule.kind === 'interval') return `每 ${schedule.intervalMs || 0}ms 执行一次`;
  if (schedule.kind === 'daily') return `每天 ${schedule.dailyAt || '--'} 执行`;
  return '单次定时执行';
}

async function loadJobs() {
  loading.value = true;
  error.value = '';

  const result = await apiGet<{ jobs: CronJob[] }>('/api/cron', token);
  loading.value = false;

  if (result.error || !result.data) {
    error.value = result.error || '任务加载失败';
    jobs.value = [];
    return;
  }

  jobs.value = result.data.jobs;
  if (selectedId.value && jobs.value.some((job) => job.id === selectedId.value)) {
    await selectJob(selectedId.value);
    return;
  }

  if (!selectedId.value && jobs.value[0]) {
    await selectJob(jobs.value[0].id);
  } else if (!jobs.value.length) {
    draft.value = createEmptyJob();
  }
}

async function selectJob(id: string) {
  selectedId.value = id;

  const result = await apiGet<{ job: CronJob }>(`/api/cron/${encodeURIComponent(id)}`, token);
  if (result.error || !result.data) {
    error.value = result.error || '任务详情加载失败';
    return;
  }

  draft.value = normalizeDraft(result.data.job);
}

function startCreate() {
  selectedId.value = '';
  draft.value = createEmptyJob();
}

async function saveJob() {
  if (!draft.value.name.trim()) {
    error.value = '任务名称不能为空';
    return;
  }

  if (!draft.value.payload.description.trim()) {
    error.value = '任务描述不能为空';
    return;
  }

  saving.value = true;
  error.value = '';

  const payload = {
    name: draft.value.name,
    enabled: draft.value.enabled,
    schedule: draft.value.schedule,
    payload: draft.value.payload,
  };

  const result = selectedId.value
    ? await apiPut<{ success: true; job: CronJob }>(`/api/cron/${encodeURIComponent(selectedId.value)}`, token, payload)
    : await apiPost<{ success: true; job: CronJob }>('/api/cron', token, payload);

  saving.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  if (result.data?.job?.id) {
    selectedId.value = result.data.job.id;
  }
  await loadJobs();
}

async function toggleJob(job: CronJob) {
  const result = await apiPost<{ success: true }>(`/api/cron/${encodeURIComponent(job.id)}/toggle`, token, {
    enabled: !job.enabled,
  });

  if (result.error) {
    error.value = result.error;
    return;
  }

  await loadJobs();
}

async function deleteJob() {
  if (!selectedId.value || !window.confirm(`确认删除任务 ${draft.value.name || selectedId.value} 吗？`)) {
    return;
  }

  saving.value = true;
  const result = await apiDelete<{ success: true }>(`/api/cron/${encodeURIComponent(selectedId.value)}`, token);
  saving.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  selectedId.value = '';
  draft.value = createEmptyJob();
  await loadJobs();
}

onMounted(loadJobs);
</script>
