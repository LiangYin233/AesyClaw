<template>
  <div ref="menuRef" v-show="visible" class="command-menu" @mouseleave="$emit('close')">
    <div
      v-for="(item, i) in items"
      :key="item.name"
      class="command-item"
      :class="{ selected: i === selectedIndex }"
      @click="$emit('select', i)"
      @mouseenter="$emit('highlight', i)"
    >
      <span class="cmd-name">/{{ item.name }}</span>
      <span class="cmd-desc">{{ item.description }}</span>
    </div>
    <div v-if="items.length === 0" class="command-empty">No matching commands</div>
  </div>
</template>

<script setup lang="ts">
import { watch, nextTick, ref } from 'vue';

const props = defineProps<{
  items: Array<{ name: string; description: string }>;
  selectedIndex: number;
  visible: boolean;
}>();

const emit = defineEmits<{
  select: [index: number];
  highlight: [index: number];
  close: [];
}>();

const menuRef = ref<HTMLElement | null>(null);

watch(() => props.selectedIndex, () => {
  void nextTick(() => {
    const el = menuRef.value?.querySelector('.command-item.selected');
    el?.scrollIntoView({ block: 'nearest' });
  });
});
</script>

<style scoped>
.command-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  z-index: 50;
  margin: 0 0 4px;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 -4px 16px rgba(20, 20, 19, 0.1);
  max-height: 280px;
  overflow-y: auto;
}

.command-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.4;
  color: var(--color-dark);
  transition: background var(--transition-fast);
}

.command-item:hover,
.command-item.selected {
  background: #f7f0ea;
}

.cmd-name {
  font-family: var(--font-heading);
  font-weight: 500;
  color: var(--color-primary);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 100px;
}

.cmd-desc {
  color: var(--color-mid-gray);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-empty {
  padding: 12px 14px;
  color: var(--color-mid-gray);
  font-family: var(--font-body);
  font-size: 12px;
  font-style: italic;
  text-align: center;
}
</style>
