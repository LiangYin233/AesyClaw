<template>
  <div>
    <h1 class="page-title">Tools</h1>
    <p class="page-subtitle">Browse all registered tools available to agents.</p>

    <div class="overflow-x-auto rounded border border-[var(--color-border)]">
      <table class="w-full border-collapse separate font-body text-sm">
        <thead>
          <tr>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
              style="width: 40px"
            ></th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Name
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Description
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Owner
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="tool in tools" :key="tool.name">
            <tr
              class="cursor-pointer bg-[#FDFBF9] transition-colors duration-[0.15s] ease hover:bg-[rgba(20,20,19,0.03)]"
              @click="toggleTool(tool.name)"
            >
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                <ChevronRightIcon
                  class="w-[14px] h-[14px] text-mid-gray transition-transform duration-[0.2s] ease shrink-0"
                  :class="{ 'rotate-90': expanded === tool.name }"
                />
              </td>
              <td
                class="px-4 py-3 border-b border-[var(--color-border)] font-heading font-medium text-dark"
              >
                {{ tool.name }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)] text-mid-gray">
                {{ tool.description }}
              </td>
              <td class="px-4 py-3 border-b border-[var(--color-border)]">
                <span
                  class="inline-flex items-center px-2 py-[0.15rem] rounded font-heading text-[0.7rem] font-medium lowercase"
                  :class="ownerClass(tool.owner)"
                >
                  {{ tool.owner }}
                </span>
              </td>
            </tr>
            <tr v-if="expanded === tool.name" class="bg-[rgba(20,20,19,0.02)]">
              <td colspan="4">
                <div class="p-5">
                  <div class="flex items-center justify-between mb-3">
                    <h4 class="font-heading text-sm font-semibold text-dark m-0">Parameters</h4>
                    <button
                      class="inline-flex items-center gap-1.5 px-2.5 py-[0.35rem] border border-[var(--color-border)] rounded-sm bg-transparent text-mid-gray font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease hover:bg-light-gray hover:text-dark"
                      @click="expanded = null"
                    >
                      <ChevronUpIcon class="w-[14px] h-[14px]" />
                      Collapse
                    </button>
                  </div>
                  <div
                    v-if="paramFields(tool.parameters).length === 0"
                    class="text-mid-gray text-sm italic"
                  >
                    No parameters
                  </div>
                  <div v-else class="flex flex-col gap-2">
                    <div
                      v-for="p in paramFields(tool.parameters)"
                      :key="p.name"
                      class="flex items-baseline gap-2 text-sm"
                    >
                      <span class="font-heading font-medium text-dark">{{ p.name }}</span>
                      <span class="text-xs text-mid-gray uppercase tracking-[0.04em]">{{
                        p.type
                      }}</span>
                      <span
                        v-if="p.required"
                        class="text-xs text-[#b85c3a] uppercase tracking-[0.04em]"
                        >required</span
                      >
                      <span v-if="p.description" class="text-xs text-mid-gray"
                        >— {{ p.description }}</span
                      >
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="tools.length === 0">
            <td colspan="4" class="text-mid-gray text-center py-10 font-body italic text-sm">
              No tools
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import { ChevronRightIcon, ChevronUpIcon } from '@heroicons/vue/24/outline';

const ws = useWebSocket();

interface Tool {
  name: string;
  description: string;
  owner: string;
  parameters: Record<string, unknown>;
}

interface ParamField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

const tools = ref<Tool[]>([]);
const expanded = ref<string | null>(null);

function paramFields(params: Record<string, unknown>): ParamField[] {
  const props = (params['properties'] ?? {}) as Record<
    string,
    { type?: string; description?: string }
  >;
  const required = (params['required'] ?? []) as string[];
  return Object.entries(props).map(([name, def]) => ({
    name,
    type: def.type ?? '—',
    required: required.includes(name),
    description: def.description ?? '',
  }));
}

async function loadTools() {
  try {
    const data = await ws.send('get_tools');
    tools.value = Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Failed to load tools', err);
  }
}

function toggleTool(name: string) {
  expanded.value = expanded.value === name ? null : name;
}

function ownerClass(owner: string): string {
  if (owner === 'system') return 'bg-[rgba(106,155,204,0.12)] text-[#4a7aa8]';
  if (owner.startsWith('plugin:')) return 'bg-[rgba(120,140,93,0.12)] text-[#5a6e47]';
  if (owner.startsWith('mcp:')) return 'bg-[rgba(217,119,87,0.12)] text-[#b85c3a]';
  return 'bg-light-gray text-mid-gray';
}

onMounted(loadTools);
</script>
