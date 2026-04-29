<template>
  <ConfigSectionEditor
    section-key="channels"
    title="Channels"
    subtitle="Configure channel adapters and their runtime options."
    editor-title="Channel configuration"
    editor-subtitle="Edit adapter-specific settings outside the main Config page."
  />
</template>

<script setup lang="ts">
import ConfigSectionEditor from '@/components/ConfigSectionEditor.vue';
</script>
