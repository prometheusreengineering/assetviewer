import { createRouter, createWebHashHistory } from 'vue-router'
import ProviderView from './views/ProviderView.vue'

// Hash history: the server only ever has to serve the one page.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/lunar' },
    { path: '/:provider(lunar|dawn|essential)/:category?', component: ProviderView, props: true },
    // Anything else would render nothing but the footer.
    { path: '/:pathMatch(.*)*', redirect: '/lunar' },
  ],
})
