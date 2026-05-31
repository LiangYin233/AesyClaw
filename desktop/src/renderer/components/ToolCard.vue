<template>
  <div class="tool-block">
    <div
      class="tool-card"
      :class="{ expanded: toolCall.expanded, error: toolCall.status === 'error' }"
    >
      <div class="tool-card-header" @click="toolCall.expanded = !toolCall.expanded">
        <span class="tool-arrow">{{ toolCall.expanded ? '&#9662;' : '&#9658;' }}</span>
        <span class="tool-status-dot" :class="toolCall.status"></span>
        <span class="tool-name">{{ toolCall.toolName }}</span>
      </div>
      <div v-if="toolCall.expanded" class="tool-card-body">
        <div class="tool-section tool-section--result">
          <span class="tool-label">Args</span>
          <pre>{{ JSON.stringify(toolCall.args, null, 2) }}</pre>
        </div>
        <div v-if="toolCall.result !== undefined" class="tool-section tool-section--result">
          <span class="tool-label">Result</span>
          <pre>{{ formatToolResult(toolCall.result) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCallState } from '../types/chat';

defineProps<{
  toolCall: ToolCallState;
}>();

function formatToolResult(result: unknown): string {
  let text: string;
  if (typeof result === 'string') {
    text = result;
  } else {
    text = JSON.stringify(result, null, 2);
  }
  if (text.length > 5000) {
    return text.slice(0, 5000) + '\n\n... (truncated, ' + text.length + ' characters)';
  }
  return text;
}
</script>

<style scoped>
.tool-block {
  display: flex;
}

.tool-card {
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-surface);
  max-width: 85%;
}

.tool-card.error {
  border-color: rgba(196, 91, 91, 0.4);
}

.tool-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-mid-gray);
  transition: background var(--transition-fast);
  user-select: none;
  -webkit-user-select: none;
}

.tool-card-header:hover {
  background: rgba(20, 20, 19, 0.03);
}

.tool-arrow {
  font-size: 10px;
  width: 14px;
  color: var(--color-mid-gray);
}

.tool-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.tool-status-dot.running {
  background: var(--color-warning);
}

.tool-status-dot.done {
  background: var(--color-accent-green);
}

.tool-status-dot.error {
  background: var(--color-danger);
}

.tool-card-body {
  padding: 10px 12px;
  border-top: 1px solid var(--color-border);
}

.tool-section {
  margin-bottom: 10px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.tool-label {
  font-family: var(--font-heading);
  font-size: 10px;
  font-weight: 600;
  color: var(--color-mid-gray);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: block;
  margin-bottom: 4px;
}

.tool-section pre {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 12px;
  color: var(--color-dark);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow-y: auto;
  margin: 0;
  line-height: 1.5;
}

.tool-section--result {
  background: rgba(20, 20, 19, 0.02);
  border-radius: 4px;
  padding: 8px;
  margin-left: 0;
  margin-right: 0;
}

.tool-section--result .tool-label {
  margin-bottom: 6px;
}

.tool-section--result pre {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.7;
  max-height: 240px;
  color: #3d3a34;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 4px 0;
  margin: 0;
}
</style>
