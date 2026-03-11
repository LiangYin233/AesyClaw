import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import Dashboard from '../views/Dashboard.vue'
import Chat from '../views/Chat.vue'
import Sessions from '../views/Sessions.vue'
import Memory from '../views/Memory.vue'
import Tools from '../views/Tools.vue'
import Plugins from '../views/Plugins.vue'
import Config from '../views/Config.vue'
import Mcp from '../views/Mcp.vue'
import Skills from '../views/Skills.vue'
import Cron from '../views/Cron.vue'
import Logs from '../views/Logs.vue'
import Unauthorized from '../views/Unauthorized.vue'
import { buildTokenQuery, getRouteToken } from '../utils/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/unauthorized',
      name: 'unauthorized',
      component: Unauthorized
    },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', name: 'dashboard', component: Dashboard },
        { path: 'chat', name: 'chat', component: Chat },
        { path: 'chat/:sessionKey', name: 'chat-session', component: Chat },
        { path: 'sessions', name: 'sessions', component: Sessions },
        { path: 'memory', name: 'memory', component: Memory },
        { path: 'tools', name: 'tools', component: Tools },
        { path: 'plugins', name: 'plugins', component: Plugins },
        { path: 'config', name: 'config', component: Config },
        { path: 'mcp', name: 'mcp', component: Mcp },
        { path: 'skills', name: 'skills', component: Skills },
        { path: 'cron', name: 'cron', component: Cron },
        { path: 'logs', name: 'logs', component: Logs }
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
