<template>
  <div class="flex h-full flex-col">
    <div class="border-b border-outline-variant/15 bg-surface-container-low/70 p-6">
      <div class="mb-1 flex items-center justify-between">
        <h2 class="font-headline text-lg font-black tracking-tight text-on-surface">角色定义面板</h2>
        <button class="inline-flex size-9 items-center justify-center rounded-xl text-outline transition hover:bg-surface-container-high hover:text-on-surface" type="button" @click="$emit('close')">
          <AppIcon name="close" />
        </button>
      </div>
      <p class="text-xs text-on-surface-variant">
        {{ drawerMode === 'create'
          ? '创建新的 Agent 角色，并为它定义模型、系统提示词与资源边界。'
          : `正在编辑 ${selectedAgent?.name || ''} 的运行边界与能力配置。` }}
      </p>
    </div>

    <div class="flex-1 space-y-8 overflow-y-auto p-6">
      <section>
        <label class="mb-3 block text-[10px] font-mono uppercase tracking-[0.2em] text-outline">基础信息</label>
        <div class="grid gap-4">
          <div>
            <label class="mb-2 block text-xs font-semibold text-on-surface">名称</label>
            <input :value="props.form.name" :disabled="drawerMode === 'edit'" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-70" placeholder="agent 名称" @input="updateName(($event.target as HTMLInputElement).value)" />
          </div>
          <div>
            <label class="mb-2 block text-xs font-semibold text-on-surface">描述</label>
            <input :value="props.form.description" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition focus:border-primary/40" placeholder="用于说明该角色的职责" @input="updateDescription(($event.target as HTMLInputElement).value)" />
          </div>
          <div>
            <label class="mb-2 block text-xs font-semibold text-on-surface">Model</label>
            <input :value="props.form.model" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition focus:border-primary/40" placeholder="provider/model" @input="updateModel(($event.target as HTMLInputElement).value)" />
          </div>
        </div>
      </section>

      <section>
        <label class="mb-3 block text-[10px] font-mono uppercase tracking-[0.2em] text-outline">系统提示词</label>
        <textarea :value="props.form.systemPrompt" rows="8" class="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-4 text-sm leading-6 outline-none transition focus:border-primary/40" placeholder="请输入系统提示词，定义 Agent 的行为方式。" @input="updateSystemPrompt(($event.target as HTMLTextAreaElement).value)" />
      </section>

      <section>
        <label class="mb-3 block text-[10px] font-mono uppercase tracking-[0.2em] text-outline">技能边界</label>
        <div ref="skillTriggerRef" class="relative">
          <button
            class="flex w-full items-center justify-between rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition hover:border-primary/30"
            type="button"
            @click="toggleDropdown('skill')"
          >
            <span :class="props.form.allowedSkills.length ? '' : 'text-outline'">
              {{ props.form.allowedSkills.length ? `已选 ${props.form.allowedSkills.length} 项` : '请选择技能' }}
            </span>
            <svg class="size-4 text-outline transition" :class="skillDropdownOpen ? 'rotate-180' : ''" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" /></svg>
          </button>
          <Teleport to="body">
            <div
              v-if="skillDropdownOpen"
              ref="skillPanelRef"
              class="fixed z-[999] overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl"
              :style="skillPanelStyle"
            >
              <div class="flex items-center justify-between border-b border-outline-variant/15 px-4 py-2.5">
                <span class="text-[11px] font-bold tracking-[0.08em] text-outline">技能选择</span>
                <div class="flex items-center gap-3 text-[11px] font-bold">
                  <button class="text-primary transition hover:opacity-80" type="button" @click="selectAllSkills">全选</button>
                  <button class="text-outline transition hover:text-on-surface" type="button" @click="clearSkills">清空</button>
                </div>
              </div>
              <div class="max-h-56 overflow-y-auto py-1">
                <label
                  v-for="skill in skills"
                  :key="skill.name"
                  class="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-surface-container-high"
                >
                  <input
                    type="checkbox"
                    :checked="props.form.allowedSkills.includes(skill.name)"
                    class="size-4 rounded border-outline-variant accent-primary"
                    @change="toggleSkill(skill.name)"
                  />
                  <span class="text-on-surface">{{ skill.name }}</span>
                </label>
                <div v-if="!skills.length" class="px-4 py-3 text-xs text-outline">暂无可选技能</div>
              </div>
            </div>
          </Teleport>
        </div>
      </section>

      <section>
        <label class="mb-3 block text-[10px] font-mono uppercase tracking-[0.2em] text-outline">工具边界</label>
        <div ref="toolTriggerRef" class="relative">
          <button
            class="flex w-full items-center justify-between rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition hover:border-primary/30"
            type="button"
            @click="toggleDropdown('tool')"
          >
            <span :class="props.form.allowedTools.length ? '' : 'text-outline'">
              {{ props.form.allowedTools.length ? `已选 ${props.form.allowedTools.length} 项` : '请选择工具' }}
            </span>
            <svg class="size-4 text-outline transition" :class="toolDropdownOpen ? 'rotate-180' : ''" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" /></svg>
          </button>
          <Teleport to="body">
            <div
              v-if="toolDropdownOpen"
              ref="toolPanelRef"
              class="fixed z-[999] overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-xl"
              :style="toolPanelStyle"
            >
              <div class="flex items-center justify-between border-b border-outline-variant/15 px-4 py-2.5">
                <span class="text-[11px] font-bold tracking-[0.08em] text-outline">工具选择</span>
                <div class="flex items-center gap-3 text-[11px] font-bold">
                  <button class="text-primary transition hover:opacity-80" type="button" @click="selectAllTools">全选</button>
                  <button class="text-outline transition hover:text-on-surface" type="button" @click="clearTools">清空</button>
                </div>
              </div>
              <div class="max-h-56 overflow-y-auto py-1">
                <label
                  v-for="tool in tools"
                  :key="tool.name"
                  class="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-surface-container-high"
                >
                  <input
                    type="checkbox"
                    :checked="props.form.allowedTools.includes(tool.name)"
                    class="size-4 rounded border-outline-variant accent-primary"
                    @change="toggleTool(tool.name)"
                  />
                  <span class="text-on-surface">{{ tool.name }}</span>
                </label>
                <div v-if="!tools.length" class="px-4 py-3 text-xs text-outline">暂无可选工具</div>
              </div>
            </div>
          </Teleport>
        </div>
      </section>
    </div>

    <div class="flex items-center gap-3 border-t border-outline-variant/15 bg-surface-container-low/80 p-6">
      <button
        v-if="drawerMode === 'edit' && selectedAgent && !selectedAgent.builtin"
        class="rounded-xl border border-error/20 bg-error-container/50 px-4 py-3 text-sm font-bold text-on-error-container transition hover:bg-error-container"
        type="button"
        :disabled="saving"
        @click="$emit('delete')"
      >
        删除
      </button>
      <button class="rounded-xl border border-outline-variant/20 bg-white px-4 py-3 text-sm font-bold text-on-surface transition hover:bg-surface-container-low" type="button" :disabled="saving" @click="$emit('close')">
        取消
      </button>
      <button class="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" type="button" :disabled="saving" @click="$emit('save')">
        {{ saving ? '保存中...' : '应用变更' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import type { AgentRole, AgentRoleConfig, SkillInfo, ToolInfo } from '@/lib/types';

const props = defineProps<{
  form: AgentRoleConfig;
  saving: boolean;
  drawerMode: 'create' | 'edit' | null;
  selectedAgent: AgentRole | null;
  providerOptions: string[];
  skills: SkillInfo[];
  tools: ToolInfo[];
}>();

const emit = defineEmits<{
  close: [];
  save: [];
  delete: [];
  'update:form': [AgentRoleConfig];
}>();

const skillDropdownOpen = ref(false);
const toolDropdownOpen = ref(false);
const skillTriggerRef = useTemplateRef('skillTriggerRef');
const toolTriggerRef = useTemplateRef('toolTriggerRef');
const skillPanelRef = useTemplateRef('skillPanelRef');
const toolPanelRef = useTemplateRef('toolPanelRef');
const skillPanelStyle = ref<Record<string, string>>({});
const toolPanelStyle = ref<Record<string, string>>({});
const skillNames = computed(() => props.skills.map((s) => s.name));
const toolNames = computed(() => props.tools.map((t) => t.name));

function cloneForm(overrides: Partial<AgentRoleConfig> = {}): AgentRoleConfig {
  return {
    name: overrides.name ?? props.form.name,
    description: overrides.description ?? props.form.description,
    model: overrides.model ?? props.form.model,
    systemPrompt: overrides.systemPrompt ?? props.form.systemPrompt,
    allowedSkills: overrides.allowedSkills ? [...overrides.allowedSkills] : [...props.form.allowedSkills],
    allowedTools: overrides.allowedTools ? [...overrides.allowedTools] : [...props.form.allowedTools],
  };
}

function updateName(name: string) {
  emit('update:form', cloneForm({ name }));
}

function updateDescription(description: string) {
  emit('update:form', cloneForm({ description }));
}

function updateModel(model: string) {
  emit('update:form', cloneForm({ model }));
}

function updateSystemPrompt(systemPrompt: string) {
  emit('update:form', cloneForm({ systemPrompt }));
}

function toggleDropdown(type: 'skill' | 'tool') {
  if (type === 'skill') {
    skillDropdownOpen.value = !skillDropdownOpen.value;
    toolDropdownOpen.value = false;
    if (skillDropdownOpen.value) nextTick(() => positionPanel('skill'));
  } else {
    toolDropdownOpen.value = !toolDropdownOpen.value;
    skillDropdownOpen.value = false;
    if (toolDropdownOpen.value) nextTick(() => positionPanel('tool'));
  }
}

function positionPanel(type: 'skill' | 'tool') {
  const trigger = type === 'skill' ? skillTriggerRef.value : toolTriggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const panelWidth = rect.width;
  const panelMaxHeight = 224;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  const showAbove = spaceBelow < panelMaxHeight + 8 && spaceAbove > spaceBelow;
  const hOffset = Math.max(8, Math.min(rect.left, viewportWidth - panelWidth - 8));
  const style: Record<string, string> = {
    left: `${hOffset}px`,
    width: `${panelWidth}px`,
  };
  if (showAbove) {
    style.bottom = `${viewportHeight - rect.top + 4}px`;
  } else {
    style.top = `${rect.bottom + 4}px`;
  }
  if (type === 'skill') skillPanelStyle.value = style;
  else toolPanelStyle.value = style;
}

function toggleSkill(name: string) {
  const nextSkills = props.form.allowedSkills.includes(name)
    ? props.form.allowedSkills.filter((skill) => skill !== name)
    : [...props.form.allowedSkills, name];
  emit('update:form', cloneForm({ allowedSkills: nextSkills }));
}

function selectAllSkills() {
  emit('update:form', cloneForm({ allowedSkills: skillNames.value }));
}

function clearSkills() {
  emit('update:form', cloneForm({ allowedSkills: [] }));
}

function toggleTool(name: string) {
  const nextTools = props.form.allowedTools.includes(name)
    ? props.form.allowedTools.filter((tool) => tool !== name)
    : [...props.form.allowedTools, name];
  emit('update:form', cloneForm({ allowedTools: nextTools }));
}

function selectAllTools() {
  emit('update:form', cloneForm({ allowedTools: toolNames.value }));
}

function clearTools() {
  emit('update:form', cloneForm({ allowedTools: [] }));
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (!skillTriggerRef.value?.contains(target) && !skillPanelRef.value?.contains(target)) {
    skillDropdownOpen.value = false;
  }
  if (!toolTriggerRef.value?.contains(target) && !toolPanelRef.value?.contains(target)) {
    toolDropdownOpen.value = false;
  }
}

let resizeObserver: ResizeObserver | null = null;

function handleViewportChange() {
  if (skillDropdownOpen.value) positionPanel('skill');
  if (toolDropdownOpen.value) positionPanel('tool');
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, true);
  resizeObserver = new ResizeObserver(handleViewportChange);
  if (skillTriggerRef.value) resizeObserver.observe(skillTriggerRef.value);
  if (toolTriggerRef.value) resizeObserver.observe(toolTriggerRef.value);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
  resizeObserver?.disconnect();
});
</script>
