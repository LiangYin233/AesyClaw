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
        <textarea v-model="form.systemPrompt" rows="8" class="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-4 text-sm leading-6 outline-none transition focus:border-primary/40" placeholder="请为该 Agent 定义行为边界、沟通风格与约束。" />
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
        <div class="grid gap-2">
          <label v-for="skill in skills" :key="skill.name" class="flex items-start gap-3 rounded-xl bg-surface-container-low px-4 py-3 text-sm">
            <input
              type="checkbox"
              :checked="form.allowedSkills.includes(skill.name)"
              class="mt-0.5 size-4 rounded border-outline-variant text-primary"
              @change="$emit('toggle-skill', skill.name)"
            />
            <div class="min-w-0">
              <p class="font-semibold text-on-surface">{{ skill.name }}</p>
              <p class="mt-1 text-xs leading-5 text-on-surface-variant">{{ skill.description || '无描述' }}</p>
            </div>
          </label>
        </div>
      </section>

      <section>
        <label class="mb-3 block text-[10px] font-mono uppercase tracking-[0.2em] text-outline">工具边界</label>
        <div class="grid gap-2">
          <label v-for="tool in tools" :key="tool.name" class="flex items-start gap-3 rounded-xl bg-surface-container-low px-4 py-3 text-sm">
            <input
              type="checkbox"
              :checked="form.allowedTools.includes(tool.name)"
              class="mt-0.5 size-4 rounded border-outline-variant text-primary"
              @change="$emit('toggle-tool', tool.name)"
            />
            <div class="min-w-0">
              <p class="font-semibold text-on-surface">{{ tool.name }}</p>
              <p class="mt-1 text-xs leading-5 text-on-surface-variant">{{ tool.description || '无描述' }}</p>
            </div>
          </label>
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
import AppIcon from '@/components/AppIcon.vue';
import type { AgentRole, AgentRoleConfig, SkillInfo, ToolInfo } from '@/lib/types';

defineProps<{
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
  'toggle-skill': [name: string];
  'toggle-tool': [name: string];
}>();
</script>
