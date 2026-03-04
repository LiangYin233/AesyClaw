import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import ToastService from 'primevue/toastservice'
import 'primeicons/primeicons.css'
import './assets/main.css'

import App from './App.vue'
import router from './router'

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
app.use(router)

app.mount('#app')
