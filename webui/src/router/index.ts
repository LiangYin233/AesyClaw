import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import Dashboard from '../views/Dashboard.vue'
import Chat from '../views/Chat.vue'
import Sessions from '../views/Sessions.vue'
import Tools from '../views/Tools.vue'
import Plugins from '../views/Plugins.vue'
import Config from '../views/Config.vue'
import Cron from '../views/Cron.vue'

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/',
            component: AppLayout,
            children: [
                { path: '', name: 'dashboard', component: Dashboard },
                { path: 'chat', name: 'chat', component: Chat },
                { path: 'chat/:sessionKey', name: 'chat-session', component: Chat },
                { path: 'sessions', name: 'sessions', component: Sessions },
                { path: 'tools', name: 'tools', component: Tools },
                { path: 'plugins', name: 'plugins', component: Plugins },
                { path: 'config', name: 'config', component: Config },
                { path: 'cron', name: 'cron', component: Cron }
            ]
        }
    ]
})

export default router
