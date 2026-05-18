/** Vue Router — 聊天 / 设置 两个视图 */

import { createRouter, createMemoryHistory } from 'vue-router';
import ChatView from '../views/ChatView.vue';
import SettingsView from '../views/SettingsView.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'chat', component: ChatView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
});

export default router;
