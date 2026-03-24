import { createRouter, createWebHistory } from 'vue-router';
import MainLayout from '@/layout/MainLayout.vue';
import Overview from '@/views/Overview.vue';
import Agents from '@/views/Agents.vue';
import Sessions from '@/views/Sessions.vue';
import Logs from '@/views/Logs.vue';
import Dialogue from '@/views/Dialogue.vue';
import Config from '@/views/Config.vue';
import Memory from '@/views/Memory.vue';
import Skills from '@/views/Skills.vue';
import Tools from '@/views/Tools.vue';
import Plugins from '@/views/Plugins.vue';
import Cron from '@/views/Cron.vue';
import Mcp from '@/views/Mcp.vue';
import Unauthorized from '@/views/Unauthorized.vue';
import { buildTokenQuery, getRouteToken } from '@/lib/auth';
import { appScrollBehavior } from './scrollBehavior';

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: appScrollBehavior,
  routes: [
    {
      path: '/unauthorized',
      name: 'unauthorized',
      component: Unauthorized,
    },
    {
      path: '/',
      redirect: (to) => ({ path: '/overview', query: to.query, hash: to.hash }),
    },
    {
      path: '/chat',
      redirect: (to) => ({ path: '/dialogue', query: to.query, hash: to.hash }),
    },
    {
      path: '/chat/:sessionKey',
      redirect: (to) => ({ path: `/dialogue/${to.params.sessionKey}`, query: to.query, hash: to.hash }),
    },
    {
      path: '/logs',
      redirect: (to) => ({ path: '/observability/logs', query: to.query, hash: to.hash }),
    },
    {
      path: '/config',
      redirect: (to) => ({ path: '/settings/config', query: to.query, hash: to.hash }),
    },
    {
      path: '/',
      component: MainLayout,
      children: [
        { path: 'overview', name: 'overview', component: Overview, meta: { title: '总览' } },
        { path: 'dialogue', name: 'dialogue', component: Dialogue, meta: { title: '对话' } },
        { path: 'dialogue/:sessionKey', name: 'dialogue-session', component: Dialogue, meta: { title: '对话' } },
        { path: 'sessions', name: 'sessions', component: Sessions, meta: { title: '会话' } },
        { path: 'memory', name: 'memory', component: Memory, meta: { title: '记忆' } },
        { path: 'agents', name: 'agents', component: Agents, meta: { title: 'Agent' } },
        { path: 'skills', name: 'skills', component: Skills, meta: { title: '技能' } },
        { path: 'tools', name: 'tools', component: Tools, meta: { title: '工具' } },
        { path: 'plugins', name: 'plugins', component: Plugins, meta: { title: '插件' } },
        { path: 'cron', name: 'cron', component: Cron, meta: { title: '定时任务' } },
        { path: 'mcp', name: 'mcp', component: Mcp, meta: { title: 'MCP' } },
        { path: 'observability/logs', name: 'observability-logs', component: Logs, meta: { title: '观测' } },
        { path: 'settings/config', name: 'settings-config', component: Config, meta: { title: '设置' } },
        { path: ':pathMatch(.*)*', redirect: (to) => ({ path: '/overview', query: to.query, hash: to.hash }) },
      ],
    },
  ],
});

router.beforeEach((to, from) => {
  if (to.name === 'unauthorized') {
    return true;
  }

  const token = getRouteToken(to) || getRouteToken(from);
  if (!token) {
    return {
      name: 'unauthorized',
      query: { reason: 'missing' },
    };
  }

  if (getRouteToken(to) !== token) {
    return {
      path: to.path,
      query: buildTokenQuery(to.query, token),
      hash: to.hash,
      replace: true,
    };
  }

  return true;
});

export default router;
