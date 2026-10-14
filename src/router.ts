import { createRouter, createWebHashHistory } from 'vue-router'
import ProviderView from './views/ProviderView.vue'

// Hash history so it works on GitHub Pages without rewrites.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/lunar' },
    { path: '/:provider(lunar|dawn|essential)/:category?', component: ProviderView, props: true },
  ],
})
