import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuth } from '@/composables/useAuth';
import AppLayout from '@/layouts/AppLayout.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: AppLayout,
      children: [
        {
          path: '',
          name: 'Dashboard',
          component: () => import('@/views/Dashboard.vue'),
        },
        {
          path: 'sessions',
          name: 'Sessions',
          component: () => import('@/views/Sessions.vue'),
        },
        {
          path: 'config',
          name: 'Config',
          component: () => import('@/views/ConfigEditor.vue'),
        },
        {
          path: 'channels',
          name: 'Channels',
          component: () => import('@/views/ChannelsConfig.vue'),
        },
        {
          path: 'plugins',
          name: 'Plugins',
          component: () => import('@/views/PluginsConfig.vue'),
        },
        {
          path: 'cron',
          name: 'Cron',
          component: () => import('@/views/CronJobs.vue'),
        },
        {
          path: 'roles',
          name: 'Roles',
          component: () => import('@/views/Roles.vue'),
        },
        {
          path: 'usage',
          name: 'Usage',
          component: () => import('@/views/Usage.vue'),
        },
        {
          path: 'logs',
          name: 'Logs',
          component: () => import('@/views/Logs.vue'),
        },
        {
          path: 'tools',
          name: 'Tools',
          component: () => import('@/views/Tools.vue'),
        },
        {
          path: 'skills',
          name: 'Skills',
          component: () => import('@/views/Skills.vue'),
        },
      ],
    },
  ],
});

router.beforeEach((to, _from, next) => {
  const { token } = useAuth();
  if (!to.meta['public'] && !token.value) {
    next('/login');
  } else {
    next();
  }
});

export { router };
