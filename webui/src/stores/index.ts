import { createPinia } from 'pinia'

export const pinia = createPinia()

export { useSystemStore } from './system'
export { useSessionsStore } from './sessions'
export { usePluginsStore } from './plugins'
export { useCronStore } from './cron'
export { useConfigStore } from './config'
export { useUiStore } from './ui'
export { useMetricsStore } from './metrics'
export { useMemoryStore } from './memory'
export { useToolsStore } from './tools'
export { useSkillsStore } from './skills'
export { useLogsStore } from './logs'
export { useMcpStore } from './mcp'
