import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { buildTokenQuery, getRouteToken } from '../utils/auth'
import { resolveLegacyConsolePath } from './legacyRedirects'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/unauthorized',
      name: 'unauthorized',
      component: () => import('../views/Unauthorized.vue')
    },
    {
      path: '/overview',
      component: AppLayout,
      children: [
        { path: '', name: 'overview', component: () => import('../views/Dashboard.vue') }
      ]
    },
    {
      path: '/dialogue',
      component: AppLayout,
      children: [
        { path: '', name: 'dialogue', component: () => import('../views/Chat.vue') },
        { path: ':sessionKey', name: 'dialogue-session', component: () => import('../views/Chat.vue') }
      ]
    },
    {
      path: '/sessions',
      component: AppLayout,
      children: [
        { path: '', name: 'sessions', component: () => import('../views/Sessions.vue') }
      ]
    },
    {
      path: '/memory',
      component: AppLayout,
      children: [
        { path: '', name: 'memory', component: () => import('../views/Memory.vue') }
      ]
    },
    {
      path: '/agents',
      component: AppLayout,
      children: [
        { path: '', name: 'agents', component: () => import('../views/Agents.vue') }
      ]
    },
    {
      path: '/skills',
      component: AppLayout,
      children: [
        { path: '', name: 'skills', component: () => import('../views/Skills.vue') }
      ]
    },
    {
      path: '/tools',
      component: AppLayout,
      children: [
        { path: '', name: 'tools', component: () => import('../views/Tools.vue') }
      ]
    },
    {
      path: '/plugins',
      component: AppLayout,
      children: [
        { path: '', name: 'plugins', component: () => import('../views/Plugins.vue') }
      ]
    },
    {
      path: '/cron',
      component: AppLayout,
      children: [
        { path: '', name: 'cron', component: () => import('../views/Cron.vue') }
      ]
    },
    {
      path: '/mcp',
      component: AppLayout,
      children: [
        { path: '', name: 'mcp', component: () => import('../views/Mcp.vue') }
      ]
    },
    {
      path: '/observability',
      component: AppLayout,
      children: [
        { path: 'logs', name: 'observability-logs', component: () => import('../views/Logs.vue') }
      ]
    },
    {
      path: '/settings',
      component: AppLayout,
      children: [
        { path: 'config', name: 'settings-config', component: () => import('../views/Config.vue') }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: (to) => {
        const nextPath = resolveLegacyConsolePath(to.path)
        if (nextPath) {
          return {
            path: nextPath,
            query: to.query,
            hash: to.hash
          }
        }

        return {
          name: 'overview',
          query: to.query,
          hash: to.hash
        }
      }
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
