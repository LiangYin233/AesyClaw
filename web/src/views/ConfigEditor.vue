<template>
  <div>
    <div class="toolbar">
      <button class="btn btn-success" :disabled="saving" @click="saveConfig">
        {{ saving ? 'Saving...' : '💾 Save' }}
      </button>
      <button class="btn btn-ghost" @click="loadConfig">🔄 Reset</button>
      <button class="btn btn-ghost" @click="exportConfig">📤 Export</button>
    </div>

    <div v-if="loading" class="empty-state">Loading configuration...</div>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <div v-else>
      <SchemaForm
        :schema="schema"
        :model-value="config"
        label="Configuration"
        @update:model-value="config = $event as Record<string, unknown>"
      />
    </div>

    <div v-if="toast" class="toast" :class="toast.type">{{ toast.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';
import SchemaForm from '@/components/SchemaForm.vue';

const { api } = useAuth();

const schema = ref<Record<string, unknown>>({});
const config = ref<Record<string, unknown>>({});
const loading = ref(true);
const saving = ref(false);
const error = ref('');

const toast = ref<{ type: string; message: string } | null>(null);

function showToast(type: string, message: string) {
  toast.value = { type, message };
  setTimeout(() => {
    toast.value = null;
  }, 3000);
}

async function loadSchema() {
  try {
    const res = await api.get('/config/schema');
    if (res.data.ok) {
      schema.value = res.data.data;
    }
  } catch (err) {
    console.error('Failed to load schema', err);
  }
}

async function loadConfig() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/config');
    if (res.data.ok) {
      config.value = res.data.data;
    } else {
      error.value = res.data.error ?? 'Failed to load config';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load config';
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    const res = await api.put('/config', config.value);
    if (res.data.ok) {
      showToast('toast-success', 'Configuration saved successfully');
    } else {
      showToast('toast-error', res.data.error ?? 'Save failed');
    }
  } catch (err) {
    showToast('toast-error', err instanceof Error ? err.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(config.value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aesyclaw-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

onMounted(() => {
  loadSchema();
  loadConfig();
});
</script>
