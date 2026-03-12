<template>
  <div class="responsive-table">
    <div v-if="!isMobile" class="table-container">
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
  border-radius: 12px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
  vertical-align: top;
}

.data-table td {
  overflow-wrap: anywhere;
}

.data-table th {
  font-weight: 600;
  color: #64748b;
  font-size: 14px;
  background: #f8fafc;
}

.data-table tbody tr {
  transition: background-color 0.2s;
}

.data-table tbody tr:hover {
  background: #f8fafc;
}

.cards-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.data-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  min-width: 0;
}

.card-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid #f1f5f9;
}

.card-row:last-child {
  border-bottom: none;
}

.card-label {
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  flex: 0 0 auto;
  max-width: 45%;
}

.card-value {
  font-size: 14px;
  color: #1e293b;
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

@media (prefers-color-scheme: dark) {
  .data-table th {
    color: #94a3b8;
    background: #1e293b;
  }

  .data-table td {
    border-color: #334155;
  }

  .data-table tbody tr:hover {
    background: #1e293b;
  }

  .data-card {
    background: #1e293b;
    border-color: #334155;
  }

  .card-row {
    border-color: #334155;
  }

  .card-label {
    color: #94a3b8;
  }

  .card-value {
    color: #f1f5f9;
  }
}
</style>
