import { createApp } from 'vue'
import './assets/main.css'

import App from './App.vue'
import router from './router'
import { pinia, useUiStore } from './stores'

const app = createApp(App)
app.use(pinia)  // 注册 Pinia
app.use(router)

const uiStore = useUiStore(pinia)
uiStore.initializeTheme()

app.mount('#app')
