<template>
  <div class="responsive-table">
    <div v-if="!isMobile" class="table-container surface-panel">
      <table class="data-table" role="table" :aria-label="ariaLabel">
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.field"
              scope="col"
              :class="column.headerClass"
            >
              {{ column.header }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in data" :key="getRowKey(item, index)">
            <td v-for="column in columns" :key="column.field" :class="column.bodyClass">
              <slot :name="`cell-${column.field}`" :data="item" :value="getFieldValue(item, column.field)">
                {{ getFieldValue(item, column.field) }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="cards-container" role="list" :aria-label="ariaLabel">
      <div
        v-for="(item, index) in data"
        :key="getRowKey(item, index)"
        class="data-card"
        role="listitem"
      >
        <div
          v-for="column in columns"
          :key="column.field"
          class="card-row"
          :class="column.bodyClass"
        >
          <span class="card-label">{{ column.header }}</span>
          <span class="card-value">
            <slot :name="`cell-${column.field}`" :data="item" :value="getFieldValue(item, column.field)">
              {{ getFieldValue(item, column.field) }}
            </slot>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMediaQuery } from '../../composables/useMediaQuery'

export interface DataTableColumn {
  field: string
  header: string
  headerClass?: string
  bodyClass?: string
}

interface Props {
  data: any[]
  columns: DataTableColumn[]
  rowKey?: string
  ariaLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  rowKey: 'id',
  ariaLabel: '数据表格'
})

const { isMobile } = useMediaQuery(768)

const getRowKey = (item: any, index: number): string | number => {
  return item?.[props.rowKey] || index
}

const getFieldValue = (item: any, field: string): any => {
  return field.split('.').reduce((obj, key) => obj?.[key], item)
}
</script>

<style scoped>
.responsive-table {
  width: 100%;
  min-width: 0;
}

.table-container {
  width: 100%;
  overflow-x: auto;
  border-radius: var(--ui-radius-md);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 14px 16px;
  text-align: left;
  border-bottom: 1px solid var(--ui-border);
  vertical-align: top;
}

.data-table th {
  font-weight: 700;
  font-size: 0.83rem;
  color: var(--ui-text-muted);
  background: rgba(248, 250, 252, 0.72);
}

.data-table td {
  color: var(--ui-text-soft);
  overflow-wrap: anywhere;
}

.data-table tbody tr {
  transition: background-color 0.18s ease, transform 0.18s ease;
}

.data-table tbody tr:hover {
  background: rgba(239, 246, 255, 0.6);
}

.cards-container {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-3);
}

.data-card {
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  padding: var(--ui-space-4);
  box-shadow: var(--ui-shadow-sm);
  min-width: 0;
}

.card-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ui-space-3);
  padding: 10px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.card-row:last-child {
  border-bottom: none;
}

.card-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--ui-text-muted);
  flex: 0 0 auto;
  max-width: 45%;
}

.card-value {
  font-size: 0.92rem;
  color: var(--ui-text-soft);
  text-align: right;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .card-row {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .card-label {
    max-width: none;
  }

  .card-value {
    text-align: left;
  }
}
</style>
