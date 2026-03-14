import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { buildTokenQuery, getRouteToken } from '../utils/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/unauthorized',
      name: 'unauthorized',
      component: () => import('../views/Unauthorized.vue')
    },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', name: 'dashboard', component: () => import('../views/Dashboard.vue') },
        { path: 'chat', name: 'chat', component: () => import('../views/Chat.vue') },
        { path: 'chat/:sessionKey', name: 'chat-session', component: () => import('../views/Chat.vue') },
        { path: 'sessions', name: 'sessions', component: () => import('../views/Sessions.vue') },
        { path: 'memory', name: 'memory', component: () => import('../views/Memory.vue') },
        { path: 'agents', name: 'agents', component: () => import('../views/Agents.vue') },
        { path: 'tools', name: 'tools', component: () => import('../views/Tools.vue') },
        { path: 'plugins', name: 'plugins', component: () => import('../views/Plugins.vue') },
        { path: 'config', name: 'config', component: () => import('../views/Config.vue') },
        { path: 'mcp', name: 'mcp', component: () => import('../views/Mcp.vue') },
        { path: 'skills', name: 'skills', component: () => import('../views/Skills.vue') },
        { path: 'cron', name: 'cron', component: () => import('../views/Cron.vue') },
        { path: 'logs', name: 'logs', component: () => import('../views/Logs.vue') }
      ]
    }
  ]
})

router.beforeEach((to, from) => {
  if (to.name === 'unauthorized') {
    return true
  }

  const token = getRouteToken(to) || getRouteToken(from)
  if (!token) {
    return {
      name: 'unauthorized',
      query: { reason: 'missing' }
    }
  }

  if (getRouteToken(to) !== token) {
    return {
      path: to.path,
      query: buildTokenQuery(to.query, token),
      hash: to.hash,
      replace: true
    }
  }

  return true
})

export default router
