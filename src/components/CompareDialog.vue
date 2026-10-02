<script setup lang="ts">
import Dialog from 'primevue/dialog'
import ToggleSwitch from 'primevue/toggleswitch'
import { AmbientLight, DirectionalLight, MOUSE, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { autoRotate, freeRotate } from '../viewPrefs'
import type { CosmeticItem, CosmeticProvider, LoadedModel } from '../providers/types'
import AnimatedImage from './AnimatedImage.vue'

const props = defineProps<{ provider: CosmeticProvider; items: CosmeticItem[]; visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

interface Pane {
  item: CosmeticItem
  model?: LoadedModel
  scene?: Scene
  img?: string
  frames?: { frameW?: number; frameH?: number; frametimeMs: number }
  error?: string
  loading: boolean
}
// shallowRef: panes hold three.js objects, which must not become deep reactive proxies.
const panes = shallowRef<Pane[]>([])
const setPane = (i: number, p: Pane) => (panes.value = panes.value.map((x, j) => (j === i ? p : x)))
const paneEls = ref<HTMLElement[]>([])
const stage = ref<HTMLElement>()
const sync = ref(true)

// ONE renderer and ONE camera for all panes (scissored viewports), so rotate/pan/zoom stay in sync.
let renderer: WebGLRenderer | undefined
let camera: PerspectiveCamera | undefined
let controls: TrackballControls | OrbitControls | undefined
let raf = 0
let token = 0

function teardown() {
  token++
  cancelAnimationFrame(raf)
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
  for (const p of panes.value) p.model?.dispose()
  renderer = undefined
  controls = undefined
  panes.value = []
}

// Trackball (free rotate) or orbit (upright) controls, per the shared "Free rotate" preference.
function makeControls(free: boolean) {
  if (!renderer || !camera) return
  controls?.dispose()
  camera.up.set(0, 1, 0)
  // Further back than the modal: panes are narrow.
  camera.position.set(0, 0.6, -5.4)
  camera.lookAt(0, 0, 0)
  if (free) {
    const c = new TrackballControls(camera, renderer.domElement)
    c.rotateSpeed = 3
    c.panSpeed = 0.1
    c.dynamicDampingFactor = 0.1
    controls = c
  } else {
    const c = new OrbitControls(camera, renderer.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.1
    c.maxPolarAngle = Math.PI * 0.95
    c.minPolarAngle = Math.PI * 0.05
    controls = c
  }
  controls.minDistance = 2
  controls.maxDistance = 9
}
watch(freeRotate, makeControls)

async function open() {
  teardown()
  const mine = token
  panes.value = props.items.map((item) => ({ item, loading: true }))
  // The dialog body mounts a tick or two after it becomes visible.
  for (let i = 0; i < 10 && !stage.value; i++) await nextTick()
  const host = stage.value
  if (!host || mine !== token) return
  const r = (renderer = new WebGLRenderer({ antialias: true, alpha: true }))
  r.setPixelRatio(Math.min(devicePixelRatio, 2))
  r.setClearColor(0x000000, 0)
  Object.assign(r.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
  host.appendChild(r.domElement)
  camera = new PerspectiveCamera(30, 1, 1, 12)
  makeControls(freeRotate.value)
  r.domElement.addEventListener('pointerdown', (e) => controls && (controls.mouseButtons.LEFT = e.shiftKey ? MOUSE.PAN : MOUSE.ROTATE), { capture: true })

  await Promise.all(
    panes.value.map(async (p, i) => {
      try {
        if (p.item.render === '3d') {
          const m = await props.provider.loadModel(p.item)
          if (mine !== token) return m.dispose()
          const scene = new Scene()
          scene.add(new AmbientLight(0xffffff, 2.2))
          const key = new DirectionalLight(0xffffff, 1.4)
          key.position.set(-2, 3, -4)
          scene.add(key, m.object)
          setPane(i, { ...p, model: m, scene, loading: false })
        } else if (p.item.render === 'image') {
          const frames = p.item.fields.animated ? await props.provider.imageFrames?.(p.item) : undefined
          setPane(i, { ...p, img: await props.provider.imageUrl(p.item), frames, loading: false })
        } else setPane(i, { ...p, loading: false })
      } catch (e) {
        setPane(i, { ...p, error: String(e), loading: false })
      }
    }),
  )

  let last = 0
  const frame = (ms: number) => {
    raf = requestAnimationFrame(frame)
    const box = host.getBoundingClientRect()
    if (!box.width || !box.height) return
    const w = Math.round(box.width)
    const h = Math.round(box.height)
    const size = r.getSize(new Vector2())
    if (size.x !== w || size.y !== h) {
      r.setSize(w, h, false)
      if (controls instanceof TrackballControls) controls.handleResize()
    }
    controls?.update()
    r.setScissorTest(false)
    r.clear()
    r.setScissorTest(true)
    panes.value.forEach((p, i) => {
      const el = paneEls.value[i]
      if (!p.model || !p.scene || !el) return
      const rect = el.getBoundingClientRect()
      const x = rect.left - box.left
      const y = box.bottom - rect.bottom
      r.setViewport(x, y, rect.width, rect.height)
      r.setScissor(x, y, rect.width, rect.height)
      camera!.aspect = rect.width / rect.height
      camera!.updateProjectionMatrix()
      if (autoRotate.value && last) p.model.object.rotation.y += Math.min(ms - last, 100) * 0.0002
      p.model.tick(sync.value ? ms : ms + i * 377)
      r.render(p.scene, camera!)
    })
    last = ms
  }
  raf = requestAnimationFrame(frame)
}

watch(
  () => [props.visible, props.items.map((it) => it.id).join()] as const,
  ([v]) => (v ? open() : teardown()),
  { immediate: true },
)
onBeforeUnmount(teardown)

// Field table: every info row of any item; rows whose values differ are highlighted.
const rows = computed(() => {
  const infos = props.items.map((it) => props.provider.info?.(it) ?? {})
  const keys = [...new Set(infos.flatMap((x) => Object.keys(x)))]
  return keys.map((k) => {
    const vals = infos.map((x) => x[k] ?? '—')
    return { key: k, vals, differs: new Set(vals).size > 1 }
  })
})
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    dismissable-mask
    :header="`Compare ${items.length} items`"
    :style="{ width: 'min(1400px, 96vw)' }"
    @update:visible="(v: boolean) => !v && emit('close')"
  >
    <div ref="stage" class="stage" :style="{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }">
      <div v-for="(p, i) in panes" :key="p.item.id" :ref="(el) => (paneEls[i] = el as HTMLElement)" class="pane">
        <AnimatedImage v-if="p.img" :src="p.img" v-bind="p.frames" />
        <div v-else-if="p.item.render === 'file'" class="file"><i class="pi pi-file" /></div>
        <i v-if="p.loading" class="pi pi-spin pi-spinner busy" />
        <p v-if="p.error" class="err">{{ p.error }}</p>
        <span class="label">{{ p.item.name }}</span>
      </div>
    </div>
    <div class="actions">
      <label><ToggleSwitch v-model="autoRotate" /> Auto-rotate</label>
      <label title="On: rotate freely in any direction. Off: stay upright"><ToggleSwitch v-model="freeRotate" /> Free rotate</label>
      <label title="Play animations in step"><ToggleSwitch v-model="sync" /> Sync animations</label>
      <span class="hint">Drag to rotate all, Shift+drag to move, wheel to zoom.</span>
    </div>
    <table class="fields">
      <tbody>
        <tr>
          <th />
          <th v-for="it in items" :key="it.id">{{ it.name }}</th>
        </tr>
        <tr v-for="r in rows" :key="r.key" :class="{ differs: r.differs }">
          <th>{{ r.key }}</th>
          <td v-for="(v, i) in r.vals" :key="i">{{ v }}</td>
        </tr>
      </tbody>
    </table>
  </Dialog>
</template>

<style scoped>
.stage { position: relative; display: grid; gap: 0.5rem; height: 55vh; }
.pane { position: relative; background: var(--av-stage); border-radius: 8px; overflow: hidden; display: grid; place-items: center; }
.pane :deep(img), .pane :deep(canvas) { max-width: 100%; max-height: 100%; }
.stage > :deep(canvas) { z-index: 1; }
.label { position: absolute; left: 0.6rem; bottom: 0.4rem; font-size: 0.85rem; opacity: 0.8; z-index: 2; pointer-events: none; }
.busy { position: absolute; font-size: 1.5rem; }
.err { position: absolute; color: var(--p-red-400); padding: 1rem; font-size: 0.85rem; }
.file .pi { font-size: 3rem; opacity: 0.5; }
.actions { display: flex; gap: 1.25rem; align-items: center; margin: 0.75rem 0; flex-wrap: wrap; }
.actions label { display: flex; align-items: center; gap: 0.5rem; }
.hint { opacity: 0.55; font-size: 0.85rem; }
.fields { width: 100%; border-collapse: collapse; font-size: 0.85rem; table-layout: fixed; }
.fields th, .fields td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid var(--av-border); word-break: break-word; vertical-align: top; }
.fields th:first-child { width: 9rem; opacity: 0.6; font-weight: normal; }
.fields tr.differs td { background: color-mix(in srgb, var(--p-primary-color) 12%, transparent); }
</style>
