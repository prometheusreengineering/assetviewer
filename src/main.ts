import Aura from '@primeuix/themes/aura'
import 'primeicons/primeicons.css'
import PrimeVue from 'primevue/config'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './style.css'

document.documentElement.classList.add('app-dark')

createApp(App)
  .use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.app-dark' } } })
  .use(router)
  .mount('#app')
