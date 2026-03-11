<template>
  <Card v-if="metricNames.length > 0" class="metrics-list-card">
    <template #title>
      <div class="metrics-header">
        <span>所有指标</span>
        <InputText v-model="searchQueryModel" placeholder="搜索指标..." class="search-input">
          <template #prefix><i class="pi pi-search"></i></template>
        </InputText>
      </div>
    </template>
    <template #content>
      <div v-if="filteredMetrics.length > 0" class="metrics-list">
        <div v-for="name in filteredMetrics" :key="name" class="metric-item" @click="$emit('view-details', name)">
          <div class="metric-item-name">{{ name }}</div>
          <i class="pi pi-chevron-right"></i>
        </div>
      </div>
      <Message v-else severity="info" :closable="false">
        {{ searchQuery ? '未找到匹配的指标' : '暂无指标数据' }}
      </Message>
    </template>
  </Card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'

const props = defineProps<{
  metricNames: string[]
  filteredMetrics: string[]
  searchQuery: string
}>()

const emit = defineEmits<{ 'update:searchQuery': [value: string], 'view-details': [name: string] }>()
const searchQueryModel = computed({
  get: () => props.searchQuery,
  set: (value: string) => emit('update:searchQuery', value)
})
</script>

<style scoped>
.metrics-list-card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  margin-bottom: 24px;
}

.metrics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.search-input {
  width: 280px;
}

.metrics-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metric-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  cursor: pointer;
  background: #ffffff;
  transition: all 0.2s ease;
}

.metric-item:hover {
  border-color: #93c5fd;
  background: #f8fbff;
}

.metric-item-name {
  font-size: 14px;
  color: #1e293b;
  font-weight: 500;
}

@media (max-width: 640px) {
  .metrics-header {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input {
    width: 100%;
  }
}
</style>
