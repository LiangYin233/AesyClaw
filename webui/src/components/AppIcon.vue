<template>
  <span class="inline-flex shrink-0 items-center justify-center" :class="sizeClass" aria-hidden="true">
    <component :is="iconComponent" class="size-full" />
  </span>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';
import {
  ArrowPathIcon,
  ArrowRightIcon,
  BookmarkIcon,
  CalendarIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  ListBulletIcon,
  MoonIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PuzzlePieceIcon,
  RocketLaunchIcon,
  ServerStackIcon,
  Squares2X2Icon,
  StarIcon,
  SunIcon,
  TableCellsIcon,
  TrashIcon,
  UserGroupIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline';
import { Bars3Icon } from '@heroicons/vue/24/solid';

interface Props {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
});

const iconMap: Record<string, Component> = {
  search: MagnifyingGlassIcon,
  panel: TableCellsIcon,
  history: ClockIcon,
  deployed: RocketLaunchIcon,
  overview: Squares2X2Icon,
  dialogue: ChatBubbleLeftRightIcon,
  sessions: ListBulletIcon,
  memory: BookmarkIcon,
  agents: UsersIcon,
  skills: StarIcon,
  tools: WrenchScrewdriverIcon,
  plugins: PuzzlePieceIcon,
  cron: CalendarIcon,
  mcp: ServerStackIcon,
  observability: ChartBarIcon,
  settings: Cog6ToothIcon,
  refresh: ArrowPathIcon,
  plus: PlusIcon,
  rocket: RocketLaunchIcon,
  warning: ExclamationTriangleIcon,
  robot: CpuChipIcon,
  eye: EyeIcon,
  moon: MoonIcon,
  sun: SunIcon,
  arrowRight: ArrowRightIcon,
  close: XMarkIcon,
  delete: TrashIcon,
  save: DocumentArrowDownIcon,
  menu: Bars3Icon,
};

const iconComponent = computed(() => iconMap[props.name] ?? Squares2X2Icon);

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
