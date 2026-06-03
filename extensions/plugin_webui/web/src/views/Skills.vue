<template>
  <div>
    <div class="flex items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="page-title">Skills</h1>
        <p class="page-subtitle" style="margin: 0.25rem 0 0">
          Browse all registered skills loaded from configuration directories.
        </p>
      </div>
      <button
        class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-primary rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-primary text-white hover:bg-primary-hover hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(217,119,87,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
        @click="reloadSkills"
      >
        Reload
      </button>
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
              Description
            </th>
            <th
              class="px-4 py-3 text-left text-mid-gray font-heading font-medium text-[0.7rem] uppercase tracking-[0.08em] bg-[#FAF8F3] sticky top-0"
            >
              Type
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="skill in skills"
            :key="skill.name"
            class="cursor-pointer bg-[#FDFBF9] transition-colors duration-[0.15s] ease hover:bg-[rgba(20,20,19,0.03)]"
            @click="openDrawer(skill.name)"
          >
            <td
              class="px-4 py-3 border-b border-[var(--color-border)] font-heading font-medium text-dark"
            >
              {{ skill.name }}
            </td>
            <td class="px-4 py-3 border-b border-[var(--color-border)] text-mid-gray">
              {{ skill.description }}
            </td>
            <td class="px-4 py-3 border-b border-[var(--color-border)]">
              <span
                class="inline-flex items-center px-2 py-[0.15rem] rounded font-heading text-[0.7rem] font-medium lowercase"
                :class="
                  skill.isSystem
                    ? 'bg-[rgba(106,155,204,0.12)] text-[#4a7aa8]'
                    : 'bg-[rgba(120,140,93,0.12)] text-[#5a6e47]'
                "
              >
                {{ skill.isSystem ? 'system' : 'user' }}
              </span>
            </td>
          </tr>
          <tr v-if="skills.length === 0">
            <td colspan="3" class="text-mid-gray text-center py-10 font-body italic text-sm">
              No skills
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <Transition name="drawer">
        <div
          v-if="drawerOpen"
          class="fixed inset-0 bg-[rgba(20,20,19,0.25)] backdrop-blur-sm z-[100] flex justify-end"
          @click.self="closeDrawer"
        >
          <div
            class="w-full max-w-[640px] h-full bg-light border-l border-[var(--color-border)] flex flex-col shadow-[-10px_0_30px_rgba(20,20,19,0.08)]"
          >
            <div
              class="flex items-center justify-between px-6 py-5 border-b border-[var(--color-border)] shrink-0"
            >
              <div class="flex items-center gap-3">
                <h3 class="font-heading text-lg font-semibold text-dark">
                  {{ activeSkillName }}
                </h3>
                <span
                  v-if="activeSkill?.isSystem"
                  class="inline-flex items-center px-2 py-[0.15rem] rounded font-heading text-[0.7rem] font-medium lowercase bg-[rgba(106,155,204,0.12)] text-[#4a7aa8]"
                >
                  system
                </span>
                <span
                  v-else-if="activeSkill"
                  class="inline-flex items-center px-2 py-[0.15rem] rounded font-heading text-[0.7rem] font-medium lowercase bg-[rgba(120,140,93,0.12)] text-[#5a6e47]"
                >
                  user
                </span>
              </div>
              <button
                class="bg-none border-none cursor-pointer text-mid-gray p-1 flex items-center justify-center rounded transition-all duration-[0.15s] ease hover:bg-light-gray hover:text-dark"
                @click="closeDrawer"
              >
                <XMarkIcon class="w-[18px] h-[18px]" />
              </button>
            </div>

            <div class="flex-1 overflow-auto p-6">
              <div v-if="loadingContent" class="flex items-center justify-center h-full">
                <span class="text-mid-gray font-body text-sm">Loading...</span>
              </div>
              <div
                v-else-if="skillContent"
                class="bg-dark text-light rounded-sm p-5 overflow-auto max-h-full"
              >
                <pre
                  class="font-mono text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words m-0"
                  >{{ skillContent }}</pre
                >
              </div>
              <div v-else class="flex items-center justify-center h-full">
                <span class="text-mid-gray font-body text-sm">Failed to load skill content.</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { XMarkIcon } from '@heroicons/vue/24/outline';
import { useWebSocket } from '@/composables/useWebSocket';
import { useToast } from '@/composables/useToast';

const ws = useWebSocket();
const { showToast } = useToast();

interface Skill {
  name: string;
  description: string;
  isSystem: boolean;
}

const skills = ref<Skill[]>([]);
const drawerOpen = ref(false);
const activeSkillName = ref('');
const skillContent = ref('');
const loadingContent = ref(false);

const activeSkill = ref<Skill | null>(null);

async function fetchSkills() {
  const data = await ws.send('get_skills');
  skills.value = Array.isArray(data) ? data : [];
}

async function reloadSkills() {
  try {
    const reloadResult = await ws.send('reload_skills');
    showToast(
      'toast-success',
      (reloadResult as { message?: string })?.message ?? 'Skills reloaded',
    );
    await fetchSkills();
  } catch (err) {
    showToast('toast-error', err instanceof Error ? err.message : 'Reload failed');
  }
}

async function openDrawer(name: string) {
  activeSkillName.value = name;
  activeSkill.value = skills.value.find((s) => s.name === name) ?? null;
  drawerOpen.value = true;
  loadingContent.value = true;
  skillContent.value = '';

  try {
    const result = (await ws.send('get_skill_content', { name })) as {
      name: string;
      content: string;
    };
    skillContent.value = result.content ?? '';
  } catch {
    skillContent.value = '';
  } finally {
    loadingContent.value = false;
  }
}

function closeDrawer() {
  drawerOpen.value = false;
  activeSkill.value = null;
  skillContent.value = '';
}

onMounted(fetchSkills);
</script>
