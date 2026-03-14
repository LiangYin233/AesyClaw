import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import ToastService from 'primevue/toastservice'
import 'primeicons/primeicons.css'
import './assets/main.css'

import App from './App.vue'
import router from './router'
import { pinia } from './stores'

function syncDarkModeClass() {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const apply = (matches: boolean) => {
        root.classList.toggle('dark', matches)
    }

    apply(media.matches)

    const onChange = (event: MediaQueryListEvent) => {
        apply(event.matches)
    }

    if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onChange)
        return
    }

    media.addListener(onChange)
}

syncDarkModeClass()

const app = createApp(App)

app.use(PrimeVue, {
    theme: {
        preset: Aura,
        options: {
            darkModeSelector: '.dark'
        }
    },
    ripple: true
})

app.use(ToastService)
app.use(pinia)  // 注册 Pinia
app.use(router)

app.mount('#app')
