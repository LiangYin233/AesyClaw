<template>
  <div
    class="chat-input-wrapper"
    @dragover.prevent="handleDragOver"
    @dragenter.prevent="handleDragEnter"
    @dragleave="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <!-- Drag-and-drop overlay -->
    <div v-if="isDragging" class="drag-overlay" aria-hidden="true">
      <div class="drag-overlay-content">
        <svg
          class="drag-overlay-icon"
          viewBox="0 0 48 48"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M24 18v14" />
          <path d="M18 26l6 6 6-6" />
          <path d="M30 10h.01" />
          <path d="M28 4H12a2 2 0 0 0-2 2v28a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V14l-8-10z" />
          <path d="M28 4v10h10" />
        </svg>
        <span class="drag-overlay-text"
          >&#x91CA;&#x653E;&#x6587;&#x4EF6;&#x4EE5;&#x9644;&#x52A0;&#x5230;&#x6D88;&#x606F;</span
        >
      </div>
    </div>

    <!-- Input -->
    <div class="input-area">
      <input
        ref="fileInputRef"
        type="file"
        multiple
        class="file-input"
        @change="handleFileSelect"
      />
      <div class="input-stack">
        <div v-if="selectedFiles.length" class="selected-files">
          <span
            v-for="(file, index) in selectedFiles"
            :key="`${file.name}-${index}`"
            class="attachment-chip pending"
          >
            <svg
              class="attachment-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              v-if="attachmentIcon(file.type) === 'image'"
            >
              <rect x="2" y="2" width="12" height="12" rx="1.5" />
              <circle cx="6" cy="6" r="1.5" />
              <path d="M2 11l3-3 2 2 4-4 3 3" />
            </svg>
            <svg
              class="attachment-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              v-else-if="attachmentIcon(file.type) === 'audio'"
            >
              <path d="M5 2v10" />
              <path d="M5 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
              <path d="M5 2l7 2v8" />
              <path d="M12 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
            </svg>
            <svg
              class="attachment-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              v-else-if="attachmentIcon(file.type) === 'video'"
            >
              <rect x="1" y="3" width="14" height="10" rx="1.5" />
              <path d="M11 7l3-2v6l-3-2" />
            </svg>
            <svg
              class="attachment-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              v-else
            >
              <path d="M5 1h4l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
              <path d="M9 1v4h4" />
            </svg>
            {{ file.name }}
            <button type="button" class="remove-file-btn" @click="removeSelectedFile(index)">
              &times;
            </button>
          </span>
        </div>
        <CommandMenu
          :items="filteredCommands"
          :selectedIndex="menuIndex"
          :visible="showMenu"
          @select="onSelect"
          @highlight="menuIndex = $event"
          @close="showMenu = false"
        />
        <div class="input-row">
          <button
            type="button"
            class="attach-btn"
            :disabled="streaming"
            title="Attach image, audio, video, or file"
            @click="openFilePicker"
          >
            +
          </button>
          <textarea
            v-model="inputText"
            class="chat-input"
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            rows="1"
            :disabled="streaming"
            @keydown="handleKeydown"
            @paste="handlePaste"
          ></textarea>
          <button v-if="streaming" class="stop-btn" @click="handleCancel">Stop</button>
          <button v-else class="send-btn" :disabled="!canSend" @click="handleSend">Send</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { DesktopUploadFile } from '../../preload/index';
import CommandMenu from './CommandMenu.vue';
interface ChatAttachment {
  name: string;
  mime: string;
  size: number;
}

const props = defineProps<{
  streaming: boolean;
  commands: Array<{ name: string; description: string }>;
}>();

const emit = defineEmits<{
  send: [text: string, files: DesktopUploadFile[], attachments: ChatAttachment[]];
  cancel: [];
}>();

const inputText = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFiles = ref<File[]>([]);
const isDragging = ref(false);
// ─── 命令补全 ──────────────────────────────────────────────

const showMenu = ref(false);
const menuIndex = ref(0);

// 纯 computed：只做数据转换，不做副作用
const filteredCommands = computed(() => {
  if (props.streaming || !inputText.value.startsWith('/')) return [];
  return props.commands.filter((c) => c.name.startsWith(inputText.value.slice(1))).slice(0, 8);
});

// showMenu 由 filteredCommands 派生，同样无副作用
watch(filteredCommands, (list) => {
  showMenu.value = list.length > 0;
  menuIndex.value = 0;
});

function applyCompletion() {
  const cmd = filteredCommands.value[menuIndex.value];
  if (!cmd) return;
  // / 一定在位置 0（watch 中已通过 startsWith 校验）
  inputText.value = '/' + cmd.name + ' ';
  showMenu.value = false;
}

function onSelect(index: number) {
  menuIndex.value = index;
  applyCompletion();
}

function handleKeydown(e: KeyboardEvent) {
  if (showMenu.value) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        menuIndex.value = Math.min(menuIndex.value + 1, filteredCommands.value.length - 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        menuIndex.value = Math.max(menuIndex.value - 1, 0);
        return;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        applyCompletion();
        return;
      case 'Escape':
        e.preventDefault();
        showMenu.value = false;
        return;
    }
  }

  // 不显示菜单时，Enter 发送
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    handleSend();
  }
}

let dragEnterCounter = 0;

const canSend = computed(() => inputText.value.trim().length > 0 || selectedFiles.value.length > 0);

function openFilePicker() {
  fileInputRef.value?.click();
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  selectedFiles.value = [...selectedFiles.value, ...files];
  input.value = '';
}

function removeSelectedFile(index: number) {
  selectedFiles.value.splice(index, 1);
}

function handleDragEnter(_event: DragEvent) {
  if (props.streaming) return;
  dragEnterCounter++;
  isDragging.value = true;
}

function handleDragOver(event: DragEvent) {
  if (props.streaming) return;
  event.dataTransfer!.dropEffect = 'copy';
}

function handleDragLeave(_event: DragEvent) {
  dragEnterCounter--;
  if (dragEnterCounter <= 0) {
    dragEnterCounter = 0;
    isDragging.value = false;
  }
}

function handleDrop(event: DragEvent) {
  dragEnterCounter = 0;
  isDragging.value = false;
  if (props.streaming) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length > 0) {
    selectedFiles.value = [...selectedFiles.value, ...files];
  }
}

function handlePaste(event: ClipboardEvent) {
  if (props.streaming) {
    event.preventDefault();
    return;
  }

  const clipFiles = Array.from(event.clipboardData?.files ?? []);
  if (clipFiles.length > 0) {
    event.preventDefault();
    selectedFiles.value = [...selectedFiles.value, ...clipFiles];
    return;
  }

  if (!event.clipboardData) return;
  const imageItems = Array.from(event.clipboardData.items).filter((item) =>
    item.type.startsWith('image/'),
  );
  if (imageItems.length > 0) {
    event.preventDefault();
    void Promise.all(
      imageItems.map(async (item) => {
        const blob = item.getAsFile();
        if (blob) {
          const ext = item.type.split('/')[1] ?? 'png';
          const file = new File([blob], `clipboard-${Date.now()}.${ext}`, {
            type: item.type,
          });
          selectedFiles.value = [...selectedFiles.value, file];
        }
      }),
    );
  }
}

async function handleSend() {
  const text = inputText.value.trim();
  if (!canSend.value || props.streaming) return;

  const files = await Promise.all(selectedFiles.value.map(fileToUpload));
  const attachments = selectedFiles.value.map((file) => ({
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  }));
  emit('send', text, files, attachments);
  inputText.value = '';
  selectedFiles.value = [];
  if (fileInputRef.value) fileInputRef.value.value = '';
}

function handleCancel() {
  emit('cancel');
}

async function fileToUpload(file: File): Promise<DesktopUploadFile> {
  return {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    data: await file.arrayBuffer(),
  };
}

function attachmentIcon(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}
</script>

<style scoped>
.chat-input-wrapper {
  position: relative;
  flex-shrink: 0;
}

/* ── Drag overlay ────────────────────── */
.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(253, 251, 248, 0.85);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 2px dashed var(--color-primary);
  border-radius: var(--radius);
  margin: 8px;
  pointer-events: none;
}

.drag-overlay-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
}

.drag-overlay-icon {
  width: 48px;
  height: 48px;
  color: var(--color-primary);
}

.drag-overlay-text {
  font-family: var(--font-heading);
  font-size: 15px;
  font-weight: 500;
  color: var(--color-primary);
}

/* ── Input ───────────────────────────── */
.input-area {
  padding: 16px 24px;
  border-top: 1px solid var(--color-border);
  background: #fdfbf9;
}

.file-input {
  display: none;
}

.input-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.chat-input {
  flex: 1;
  min-height: 42px;
  max-height: 160px;
  padding: 10px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--color-dark);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  outline: none;
  resize: vertical;
  transition: border var(--transition-fast);
}

.chat-input:focus {
  border-color: var(--color-primary);
}

.chat-input:disabled {
  background: #f5f3ef;
}

.selected-files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 260px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-family: var(--font-heading);
  font-size: 11px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
}

.attachment-chip.pending {
  background: #f7f0ea;
  color: var(--color-dark);
  border: 1px solid var(--color-border);
}

.attachment-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: currentColor;
}

.remove-file-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(20, 20, 19, 0.08);
  color: var(--color-mid-gray);
  cursor: pointer;
}

.remove-file-btn:hover {
  color: var(--color-danger);
}

.attach-btn {
  width: 42px;
  height: 42px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: #fff;
  color: var(--color-mid-gray);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 20px;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.attach-btn:hover:not(:disabled) {
  color: var(--color-dark);
  border-color: var(--color-mid-gray);
}

.attach-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-btn,
.stop-btn {
  min-width: 76px;
  height: 42px;
  padding: 10px 18px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 13px;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.send-btn {
  background: var(--color-primary);
  color: #fff;
  border: 1px solid var(--color-primary);
}

.send-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stop-btn {
  background: transparent;
  color: var(--color-danger);
  border: 1px solid rgba(196, 91, 91, 0.4);
}

.stop-btn:hover {
  background: var(--color-danger);
  color: #fff;
}
</style>
