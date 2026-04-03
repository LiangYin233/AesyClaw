import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './lib/auth';

const Login = () => import('./views/Login.vue');
const Overview = () => import('./views/Overview.vue');
const Agents = () => import('./views/Agents.vue');
const Dialogue = () => import('./views/Dialogue.vue');
const Sessions = () => import('./views/Sessions.vue');
const Config = () => import('./views/Config.vue');
const Cron = () => import('./views/Cron.vue');
const Tools = () => import('./views/Tools.vue');
const Memory = () => import('./views/Memory.vue');
const AgentRuntime = () => import('./views/AgentRuntime.vue');
const Logs = () => import('./views/Logs.vue');

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: Login,
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      name: 'overview',
      component: Overview,
      meta: { requiresAuth: true },
    },
    {
      path: '/agents',
      name: 'agents',
      component: Agents,
      meta: { requiresAuth: true },
    },
    {
      path: '/dialogue/:chatId?',
      name: 'dialogue',
      component: Dialogue,
      meta: { requiresAuth: true },
    },
    {
      path: '/sessions',
      name: 'sessions',
      component: Sessions,
      meta: { requiresAuth: true },
    },
    {
      path: '/config',
      name: 'config',
      component: Config,
      meta: { requiresAuth: true },
    },
    {
      path: '/cron',
      name: 'cron',
      component: Cron,
      meta: { requiresAuth: true },
    },
    {
      path: '/tools',
      name: 'tools',
      component: Tools,
      meta: { requiresAuth: true },
    },
    {
      path: '/memory',
      name: 'memory',
      component: Memory,
      meta: { requiresAuth: true },
    },
    {
      path: '/runtime',
      name: 'runtime',
      component: AgentRuntime,
      meta: { requiresAuth: true },
    },
    {
      path: '/logs',
      name: 'logs',
      component: Logs,
      meta: { requiresAuth: true },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
});

router.beforeEach(async (to, from, next) => {
  const { isAuthenticated, checkAuthStatus } = useAuth();

  if (to.meta.requiresAuth === false) {
    if (isAuthenticated.value) {
      next('/');
    } else {
      next();
    }
    return;
  }

  if (!isAuthenticated.value) {
    const valid = await checkAuthStatus();
    if (!valid) {
      next('/login');
      return;
    }
  }

  next();
});

export default router;
