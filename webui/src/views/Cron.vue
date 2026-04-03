<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import { cronApi, type CronJobInfo } from '../lib/api';

const jobs = ref<CronJobInfo[]>([]);
const loading = ref(true);
const showCreateForm = ref(false);
const newJob = ref({ id: '', name: '', expression: '' });
const creating = ref(false);

async function loadJobs() {
  loading.value = true;
  try {
    const data = await cronApi.list();
    jobs.value = data.jobs || [];
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
}

async function createJob() {
  if (!newJob.value.id || !newJob.value.expression) return;

  creating.value = true;
  try {
    await cronApi.create({
      id: newJob.value.id,
      name: newJob.value.name || newJob.value.id,
      expression: newJob.value.expression,
    });
    newJob.value = { id: '', name: '', expression: '' };
    showCreateForm.value = false;
    loadJobs();
  } catch (err) {
    console.error(err);
  } finally {
    creating.value = false;
  }
}

async function toggleJob(id: string) {
  try {
    await cronApi.toggle(id);
    loadJobs();
  } catch (err) {
    console.error(err);
  }
}

async function deleteJob(id: string) {
  if (!confirm('Delete this cron job?')) return;

  try {
    await cronApi.delete(id);
    jobs.value = jobs.value.filter((j) => j.id !== id);
  } catch (err) {
    console.error(err);
  }
}

onMounted(loadJobs);
</script>

<template>
  <AppLayout>
    <div class="h-full overflow-y-auto p-6">
      <div class="max-w-7xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold text-white">Cron Jobs</h1>
          <button
            @click="showCreateForm = !showCreateForm"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            {{ showCreateForm ? 'Cancel' : 'Create Job' }}
          </button>
        </div>

        <!-- Create Form -->
        <div v-if="showCreateForm" class="mb-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 class="text-lg font-semibold text-white mb-4">New Cron Job</h2>
          <div class="grid gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-400 mb-2">Job ID</label>
              <input
                v-model="newJob.id"
                type="text"
                placeholder="my-job"
                class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-400 mb-2">Name</label>
              <input
                v-model="newJob.name"
                type="text"
                placeholder="My Cron Job"
                class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-400 mb-2">Cron Expression</label>
              <input
                v-model="newJob.expression"
                type="text"
                placeholder="*/5 * * * *"
                class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p class="mt-1 text-xs text-gray-500">Format: minute hour day month weekday</p>
            </div>
            <button
              @click="createJob"
              :disabled="creating || !newJob.id || !newJob.expression"
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
            >
              {{ creating ? 'Creating...' : 'Create' }}
            </button>
          </div>
        </div>

        <div v-if="loading" class="flex items-center justify-center h-64">
          <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>

        <div v-else class="space-y-4">
          <div
            v-for="job in jobs"
            :key="job.id"
            class="bg-gray-800 rounded-lg border border-gray-700 p-6"
          >
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-white">{{ job.name }}</h3>
                <p class="text-sm text-gray-400 mt-1">{{ job.id }}</p>
              </div>
              <div class="flex items-center gap-4">
                <span
                  :class="[
                    'px-3 py-1 text-sm font-medium rounded',
                    job.enabled ? 'bg-green-600/20 text-green-400' : 'bg-gray-600/20 text-gray-400'
                  ]"
                >
                  {{ job.enabled ? 'Enabled' : 'Disabled' }}
                </span>
                <button
                  @click="toggleJob(job.id)"
                  class="px-3 py-1 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded transition-colors"
                >
                  Toggle
                </button>
                <button
                  @click="deleteJob(job.id)"
                  class="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
            <div class="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div>
                <span class="text-gray-400">Expression:</span>
                <span class="ml-2 text-white font-mono">{{ job.expression }}</span>
              </div>
              <div>
                <span class="text-gray-400">Next Run:</span>
                <span class="ml-2 text-white">{{ job.nextRun || 'N/A' }}</span>
              </div>
              <div>
                <span class="text-gray-400">Run Count:</span>
                <span class="ml-2 text-white">{{ job.runCount }}</span>
              </div>
            </div>
          </div>

          <div v-if="jobs.length === 0" class="text-center py-12 text-gray-400">
            No cron jobs configured
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
