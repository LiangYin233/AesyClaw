<template>
  <span class="ui-icon" :class="sizeClass" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path v-for="(segment, index) in iconSegments" :key="index" :d="segment" />
    </svg>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  name: string
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md'
})

const ICONS: Record<string, string[]> = {
  bars: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  times: ['M6 6l12 12', 'M18 6L6 18'],
  refresh: ['M20 4v6h-6', 'M4 20v-6h6', 'M20 10a8 8 0 0 0-13.66-4.66L4 7', 'M4 14a8 8 0 0 0 13.66 4.66L20 17'],
  plus: ['M12 5v14', 'M5 12h14'],
  save: ['M6 4h10l4 4v12H4V4z', 'M8 4v6h8V4', 'M9 20v-6h6v6'],
  trash: ['M5 7h14', 'M9 7V4h6v3', 'M8 7l1 12h6l1-12'],
  pencil: ['M4 20l4.5-1 9-9-3.5-3.5-9 9L4 20z', 'M13.5 5.5l3.5 3.5'],
  home: ['M3 11.5L12 4l9 7.5', 'M6 10v10h12V10'],
  comments: ['M5 6h14v9H9l-4 3V6z', 'M9 10h6', 'M9 13h4'],
  list: ['M8 7h11', 'M8 12h11', 'M8 17h11', 'M4 7h.01', 'M4 12h.01', 'M4 17h.01'],
  bookmark: ['M7 4h10v16l-5-3-5 3V4z'],
  users: ['M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-1A3.5 3.5 0 0 0 8 17.5V19', 'M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M18.5 19v-1a3 3 0 0 0-2.5-2.95', 'M16 4.75A3 3 0 0 1 16 10.25'],
  clock: ['M12 7v5l3 2', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
  box: ['M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z', 'M4 6.5l8 4.5 8-4.5', 'M12 11v11'],
  plug: ['M8 7v5', 'M16 7v5', 'M12 3v8', 'M9 12h6v3a3 3 0 0 1-6 0v-3z'],
  server: ['M5 4h14v6H5z', 'M5 14h14v6H5z', 'M8 7h.01', 'M8 17h.01', 'M19 7h.01', 'M19 17h.01'],
  star: ['M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.1L12 17l-5.6 3 1.1-6.1L3 9.7l6.2-.9L12 3z'],
  file: ['M7 3h7l5 5v13H7V3z', 'M14 3v5h5'],
  cog: ['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M19 12l2 1-2 4-2-1a7.6 7.6 0 0 1-1.7 1l-.3 2.2H9l-.3-2.2a7.6 7.6 0 0 1-1.7-1L5 17l-2-4 2-1a7.6 7.6 0 0 1 0-2L3 9l2-4 2 1a7.6 7.6 0 0 1 1.7-1L9 2.8h6l.3 2.2a7.6 7.6 0 0 1 1.7 1L19 5l2 4-2 1a7.6 7.6 0 0 1 0 2z'],
  eye: ['M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  send: ['M3 11.5L21 3l-4.5 18-5.5-7-8-2.5z', 'M10.5 14L21 3'],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5 11h14v10H5z', 'M12 15v2'],
  warning: ['M12 3l9 16H3L12 3z', 'M12 9v4', 'M12 16h.01'],
  info: ['M12 8h.01', 'M11 12h1v5h1', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
  play: ['M8 6l10 6-10 6V6z'],
  pause: ['M9 6h2v12H9z', 'M13 6h2v12h-2z'],
  stop: ['M7 7h10v10H7z'],
  check: ['M5 13l4 4L19 7'],
  history: ['M4 12a8 8 0 1 0 2.34-5.66', 'M4 4v5h5', 'M12 8v5l3 2'],
  checksquare: ['M5 5h14v14H5z', 'M8 12l2.5 2.5L16 9'],
  circlefill: ['M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0'],
  robot: ['M9 4h6', 'M12 2v2', 'M7 8h10v8H7z', 'M9.5 11h.01', 'M14.5 11h.01', 'M9 16h6', 'M7 12H5', 'M19 12h-2'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M5 20a7 7 0 0 1 14 0'],
  inbox: ['M4 5h16v11H4z', 'M4 14h5l2 3h2l2-3h5'],
  search: ['M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z', 'M20 20l-3.5-3.5']
}

const normalizedName = computed(() => {
  return props.name
    .replace('pi pi-', '')
    .replace('pi-', '')
    .replace(/-/g, '')
    .toLowerCase()
})

const iconSegments = computed(() => ICONS[normalizedName.value] ?? ICONS.info)

const sizeClass = computed(() => `ui-icon--${props.size}`)
</script>

<style scoped>
.ui-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ui-icon svg {
  width: 1em;
  height: 1em;
}

.ui-icon--sm {
  font-size: 0.9rem;
}

.ui-icon--md {
  font-size: 1rem;
}

.ui-icon--lg {
  font-size: 1.2rem;
}
</style>
