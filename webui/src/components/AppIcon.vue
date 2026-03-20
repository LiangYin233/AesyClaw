<template>
  <span class="inline-flex shrink-0 items-center justify-center" :class="sizeClass" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="size-full">
      <path v-for="(segment, index) in segments" :key="index" :d="segment" />
    </svg>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
});

const iconMap: Record<string, string[]> = {
  search: ['M11 18a7 7 0 1 1 0-14a7 7 0 0 1 0 14z', 'M20 20l-3.5-3.5'],
  panel: ['M4 5h16', 'M4 12h16', 'M4 19h16', 'M9 5v14'],
  palette: ['M12 3a9 9 0 1 0 0 18c1 0 1.5-.6 1.5-1.4 0-.5-.2-1-.2-1.6 0-1.1.9-2 2-2h1.2A4.5 4.5 0 0 0 21 11.5A8.5 8.5 0 0 0 12 3z', 'M7.5 12h.01', 'M9 8h.01', 'M14 8h.01', 'M16.5 12h.01'],
  history: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v5h5', 'M12 8v5l3 2'],
  deployed: ['M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z', 'M4 6.5l8 4.5 8-4.5', 'M12 11v11'],
  overview: ['M4 5h7v6H4z', 'M13 5h7v4h-7z', 'M13 11h7v8h-7z', 'M4 13h7v6H4z'],
  dialogue: ['M5 6h14v9H9l-4 3V6z', 'M9 10h6', 'M9 13h4'],
  sessions: ['M8 7h11', 'M8 12h11', 'M8 17h11', 'M4 7h.01', 'M4 12h.01', 'M4 17h.01'],
  memory: ['M7 4h10v16l-5-3-5 3V4z'],
  agents: ['M12 10a3 3 0 1 0 0-6a3 3 0 0 0 0 6z', 'M6 20a6 6 0 0 1 12 0', 'M18 10a2.5 2.5 0 1 0 0-5', 'M19.5 20a4.5 4.5 0 0 0-3.5-4.4', 'M6 10a2.5 2.5 0 1 1 0-5', 'M4.5 20a4.5 4.5 0 0 1 3.5-4.4'],
  skills: ['M12 3l2.7 5.5 6.1.9-4.4 4.3 1.1 6.1L12 17l-5.5 2.8 1.1-6.1L3.2 9.4l6.1-.9L12 3z'],
  tools: ['M14.5 6.5l3 3', 'M11 10l6.5-6.5', 'M7 14l-4 4v3h3l4-4', 'M13 8l3 3'],
  plugins: ['M8 7v5', 'M16 7v5', 'M12 3v8', 'M9 12h6v3a3 3 0 0 1-6 0v-3z'],
  cron: ['M12 7v5l3 2', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
  mcp: ['M5 4h14v6H5z', 'M5 14h14v6H5z', 'M8 7h.01', 'M8 17h.01', 'M19 7h.01', 'M19 17h.01'],
  observability: ['M4 18l5-6 4 3 7-9', 'M4 5v13h16'],
  settings: ['M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z', 'M19 12l2 1-2 4-2-1a7.6 7.6 0 0 1-1.7 1l-.3 2.2H9l-.3-2.2a7.6 7.6 0 0 1-1.7-1L5 17l-2-4 2-1a7.6 7.6 0 0 1 0-2L3 9l2-4 2 1a7.6 7.6 0 0 1 1.7-1L9 2.8h6l.3 2.2a7.6 7.6 0 0 1 1.7 1L19 5l2 4-2 1a7.6 7.6 0 0 1 0 2z'],
  refresh: ['M20 4v6h-6', 'M4 20v-6h6', 'M20 10a8 8 0 0 0-13.7-4.7L4 7', 'M4 14a8 8 0 0 0 13.7 4.7L20 17'],
  plus: ['M12 5v14', 'M5 12h14'],
  rocket: ['M5 19c1.6-2.7 4.3-4.9 7.2-5.9 1-3 3.2-5.6 5.9-7.2l1.9 1.9c-1.6 2.7-4.2 4.9-7.2 5.9-1 3-3.2 5.6-5.9 7.2L5 19z', 'M14 6l4 4', 'M7 17l-2 5 5-2'],
  warning: ['M12 3l9 16H3L12 3z', 'M12 9v4', 'M12 16h.01'],
  robot: ['M9 4h6', 'M12 2v2', 'M7 8h10v8H7z', 'M9.5 11h.01', 'M14.5 11h.01', 'M9 16h6', 'M7 12H5', 'M19 12h-2'],
  eye: ['M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  moon: ['M20 14.5A7.5 7.5 0 1 1 9.5 4 6.2 6.2 0 0 0 20 14.5z'],
  sun: ['M12 4V2', 'M12 22v-2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4', 'M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z'],
  arrowRight: ['M5 12h14', 'M13 5l7 7-7 7'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  delete: ['M5 7h14', 'M9 7V4h6v3', 'M8 7l1 12h6l1-12'],
  save: ['M6 4h10l4 4v12H4V4z', 'M8 4v6h8V4', 'M9 20v-6h6v6'],
  edit: ['M4 20l4.5-1 9-9-3.5-3.5-9 9L4 20z', 'M13.5 5.5l3.5 3.5'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
};

const segments = computed(() => iconMap[props.name] ?? iconMap.overview);
const sizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'size-4';
    case 'lg':
      return 'size-6';
    case 'xl':
      return 'size-7';
    default:
      return 'size-5';
  }
});
</script>
