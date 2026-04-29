<template>
  <ConfigSectionEditor
    section-key="plugins"
    title="Plugins"
    subtitle="Manage configured plugins and their option payloads."
    editor-title="Plugin configuration"
    editor-subtitle="Edit the configured plugin list outside the main Config page."
  />
</template>

<script setup lang="ts">
import ConfigSectionEditor from '@/components/ConfigSectionEditor.vue';
</script>
