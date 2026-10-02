import { ref, watch } from 'vue'

// Dark by default; the choice is remembered. PrimeVue's `.app-dark` selector on <html> switches its palette.
const KEY = 'assetviewer.theme'
let initial = true
try {
  const saved = localStorage.getItem(KEY)
  initial = saved ? saved === 'dark' : !window.matchMedia?.('(prefers-color-scheme: light)').matches
} catch {
  /* storage blocked */
}
export const dark = ref(initial)

watch(
  dark,
  (d) => {
    document.documentElement.classList.toggle('app-dark', d)
    try {
      localStorage.setItem(KEY, d ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  },
  { immediate: true },
)
