import { computed, onBeforeUnmount, onMounted, readonly, ref } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import type { CronJob } from '@/lib/types';

const CRON_TARGET_PATTERN = /^[^:]+:(private|group):.+$/;

function toDatetimeLocalValue(isoString: string | undefined): string {
  if (!isoString) {
    return '';
  }
  const match = isoString.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : '';
}

function fromDatetimeLocalValue(localString: string): string {
  if (!localString) {
    return '';
  }
  const date = new Date(localString);
  if (isNaN(date.getTime())) {
    return localString;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const offsetMin = date.getTimezoneOffset();
  const sign = offsetMin <= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const zh = pad(Math.floor(abs / 60));
  const zm = pad(abs % 60);
  return `${yyyy}-${mm}-${dd}T${hh}:${min}${sign}${zh}:${zm}`;
}

function createEmptyCronJob(): CronJob {
  return {
    id: '',
    name: '',
    enabled: true,
    schedule: {
      kind: 'cron',
      cronExpr: '*/15 * * * *',
      tz: 'Asia/Shanghai'
    },
    payload: {
      description: '',
      detail: '',
      target: ''
    }
  };
}

function normalizeCronDraft(job: CronJob) {
  return structuredClone({
    ...createEmptyCronJob(),
    ...job,
    schedule: {
      ...createEmptyCronJob().schedule,
      ...job.schedule
    },
    payload: {
      ...createEmptyCronJob().payload,
      ...job.payload
    }
  });
}

export function useCronState(token: string | null) {
  const jobs = ref<CronJob[]>([]);
  const selectedId = ref('');
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');
  const draft = ref<CronJob>(createEmptyCronJob());
  const isCreating = ref(false);
  let stopJobsSubscription: (() => void) | null = null;

  const enabledCount = computed(() => jobs.value.filter((job) => job.enabled).length);
  const enabledRate = computed(() => {
    if (!jobs.value.length) {
      return '0.0';
    }
    return ((enabledCount.value / jobs.value.length) * 100).toFixed(1);
  });
  const nextExecutionLabel = computed(() => {
    const nextRun = [...jobs.value]
      .filter((job) => job.enabled && typeof job.nextRunAtMs === 'number' && job.nextRunAtMs > Date.now())
      .sort((left, right) => (left.nextRunAtMs || 0) - (right.nextRunAtMs || 0))[0];
    if (!nextRun?.nextRunAtMs) {
      return '--';
    }

    const diff = nextRun.nextRunAtMs - Date.now();
    const seconds = Math.round(diff / 1000);
    if (seconds < 60) {
      return `${seconds}秒后`;
    }

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes}分钟后`;
    }

    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours}小时后`;
    }

    const days = Math.round(hours / 24);
    return `${days}天后`;
  });

  function scheduleToken(schedule: CronJob['schedule']) {
    if (schedule.kind === 'cron') {
      return schedule.cronExpr || '--';
    }
    if (schedule.kind === 'interval') {
      return `${schedule.intervalMs || 0}ms`;
    }
    if (schedule.kind === 'daily') {
      return schedule.dailyAt || '--';
    }
    return schedule.onceAt || '--';
  }

  function scheduleSummary(schedule: CronJob['schedule']) {
    if (schedule.kind === 'cron') {
      return '按 cron 表达式循环执行';
    }
    if (schedule.kind === 'interval') {
      return '每隔一段时间执行';
    }
    if (schedule.kind === 'daily') {
      return '每天定时执行';
    }
    return '只执行一次';
  }

  function syncJobs(nextJobs: CronJob[]) {
    jobs.value = nextJobs;

    if (selectedId.value) {
      const selected = nextJobs.find((job) => job.id === selectedId.value);
      if (selected) {
        draft.value = normalizeCronDraft(selected);
        isCreating.value = false;
        return;
      }
      selectedId.value = '';
    }

    if (!nextJobs.length) {
      draft.value = createEmptyCronJob();
      return;
    }

    if (!isCreating.value) {
      selectedId.value = nextJobs[0].id;
      draft.value = normalizeCronDraft(nextJobs[0]);
    }
  }

  function selectJob(id: string) {
    const selected = jobs.value.find((job) => job.id === id);
    if (!selected) {
      return;
    }

    isCreating.value = false;
    selectedId.value = id;
    draft.value = normalizeCronDraft(selected);
  }

  function startCreate() {
    isCreating.value = true;
    selectedId.value = '';
    draft.value = createEmptyCronJob();
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

    if (draft.value.payload.target?.trim() && !CRON_TARGET_PATTERN.test(draft.value.payload.target.trim())) {
      error.value = '目标格式必须为 channel:private|group:chatId';
      return;
    }

    saving.value = true;
    error.value = '';

    const payload = {
      name: draft.value.name,
      enabled: draft.value.enabled,
      schedule: draft.value.schedule,
      payload: draft.value.payload
    };

    const result = selectedId.value
      ? await rpcCall<{ success: true; job: CronJob }>('cron.update', token, {
        ...payload,
        id: selectedId.value
      })
      : await rpcCall<{ success: true; job: CronJob }>('cron.create', token, payload);

    saving.value = false;

    if (result.error) {
      error.value = result.error;
      return;
    }

    if (result.data?.job?.id) {
      isCreating.value = false;
      selectedId.value = result.data.job.id;
      draft.value = normalizeCronDraft(result.data.job);
    }
  }

  async function toggleJob(job: CronJob) {
    const result = await rpcCall<{ success: true }>('cron.toggle', token, {
      id: job.id,
      enabled: !job.enabled
    });

    if (result.error) {
      error.value = result.error;
    }
  }

  async function deleteJob() {
    if (!selectedId.value || !window.confirm(`确定要删除任务 "${draft.value.name || selectedId.value}" 吗？此操作不可撤销。`)) {
      return;
    }

    saving.value = true;
    const result = await rpcCall<{ success: true }>('cron.delete', token, { id: selectedId.value });
    saving.value = false;

    if (result.error) {
      error.value = result.error;
      return;
    }

    isCreating.value = false;
    selectedId.value = '';
    draft.value = createEmptyCronJob();
  }

  function bindSubscription() {
    stopJobsSubscription?.();
    loading.value = true;
    stopJobsSubscription = rpcSubscribe<{ jobs: CronJob[] }>(
      'cron.list',
      token,
      undefined,
      (data) => {
        syncJobs(data.jobs);
        loading.value = false;
        error.value = '';
      },
      {
        onError: (message) => {
          error.value = message;
          loading.value = false;
        }
      }
    );
  }

  onMounted(() => {
    bindSubscription();
  });

  onBeforeUnmount(() => {
    stopJobsSubscription?.();
    stopJobsSubscription = null;
  });

  return {
    jobs: readonly(jobs),
    selectedId,
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    draft,
    enabledCount,
    enabledRate,
    nextExecutionLabel,
    toDatetimeLocal: toDatetimeLocalValue,
    fromDatetimeLocal: fromDatetimeLocalValue,
    scheduleToken,
    scheduleSummary,
    selectJob,
    startCreate,
    saveJob,
    toggleJob,
    deleteJob
  };
}
