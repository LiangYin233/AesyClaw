// Accessibility constants and labels

export const ARIA_LABELS = {
  // Navigation
  mainNav: '主导航',
  sidebar: '侧边栏导航',
  mobileMenuToggle: '切换菜单',
  closeMenu: '关闭菜单',

  // Actions
  refresh: '刷新',
  delete: '删除',
  edit: '编辑',
  save: '保存',
  cancel: '取消',
  close: '关闭',
  search: '搜索',
  filter: '筛选',
  send: '发送',
  submit: '提交',

  // Status
  loading: '正在加载',
  error: '错误',
  success: '成功',
  warning: '警告',

  // Pages
  dashboard: '仪表盘',
  chat: '聊天',
  sessions: '会话管理',
  memory: '记忆管理',
  tools: '工具管理',
  plugins: '插件管理',
  cron: '定时任务',
  config: '配置',
  mcp: 'MCP 服务器',
  skills: 'Skills 管理'
} as const

export const KEYBOARD_SHORTCUTS = {
  // Navigation
  dashboard: 'Alt+1',
  chat: 'Alt+2',
  sessions: 'Alt+3',
  memory: 'Alt+0',
  cron: 'Alt+4',
  tools: 'Alt+5',
  plugins: 'Alt+6',
  mcp: 'Alt+7',
  skills: 'Alt+8',
  config: 'Alt+9',

  // Actions
  send: 'Ctrl+Enter',
  escape: 'Escape',
  help: 'Ctrl+/',
  refresh: 'Ctrl+R'
} as const

export const ARIA_LIVE_REGIONS = {
  polite: 'polite',
  assertive: 'assertive',
  off: 'off'
} as const

export const ROLES = {
  navigation: 'navigation',
  main: 'main',
  complementary: 'complementary',
  status: 'status',
  alert: 'alert',
  dialog: 'dialog',
  button: 'button',
  link: 'link'
} as const
