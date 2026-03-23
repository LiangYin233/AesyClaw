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
            <input v-model="form.name" :disabled="drawerMode === 'edit'" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition focus:border-primary/40 disabled:cursor-not-allowed disabled:opacity-70" placeholder="agent 名称" />
          </div>
          <div>
            <label class="mb-2 block text-xs font-semibold text-on-surface">描述</label>
            <input v-model="form.description" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition focus:border-primary/40" placeholder="用于说明该角色的职责" />
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <label class="mb-2 block text-xs font-semibold text-on-surface">Provider</label>
              <select v-model="form.provider" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition focus:border-primary/40">
                <option value="">请选择提供商</option>
                <option v-for="option in providerOptions" :key="option" :value="option">{{ option }}</option>
              </select>
            </div>
            <div>
              <label class="mb-2 block text-xs font-semibold text-on-surface">Model</label>
              <input v-model="form.model" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition focus:border-primary/40" placeholder="模型名称" />
            </div>
          </div>
        </div>
      </section>

      <section>
        <label class="mb-3 block text-[10px] font-mono uppercase tracking-[0.2em] text-outline">系统提示词</label>
        <textarea v-model="form.systemPrompt" rows="8" class="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-4 text-sm leading-6 outline-none transition focus:border-primary/40" placeholder="请输入系统提示词，定义 Agent 的行为方式。" />
      </section>

      <section>
        <label class="mb-3 block text-[10px] font-mono uppercase tracking-[0.2em] text-outline">能力开关</label>
        <div class="grid gap-3">
          <label class="flex items-center gap-3 rounded-xl bg-surface-container-low px-4 py-3">
            <input v-model="form.vision" type="checkbox" class="size-4 rounded border-outline-variant text-primary" />
            <span class="text-sm font-medium text-on-surface">启用视觉识别</span>
          </label>
          <label class="flex items-center gap-3 rounded-xl bg-surface-container-low px-4 py-3">
            <input v-model="form.reasoning" type="checkbox" class="size-4 rounded border-outline-variant text-primary" />
            <span class="text-sm font-medium text-on-surface">启用推理模式</span>
          </label>
        </div>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label class="mb-2 block text-xs font-semibold text-on-surface">视觉提供商</label>
            <select v-model="form.visionProvider" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition focus:border-primary/40">
              <option value="">请选择视觉提供商</option>
              <option v-for="option in providerOptions" :key="option" :value="option">{{ option }}</option>
            </select>
          </div>
          <div>
            <label class="mb-2 block text-xs font-semibold text-on-surface">视觉模型</label>
            <input v-model="form.visionModel" class="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition focus:border-primary/40" placeholder="视觉模型名称" />
          </div>
        </div>
      </section>

      <section>
        <label class="mb-3 block text-[10px] font-mono uppercase tracking-[0.2em] text-outline">技能边界</label>
        <div ref="skillTriggerRef">
          <button
            class="flex w-full items-center justify-between rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition hover:border-primary/30"
            type="button"
            @click="toggleDropdown('skill')"
          >
            <span :class="form.allowedSkills.length ? '' : 'text-outline'">
              {{ form.allowedSkills.length ? `已选 ${form.allowedSkills.length} 项` : '请选择技能' }}
            </span>
            <svg class="size-4 text-outline transition" :class="skillDropdownOpen ? 'rotate-180' : ''" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" /></svg>
          </button>
        </div>
        <Teleport to="body">
          <div v-if="skillDropdownOpen" ref="skillPanelRef" class="fixed z-[999] max-h-56 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest py-0 shadow-xl" :style="skillPanelStyle">
            <div class="sticky top-0 z-10 flex items-center justify-between border-b border-outline-variant/15 bg-surface-container-lowest px-4 py-2">
              <span class="text-[11px] font-bold tracking-[0.08em] text-outline">技能选择</span>
              <div class="flex items-center gap-3 text-[11px] font-bold">
                <button class="text-primary transition hover:opacity-80" type="button" @click="selectAllSkills">全选</button>
                <button class="text-outline transition hover:text-on-surface" type="button" @click="clearSkills">清空</button>
              </div>
            </div>
            <label
              v-for="skill in skills"
              :key="skill.name"
              class="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-surface-container-high"
            >
              <input
                type="checkbox"
                :checked="form.allowedSkills.includes(skill.name)"
                class="size-4 rounded border-outline-variant accent-primary"
                @change="toggleSkill(skill.name)"
              />
              <span class="text-on-surface">{{ skill.name }}</span>
            </label>
            <div v-if="!skills.length" class="px-4 py-3 text-xs text-outline">暂无可选技能</div>
          </div>
        </Teleport>
      </section>

      <section>
        <label class="mb-3 block text-[10px] font-mono uppercase tracking-[0.2em] text-outline">工具边界</label>
        <div ref="toolTriggerRef">
          <button
            class="flex w-full items-center justify-between rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none transition hover:border-primary/30"
            type="button"
            @click="toggleDropdown('tool')"
          >
            <span :class="form.allowedTools.length ? '' : 'text-outline'">
              {{ form.allowedTools.length ? `已选 ${form.allowedTools.length} 项` : '请选择工具' }}
            </span>
            <svg class="size-4 text-outline transition" :class="toolDropdownOpen ? 'rotate-180' : ''" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" /></svg>
          </button>
        </div>
        <Teleport to="body">
          <div v-if="toolDropdownOpen" ref="toolPanelRef" class="fixed z-[999] max-h-56 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-lowest py-0 shadow-xl" :style="toolPanelStyle">
            <div class="sticky top-0 z-10 flex items-center justify-between border-b border-outline-variant/15 bg-surface-container-lowest px-4 py-2">
              <span class="text-[11px] font-bold tracking-[0.08em] text-outline">工具选择</span>
              <div class="flex items-center gap-3 text-[11px] font-bold">
                <button class="text-primary transition hover:opacity-80" type="button" @click="selectAllTools">全选</button>
                <button class="text-outline transition hover:text-on-surface" type="button" @click="clearTools">清空</button>
              </div>
            </div>
            <label
              v-for="tool in tools"
              :key="tool.name"
              class="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-surface-container-high"
            >
              <input
                type="checkbox"
                :checked="form.allowedTools.includes(tool.name)"
                class="size-4 rounded border-outline-variant accent-primary"
                @change="toggleTool(tool.name)"
              />
              <span class="text-on-surface">{{ tool.name }}</span>
            </label>
            <div v-if="!tools.length" class="px-4 py-3 text-xs text-outline">暂无可选工具</div>
          </div>
        </Teleport>
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

defineEmits<{
  close: [];
  save: [];
  delete: [];
}>();

const skillDropdownOpen = ref(false);
const toolDropdownOpen = ref(false);
const skillTriggerRef = useTemplateRef('skillTriggerRef');
const toolTriggerRef = useTemplateRef('toolTriggerRef');
const skillPanelRef = useTemplateRef('skillPanelRef');
const toolPanelRef = useTemplateRef('toolPanelRef');
const skillPanelStyle = ref<Record<string, string>>({});
const toolPanelStyle = ref<Record<string, string>>({});
const skillNames = computed(() => props.skills.map((skill) => skill.name));
const toolNames = computed(() => props.tools.map((tool) => tool.name));

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
  const panelHeight = 192;
  const spaceBelow = window.innerHeight - rect.bottom;
  const showAbove = spaceBelow < panelHeight + 8;
  const style = {
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    ...(showAbove ? { bottom: `${window.innerHeight - rect.top + 4}px` } : { top: `${rect.bottom + 4}px` }),
  };
  if (type === 'skill') skillPanelStyle.value = style;
  else toolPanelStyle.value = style;
}

function toggleSkill(name: string) {
  const idx = props.form.allowedSkills.indexOf(name);
  if (idx >= 0) props.form.allowedSkills.splice(idx, 1);
  else props.form.allowedSkills.push(name);
}

function selectAllSkills() {
  props.form.allowedSkills.splice(0, props.form.allowedSkills.length, ...skillNames.value);
}

function clearSkills() {
  props.form.allowedSkills.splice(0, props.form.allowedSkills.length);
}

function toggleTool(name: string) {
  const idx = props.form.allowedTools.indexOf(name);
  if (idx >= 0) props.form.allowedTools.splice(idx, 1);
  else props.form.allowedTools.push(name);
}

function selectAllTools() {
  props.form.allowedTools.splice(0, props.form.allowedTools.length, ...toolNames.value);
}

function clearTools() {
  props.form.allowedTools.splice(0, props.form.allowedTools.length);
}

function positionOpenPanels() {
  if (skillDropdownOpen.value) {
    positionPanel('skill');
  }
  if (toolDropdownOpen.value) {
    positionPanel('tool');
  }
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  const inSkillTrigger = skillTriggerRef.value?.contains(target);
  const inToolTrigger = toolTriggerRef.value?.contains(target);
  const inSkillPanel = skillPanelRef.value?.contains(target);
  const inToolPanel = toolPanelRef.value?.contains(target);
  if (!inSkillTrigger && !inSkillPanel) skillDropdownOpen.value = false;
  if (!inToolTrigger && !inToolPanel) toolDropdownOpen.value = false;
}

function handleViewportChange() {
  positionOpenPanels();
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
});
</script>
