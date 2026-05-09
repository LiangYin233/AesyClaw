<template>
  <div>
    <h1 class="page-title">Usage Statistics</h1>
    <p class="page-subtitle">Track token consumption per model over time.</p>

    <div class="flex gap-4 mb-6 flex-wrap">
      <div class="flex flex-col gap-[0.35rem]">
        <label class="font-heading text-xs font-medium text-mid-gray" :for="fromDateId">From</label>
        <input
          :id="fromDateId"
          v-model="fromDate"
          type="date"
          class="px-[0.7rem] py-[0.45rem] border border-[var(--color-border)] rounded-sm font-body text-sm bg-white text-dark min-w-[160px] outline-none focus:border-primary"
          @change="load"
        />
      </div>
      <div class="flex flex-col gap-[0.35rem]">
        <label class="font-heading text-xs font-medium text-mid-gray" :for="toDateId">To</label>
        <input
          :id="toDateId"
          v-model="toDate"
          type="date"
          class="px-[0.7rem] py-[0.45rem] border border-[var(--color-border)] rounded-sm font-body text-sm bg-white text-dark min-w-[160px] outline-none focus:border-primary"
          @change="load"
        />
      </div>
      <div class="flex flex-col gap-[0.35rem]">
        <label class="font-heading text-xs font-medium text-mid-gray" :for="modelFilterId"
          >Model</label
        >
        <select
          :id="modelFilterId"
          v-model="modelFilter"
          class="px-[0.7rem] py-[0.45rem] border border-[var(--color-border)] rounded-sm font-body text-sm bg-white text-dark min-w-[160px] outline-none focus:border-primary"
          @change="load"
        >
          <option value="">All models</option>
          <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
    </div>

    <div
      class="grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 mb-6"
      v-if="summary.totalTokens > 0"
    >
      <div class="bg-white border border-[var(--color-border)] rounded-sm px-5 py-4">
        <div class="font-heading text-xl font-semibold text-dark mb-1">
          {{ formatNumber(summary.totalTokens) }}
        </div>
        <div class="font-heading text-xs font-medium text-mid-gray">Total Tokens</div>
      </div>
      <div class="bg-white border border-[var(--color-border)] rounded-sm px-5 py-4">
        <div class="font-heading text-xl font-semibold text-dark mb-1">
          {{ formatNumber(summary.inputTokens) }}
        </div>
        <div class="font-heading text-xs font-medium text-mid-gray">Input Tokens</div>
      </div>
      <div class="bg-white border border-[var(--color-border)] rounded-sm px-5 py-4">
        <div class="font-heading text-xl font-semibold text-dark mb-1">
          {{ formatNumber(summary.outputTokens) }}
        </div>
        <div class="font-heading text-xs font-medium text-mid-gray">Output Tokens</div>
      </div>
      <div class="bg-white border border-[var(--color-border)] rounded-sm px-5 py-4">
        <div class="font-heading text-xl font-semibold text-dark mb-1">{{ summary.count }}</div>
        <div class="font-heading text-xs font-medium text-mid-gray">API Calls</div>
      </div>
    </div>

    <div class="mb-8" v-if="chartData.length > 0">
      <h2 class="font-heading text-base font-semibold text-dark mb-4">Token Trend</h2>
      <div class="bg-white border border-[var(--color-border)] rounded-sm p-6 h-[320px] relative">
        <canvas ref="chart-canvas"></canvas>
      </div>
    </div>

    <div>
      <h2 class="font-heading text-base font-semibold text-dark mb-4">Detail</h2>
      <div class="overflow-x-auto rounded border border-[var(--color-border)]">
        <table class="w-full border-collapse separate font-body text-sm">
          <thead>
            <tr>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Model
              </th>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Date
              </th>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Input
              </th>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Output
              </th>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Total
              </th>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Cache Read
              </th>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Cache Write
              </th>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Calls
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data" :key="`${row.model}-${row.date}`" class="bg-[#FDFBF9]">
              <td
                class="px-4 py-3 border-b border-[var(--color-border)] font-heading text-xs font-medium"
              >
                {{ row.model }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)] text-mid-gray">
                {{ row.date }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                {{ formatNumber(row.inputTokens) }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                {{ formatNumber(row.outputTokens) }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)] font-semibold">
                {{ formatNumber(row.totalTokens) }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)] text-mid-gray">
                {{ formatNumber(row.cacheReadTokens) }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)] text-mid-gray">
                {{ formatNumber(row.cacheWriteTokens) }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">{{ row.count }}</td>
            </tr>
            <tr v-if="data.length === 0">
              <td colspan="8" class="text-mid-gray text-center py-10 font-body italic text-sm">
                No usage data for the selected period.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="mt-8" v-if="toolTableData.length > 0">
      <h2 class="font-heading text-base font-semibold text-dark mb-4">Tool Calls</h2>
      <div
        class="bg-white border border-[var(--color-border)] rounded-sm p-6 h-[340px] relative mb-6"
      >
        <canvas ref="tool-chart-canvas"></canvas>
      </div>
      <div class="overflow-x-auto rounded border border-[var(--color-border)]">
        <table class="w-full border-collapse separate font-body text-sm">
          <thead>
            <tr>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Name
              </th>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Type
              </th>
              <th
                class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              >
                Calls
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in toolTableData"
              :key="`${row.name}-${row.type}`"
              class="bg-[#FDFBF9]"
            >
              <td
                class="px-4 py-3 border-b border-[var(--color-border)] font-heading text-xs font-medium"
              >
                {{ row.name }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                <span
                  :class="
                    row.type === 'skill'
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-blue-50 text-blue-700'
                  "
                  class="inline-block px-2 py-0.5 rounded text-[0.65rem] font-heading font-medium uppercase tracking-[0.04em]"
                  >{{ row.type }}</span
                >
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">{{ row.count }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, useId, useTemplateRef } from 'vue';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  BarController,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  BarController,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

import { useWebSocket } from '@/composables/useWebSocket';
import type { UsageSummary, ToolUsageSummary } from '@/types/api';

const ws = useWebSocket();
const fromDateId = useId();
const toDateId = useId();
const modelFilterId = useId();

const data = ref<UsageSummary[]>([]);
const toolData = ref<ToolUsageSummary[]>([]);
const fromDate = ref('');
const toDate = ref('');
const modelFilter = ref('');
const modelOptions = ref<string[]>([]);
const chartCanvas = useTemplateRef<HTMLCanvasElement>('chart-canvas');
const toolChartCanvas = useTemplateRef<HTMLCanvasElement>('tool-chart-canvas');

let chart: Chart | null = null;
let toolChart: Chart | null = null;

const summary = computed(() => {
  return data.value.reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      totalTokens: acc.totalTokens + row.totalTokens,
      cacheReadTokens: acc.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + row.cacheWriteTokens,
      count: acc.count + row.count,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      count: 0,
    },
  );
});

const chartData = computed(() => {
  const dateMap = new Map<string, { inputTokens: number; outputTokens: number }>();
  for (const row of data.value) {
    const existing = dateMap.get(row.date);
    if (existing) {
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
    } else {
      dateMap.set(row.date, {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      });
    }
  }
  return [...dateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, tokens]) => ({ date, ...tokens }));
});

const toolChartData = computed(() => {
  const nameMap = new Map<string, { type: string; name: string; count: number }>();
  for (const row of toolData.value) {
    const key = `${row.type}:${row.name}`;
    const existing = nameMap.get(key);
    if (existing) {
      existing.count += row.count;
    } else {
      nameMap.set(key, { type: row.type, name: row.name, count: row.count });
    }
  }
  return [...nameMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map((entry) => ({
      name: entry.name,
      type: entry.type,
      count: entry.count,
      label: entry.type === 'skill' ? `${entry.name} (skill)` : entry.name,
    }));
});

const toolTableData = computed(() => {
  const nameMap = new Map<string, { type: string; name: string; count: number }>();
  for (const row of toolData.value) {
    const key = `${row.type}:${row.name}`;
    const existing = nameMap.get(key);
    if (existing) {
      existing.count += row.count;
    } else {
      nameMap.set(key, { type: row.type, name: row.name, count: row.count });
    }
  }
  return [...nameMap.values()].sort((a, b) => b.count - a.count);
});

function formatNumber(n: number): string {
  return n.toLocaleString();
}

async function loadModelOptions() {
  try {
    const config = await ws.send('get_config') as Record<string, unknown>;
    const providers = config['providers'] as Record<
      string,
      { models?: Record<string, unknown> }
    > | undefined;
    const opts: string[] = [];
    if (providers) {
      for (const provider of Object.values(providers)) {
        if (provider.models) {
          for (const modelId of Object.keys(provider.models)) {
            opts.push(modelId);
          }
        }
      }
    }
    modelOptions.value = opts;
  } catch (err) {
    console.error('Failed to load model options', err);
  }
}

async function load() {
  try {
    const params: Record<string, string> = {};
    if (fromDate.value) params['from'] = fromDate.value;
    if (toDate.value) params['to'] = toDate.value;
    if (modelFilter.value.trim()) params['model'] = modelFilter.value.trim();

    const usageRaw = await ws.send('get_usage', params);
    data.value = Array.isArray(usageRaw) ? usageRaw : [];

    const toolParams = { ...params };
    delete toolParams['model'];
    const toolRaw = await ws.send('get_usage_tools', toolParams);
    toolData.value = Array.isArray(toolRaw) ? toolRaw : [];
  } catch (err) {
    console.error('Failed to load usage stats', err);
  }
}

function renderChart() {
  if (!chartCanvas.value) return;

  if (chart) {
    chart.destroy();
    chart = null;
  }

  if (chartData.value.length === 0) return;

  const labels = chartData.value.map((d) => d.date);
  const inputData = chartData.value.map((d) => d.inputTokens);
  const outputData = chartData.value.map((d) => d.outputTokens);

  chart = new Chart(chartCanvas.value, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Input Tokens',
          data: inputData,
          borderColor: '#D0B7A5',
          backgroundColor: 'rgba(208, 183, 165, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Output Tokens',
          data: outputData,
          borderColor: '#C49A6C',
          backgroundColor: 'rgba(196, 154, 108, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            padding: 20,
            font: { size: 12 },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${(ctx.raw as number).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          ticks: {
            font: { size: 11 },
            callback: (value) => (typeof value === 'number' ? value.toLocaleString() : value),
          },
        },
      },
    },
  });
}

function renderToolChart() {
  if (!toolChartCanvas.value) return;

  if (toolChart) {
    toolChart.destroy();
    toolChart = null;
  }

  if (toolChartData.value.length === 0) return;

  const labels = toolChartData.value.map((d) => d.label);
  const counts = toolChartData.value.map((d) => d.count);
  const colors = toolChartData.value.map((d) =>
    d.type === 'skill' ? 'rgba(196, 154, 108, 0.8)' : 'rgba(208, 183, 165, 0.8)',
  );
  const borderColors = toolChartData.value.map((d) => (d.type === 'skill' ? '#C49A6C' : '#D0B7A5'));

  toolChart = new Chart(toolChartCanvas.value, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Calls',
          data: counts,
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `Calls: ${(ctx.raw as number).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            font: { size: 11 },
            callback: (value) => (typeof value === 'number' ? value.toLocaleString() : value),
          },
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 11 } },
        },
      },
    },
  });
}

watch(
  chartData,
  () => {
    nextTick(() => {
      renderChart();
    });
  },
);

watch(
  toolChartData,
  () => {
    nextTick(() => {
      renderToolChart();
    });
  },
);

function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

onMounted(() => {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  fromDate.value = localDateStr(weekAgo);
  toDate.value = localDateStr(today);
  loadModelOptions();
  load();
});

onUnmounted(() => {
  if (chart) {
    chart.destroy();
    chart = null;
  }
  if (toolChart) {
    toolChart.destroy();
    toolChart = null;
  }
});
</script>
