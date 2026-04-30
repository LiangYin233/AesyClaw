<template>
  <div>
    <h1 class="page-title">Usage Statistics</h1>
    <p class="page-subtitle">Track token consumption per model over time.</p>

    <!-- Filters -->
    <div class="filters">
      <div class="filter-group">
        <label class="filter-label" for="from-date">From</label>
        <input
          id="from-date"
          v-model="fromDate"
          type="date"
          class="filter-input"
          @change="load"
        />
      </div>
      <div class="filter-group">
        <label class="filter-label" for="to-date">To</label>
        <input
          id="to-date"
          v-model="toDate"
          type="date"
          class="filter-input"
          @change="load"
        />
      </div>
      <div class="filter-group">
        <label class="filter-label" for="model-filter">Model</label>
        <select
          id="model-filter"
          v-model="modelFilter"
          class="filter-input"
          @change="load"
        >
          <option value="">All models</option>
          <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="summary-grid" v-if="summary.totalTokens > 0">
      <div class="summary-card">
        <div class="summary-card-value">{{ formatNumber(summary.totalTokens) }}</div>
        <div class="summary-card-label">Total Tokens</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-value">{{ formatNumber(summary.inputTokens) }}</div>
        <div class="summary-card-label">Input Tokens</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-value">{{ formatNumber(summary.outputTokens) }}</div>
        <div class="summary-card-label">Output Tokens</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-value">{{ summary.count }}</div>
        <div class="summary-card-label">API Calls</div>
      </div>
    </div>

    <!-- Chart -->
    <div class="chart-section" v-if="chartData.length > 0">
      <h2 class="section-title">Token Trend</h2>
      <div class="chart-container">
        <canvas ref="chartCanvas"></canvas>
      </div>
    </div>

    <!-- Detail Table -->
    <div class="table-section">
      <h2 class="section-title">Detail</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Date</th>
              <th>Input</th>
              <th>Output</th>
              <th>Total</th>
              <th>Cache Read</th>
              <th>Cache Write</th>
              <th>Calls</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data" :key="`${row.model}-${row.date}`">
              <td class="cell-model">{{ row.model }}</td>
              <td class="cell-muted">{{ row.date }}</td>
              <td>{{ formatNumber(row.inputTokens) }}</td>
              <td>{{ formatNumber(row.outputTokens) }}</td>
              <td class="cell-bold">{{ formatNumber(row.totalTokens) }}</td>
              <td class="cell-muted">{{ formatNumber(row.cacheReadTokens) }}</td>
              <td class="cell-muted">{{ formatNumber(row.cacheWriteTokens) }}</td>
              <td>{{ row.count }}</td>
            </tr>
            <tr v-if="data.length === 0">
              <td colspan="8" class="empty-state">No usage data for the selected period.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Title, Tooltip, Legend } from 'chart.js';
import { useAuth } from '@/composables/useAuth';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Title, Tooltip, Legend);

const { api } = useAuth();

interface UsageRow {
  model: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  count: number;
}

const data = ref<UsageRow[]>([]);
const fromDate = ref('');
const toDate = ref('');
const modelFilter = ref('');
const modelOptions = ref<string[]>([]);
const chartCanvas = ref<HTMLCanvasElement | null>(null);

let chart: Chart | null = null;

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
  // Aggregate by date across all models for chart
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
  // Sort by date ascending
  return [...dateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, tokens]) => ({ date, ...tokens }));
});

function formatNumber(n: number): string {
  return n.toLocaleString();
}

async function loadModelOptions() {
  try {
    const res = await api.get('/config');
    if (res.data.ok) {
      const providers = res.data.data.providers as Record<string, { models?: Record<string, unknown> }>;
      const opts: string[] = [];
      for (const provider of Object.values(providers)) {
        if (provider.models) {
          for (const modelId of Object.keys(provider.models)) {
            opts.push(modelId);
          }
        }
      }
      modelOptions.value = opts;
    }
  } catch (err) {
    console.error('Failed to load model options', err);
  }
}

async function load() {
  try {
    const params: Record<string, string> = {};
    if (fromDate.value) params.from = fromDate.value;
    if (toDate.value) params.to = toDate.value;
    if (modelFilter.value.trim()) params.model = modelFilter.value.trim();

    const res = await api.get('/usage', { params });
    if (res.data.ok) {
      data.value = res.data.data;
    }
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

watch(chartData, () => {
  nextTick(() => {
    renderChart();
  });
}, { deep: true });

onMounted(() => {
  // Default to last 7 days
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  fromDate.value = weekAgo.toISOString().split('T')[0];
  toDate.value = today.toISOString().split('T')[0];
  loadModelOptions();
  load();
  renderChart();
});

onUnmounted(() => {
  if (chart) {
    chart.destroy();
    chart = null;
  }
});
</script>

<style scoped>
.page-subtitle {
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--color-text-muted);
  margin: 0.25rem 0 1.5rem;
}

.filters {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.filter-label {
  font-family: var(--font-heading);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.filter-input {
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 0.85rem;
  background: #fff;
  color: var(--color-dark);
  min-width: 160px;
}

.filter-input:focus {
  outline: none;
  border-color: var(--color-accent-orange);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.summary-card {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 1rem 1.25rem;
}

.summary-card-value {
  font-family: var(--font-heading);
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--color-dark);
  margin-bottom: 0.25rem;
}

.summary-card-label {
  font-family: var(--font-heading);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.section-title {
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-dark);
  margin-bottom: 1rem;
}

.chart-section {
  margin-bottom: 2rem;
}

.chart-container {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 1.5rem;
  height: 320px;
  position: relative;
}

.table-section {
  margin-top: 0;
}

.cell-model {
  font-family: var(--font-heading);
  font-size: 0.8rem;
  font-weight: 500;
}

.cell-bold {
  font-weight: 600;
}

.cell-muted {
  color: var(--color-text-muted);
}
</style>
