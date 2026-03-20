import { describe, expect, it } from 'vitest'
import { resolveLegacyConsolePath } from './legacyRedirects'

describe('resolveLegacyConsolePath', () => {
  it('将旧首页重定向到新总览页', () => {
    expect(resolveLegacyConsolePath('/')).toEqual('/overview')
  })

  it('将旧聊天路由重定向到新对话路由', () => {
    expect(resolveLegacyConsolePath('/chat')).toEqual('/dialogue')
    expect(resolveLegacyConsolePath('/chat/session-01')).toEqual('/dialogue/session-01')
  })

  it('将旧观测和设置路由重定向到新分组路由', () => {
    expect(resolveLegacyConsolePath('/logs')).toEqual('/observability/logs')
    expect(resolveLegacyConsolePath('/config')).toEqual('/settings/config')
  })

  it('不处理已经是新信息架构的路由', () => {
    expect(resolveLegacyConsolePath('/overview')).toBeNull()
    expect(resolveLegacyConsolePath('/agents')).toBeNull()
    expect(resolveLegacyConsolePath('/observability/logs')).toBeNull()
  })
})
