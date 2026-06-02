<template>
  <div class="message-actions" @click.stop>
    <button
      type="button"
      class="copy-btn"
      aria-haspopup="menu"
      :aria-expanded="isMenuOpen"
      @click="toggleMenu"
    >
      {{ buttonLabel }}
    </button>
    <div v-if="isMenuOpen" class="copy-menu" role="menu">
      <button type="button" class="copy-menu-item" role="menuitem" @click="$emit('copy', 'rich')">
        &#x590D;&#x5236;&#x5BCC;&#x6587;&#x672C;
      </button>
      <button type="button" class="copy-menu-item" role="menuitem" @click="$emit('copy', 'raw')">
        &#x590D;&#x5236;&#x539F;&#x6587;
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  isMenuOpen: boolean;
  buttonLabel: string;
}>();

defineEmits<{
  'toggle-menu': [];
  copy: [mode: 'rich' | 'raw'];
}>();

function toggleMenu() {
  // Emit handled by parent
}
</script>

<style scoped>
.message-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  position: relative;
}

.copy-btn {
  min-width: 44px;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 11px;
  line-height: 1.5;
  transition: all var(--transition-fast);
  color: #7a705e;
  background: #f8f4ea;
  border: 1px solid #e6dece;
}

.copy-btn:hover {
  color: #4a4235;
  background: #f1eadc;
}

.copy-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 5;
  min-width: 112px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: #fff;
  border: 1px solid var(--color-border);
  box-shadow: 0 6px 18px rgba(20, 20, 19, 0.12);
}

.copy-menu-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-dark);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}

.copy-menu-item:hover {
  background: #f7f0ea;
}
</style>
