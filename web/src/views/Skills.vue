<template>
  <div>
    <h1 class="page-title">Skills</h1>
    <p class="page-subtitle">Browse all registered skills loaded from configuration directories.</p>

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
            class="bg-[#FDFBF9] transition-colors duration-[0.15s] ease hover:bg-[rgba(20,20,19,0.03)]"
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';

const { api } = useAuth();

interface Skill {
  name: string;
  description: string;
  isSystem: boolean;
}

const skills = ref<Skill[]>([]);

async function loadSkills() {
  try {
    const res = await api.get('/skills');
    if (res.data.ok) {
      skills.value = res.data.data;
    }
  } catch (err) {
    console.error('Failed to load skills', err);
  }
}

onMounted(loadSkills);
</script>
