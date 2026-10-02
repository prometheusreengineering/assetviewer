import { ref, watch, type Ref } from 'vue'

// 3D view toggles shared by every viewer (thumbnails, modal, compare, outfit builder, header) and remembered.
function stored(key: string, fallback: boolean): Ref<boolean> {
  let v = fallback
  try {
    const s = localStorage.getItem(key)
    if (s !== null) v = s === '1'
  } catch {}
  const r = ref(v)
  watch(r, (n) => {
    try {
      localStorage.setItem(key, n ? '1' : '0')
    } catch {}
  })
  // Another tab changed it.
  addEventListener('storage', (e) => {
    if (e.key === key && e.newValue !== null) r.value = e.newValue === '1'
  })
  return r
}

export const autoRotate = stored('assetviewer.autoRotate', true)
export const wireframe = stored('assetviewer.wireframe', false)
export const freeRotate = stored('assetviewer.freeRotate', false)
