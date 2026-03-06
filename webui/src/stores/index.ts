// Pinia store index
import { createPinia } from 'pinia'

export const pinia = createPinia()

// Re-export stores for convenience
export { useSystemStore } from './system'
export { useSessionsStore } from './sessions'
export { usePluginsStore } from './plugins'
export { useCronStore } from './cron'
export { useConfigStore } from './config'
export { useUiStore } from './ui'
