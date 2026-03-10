// Keyboard navigation and shortcuts

import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { KEYBOARD_SHORTCUTS } from '../constants/a11y'

export interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  handler: (e: KeyboardEvent) => void
  description: string
}

/**
 * Register keyboard shortcuts
 */
export function useKeyboard(shortcuts: KeyboardShortcut[]) {
  const handleKeyDown = (e: KeyboardEvent) => {
    for (const shortcut of shortcuts) {
      const ctrlMatch = shortcut.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey
      const altMatch = shortcut.alt ? e.altKey : !e.altKey
      const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey

      if (
        e.key === shortcut.key &&
        ctrlMatch &&
        altMatch &&
        shiftMatch
      ) {
        e.preventDefault()
        shortcut.handler(e)
        break
      }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeyDown)
  })

  return {
    shortcuts
  }
}

/**
 * Global navigation shortcuts
 */
export function useNavigationShortcuts() {
  const router = useRouter()

  const shortcuts: KeyboardShortcut[] = [
    {
      key: '1',
      alt: true,
      handler: () => router.push('/'),
      description: '跳转到仪表盘'
    },
    {
      key: '2',
      alt: true,
      handler: () => router.push('/chat'),
      description: '跳转到聊天'
    },
    {
      key: '3',
      alt: true,
      handler: () => router.push('/sessions'),
      description: '跳转到会话'
    },
    {
      key: '4',
      alt: true,
      handler: () => router.push('/cron'),
      description: '跳转到定时任务'
    },
    {
      key: '5',
      alt: true,
      handler: () => router.push('/tools'),
      description: '跳转到工具'
    },
    {
      key: '6',
      alt: true,
      handler: () => router.push('/plugins'),
      description: '跳转到插件'
    },
    {
      key: '7',
      alt: true,
      handler: () => router.push('/mcp'),
      description: '跳转到 MCP'
    },
    {
      key: '8',
      alt: true,
      handler: () => router.push('/skills'),
      description: '跳转到 Skills'
    },
    {
      key: '9',
      alt: true,
      handler: () => router.push('/config'),
      description: '跳转到配置'
    },
    {
      key: '0',
      alt: true,
      handler: () => router.push('/memory'),
      description: '跳转到记忆'
    }
  ]

  useKeyboard(shortcuts)

  return {
    shortcuts
  }
}

/**
 * Show keyboard shortcuts help
 */
export function showKeyboardHelp() {
  const helpText = `
键盘快捷键：

导航：
  ${KEYBOARD_SHORTCUTS.dashboard} - 仪表盘
  ${KEYBOARD_SHORTCUTS.chat} - 聊天
  ${KEYBOARD_SHORTCUTS.sessions} - 会话
  ${KEYBOARD_SHORTCUTS.memory} - 记忆
  ${KEYBOARD_SHORTCUTS.cron} - 定时任务
  ${KEYBOARD_SHORTCUTS.tools} - 工具
  ${KEYBOARD_SHORTCUTS.plugins} - 插件
  ${KEYBOARD_SHORTCUTS.mcp} - MCP
  ${KEYBOARD_SHORTCUTS.skills} - Skills
  ${KEYBOARD_SHORTCUTS.config} - 配置

操作：
  ${KEYBOARD_SHORTCUTS.send} - 发送消息（聊天页面）
  ${KEYBOARD_SHORTCUTS.escape} - 关闭对话框/清空输入
  ${KEYBOARD_SHORTCUTS.help} - 显示此帮助
  `.trim()

  alert(helpText)
}
