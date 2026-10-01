<script setup lang="ts">
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { AmbientLight, DirectionalLight, Mesh, PerspectiveCamera, Scene, WebGLRenderer, type MeshLambertMaterial } from 'three'
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import { getFileBuffer } from '../cdn'
import { download } from '../download'
import { zipFiles } from '../providers/lunar'
import type { CosmeticItem, CosmeticProvider, LoadedModel, RawFile } from '../providers/types'
import AnimatedImage from './AnimatedImage.vue'

const props = defineProps<{ provider: CosmeticProvider; item: CosmeticItem | null }>()
const emit = defineEmits<{ close: [] }>()

const canvasHost = ref<HTMLElement>()
const imgSrc = ref('')
const imgFrames = ref<{ frameW?: number; frameH?: number; frametimeMs: number }>()
const raw = ref<RawFile>()
const loading = ref(false)
const error = ref('')
const wireframe = ref(false)
const autoRotate = ref(true)
const hasModel = ref(false)
const states = ref<string[]>([])
const state = ref('')

let model: LoadedModel | undefined
let renderer: WebGLRenderer | undefined
let controls: TrackballControls | undefined
let raf = 0
let token = 0
const dimTick = ref(0)
const infoRows = computed(() => (dimTick.value >= 0 && props.item ? Object.entries(props.provider.info?.(props.item) ?? {}) : []))
const shown = shallowRef<CosmeticItem | null>(null)

function teardown() {
  token++
  cancelAnimationFrame(raf)
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
  model?.dispose()
  model = undefined
  renderer = undefined
  controls = undefined
  hasModel.value = false
  imgSrc.value = ''
  imgFrames.value = undefined
  raw.value = undefined
  states.value = []
  state.value = ''
  error.value = ''
}

async function open(item: CosmeticItem) {
  teardown()
  const mine = token
  shown.value = item
  loading.value = true
  // width/height are read from the file header (a few bytes), then the info rows refresh
  void props.provider.ensureDimensions?.([item], () => {}, new AbortController().signal).then(() => dimTick.value++)
  try {
    if (item.render === 'file') {
      raw.value = await props.provider.rawFile!(item)
      return
    }
    if (item.render === 'image') {
      imgFrames.value = item.fields.animated ? await props.provider.imageFrames?.(item) : undefined
      imgSrc.value = await props.provider.imageUrl(item)
      return
    }
    const [loaded, { TrackballControls }] = await Promise.all([
      props.provider.loadModel(item),
      import('three/examples/jsm/controls/TrackballControls.js'),
    ])
    await nextTick()
    const host = canvasHost.value
    if (!host || mine !== token) {
      loaded.dispose()
      return
    }
    model = loaded
    hasModel.value = true
    states.value = loaded.states
    state.value = loaded.state
    const scene = new Scene()
    scene.add(new AmbientLight(0xffffff, 2.2))
    const key = new DirectionalLight(0xffffff, 1.4)
    key.position.set(-2, 3, -4)
    scene.add(key, loaded.object)
    const camera = new PerspectiveCamera(30, host.clientWidth / host.clientHeight, 1, 12)
    camera.position.set(0, 0.5, -4.2)
    const r = new WebGLRenderer({ antialias: true, alpha: true })
    renderer = r
    r.setPixelRatio(Math.min(devicePixelRatio, 2))
    r.setSize(host.clientWidth, host.clientHeight)
    host.appendChild(r.domElement)
    // Trackball controls rotate freely (no pole clamp, can flip upside down), unlike OrbitControls.
    const c = new TrackballControls(camera, r.domElement)
    controls = c
    c.noPan = true
    c.rotateSpeed = 3
    c.dynamicDampingFactor = 0.1
    c.minDistance = 2
    c.maxDistance = 9
    let last = 0
    const loop = (ms: number) => {
      raf = requestAnimationFrame(loop)
      if (autoRotate.value && last) loaded.object.rotation.y += Math.min(ms - last, 100) * 0.0002
      last = ms
      c.update()
      loaded.tick(ms)
      r.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)
  } catch (e) {
    error.value = String(e)
  } finally {
    if (mine === token) loading.value = false
  }
}

watch(
  () => props.item,
  (it) => (it ? open(it) : teardown()),
)
watch(wireframe, (w) => {
  model?.object.traverse((o) => {
    if (o instanceof Mesh) (o.material as MeshLambertMaterial).wireframe = w
  })
})
watch(state, (s) => model?.setState(s))
onBeforeUnmount(teardown)

const slug = () => (shown.value?.name ?? 'item').toLowerCase().replace(/[^a-z0-9]+/g, '_')

function downloadZip() {
  download(`${slug()}.zip`, zipFiles(model!.files), 'application/zip')
}

async function downloadGlb() {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  new GLTFExporter().parse(
    model!.object,
    (result) => download(`${slug()}.glb`, result as ArrayBuffer, 'model/gltf-binary'),
    (e) => (error.value = String(e)),
    { binary: true },
  )
}

async function downloadUrl(url: string, name: string) {
  // Via the hash-keyed cache: a plain fetch can reuse the <img>'s non-CORS cache entry and fail.
  // blob: URLs (displayed images) are same-origin; CDN URLs go through the cache by hash.
  download(name, url.startsWith('blob:') ? await (await fetch(url)).arrayBuffer() : await getFileBuffer(url.split('/').pop()!))
}
const imageName = () => `${slug()}.${(props.item?.fields.ext as string) || 'webp'}`
</script>

<template>
  <Dialog
    :visible="!!item"
    modal
    dismissable-mask
    :header="item?.name"
    :style="{ width: 'min(900px, 95vw)' }"
    @update:visible="(v: boolean) => !v && emit('close')"
  >
    <div class="stage" :class="{ text: !!raw }">
      <div v-show="item?.render === '3d'" ref="canvasHost" class="canvas" />
      <AnimatedImage v-if="imgSrc" :src="imgSrc" v-bind="imgFrames" />
      <pre v-if="raw" class="code">{{ raw.text ?? `Binary file, ${raw.size} bytes. Use the download button.` }}</pre>
      <i v-if="loading" class="pi pi-spin pi-spinner busy" />
      <p v-if="error" class="err">{{ error }}</p>
    </div>
    <div class="actions">
      <template v-if="hasModel">
        <label><ToggleSwitch v-model="autoRotate" /> Auto-rotate</label>
        <label><ToggleSwitch v-model="wireframe" /> Wireframe</label>
        <Select v-if="states.length > 1" v-model="state" :options="states" size="small" placeholder="Animation" />
        <Button label="ZIP (source files)" icon="pi pi-download" size="small" @click="downloadZip" />
        <Button label="GLB" icon="pi pi-download" size="small" severity="secondary" @click="downloadGlb" />
      </template>
      <Button v-if="imgSrc" label="Download image" icon="pi pi-download" size="small" @click="downloadUrl(imgSrc, imageName())" />
      <Button v-if="raw" label="Download file" icon="pi pi-download" size="small" @click="downloadUrl(raw.url, raw.name)" />
    </div>
    <dl v-if="infoRows.length" class="info">
      <div v-for="[k, v] in infoRows" :key="k" class="pair" :class="{ wide: v.length > 36 }">
        <dt>{{ k }}</dt>
        <dd>{{ v }}</dd>
      </div>
    </dl>
  </Dialog>
</template>

<style scoped>
.stage { position: relative; height: 60vh; background: var(--p-surface-950); border-radius: 8px; overflow: hidden; }
.canvas { position: absolute; inset: 0; }
.code { position: absolute; inset: 0; margin: 0; padding: 1rem; overflow: auto; font-size: 0.8rem; }
.busy { position: absolute; inset: 0; margin: auto; width: 2rem; height: 2rem; font-size: 2rem; }
.err { position: absolute; inset: 0; display: grid; place-items: center; color: var(--p-red-400); }
.actions { display: flex; gap: 1rem; align-items: center; margin-top: 0.75rem; flex-wrap: wrap; }
label { display: flex; align-items: center; gap: 0.5rem; }
.info { display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem 2rem; margin: 0.75rem 0 0; font-size: 0.85rem; opacity: 0.8; }
.pair { display: grid; grid-template-columns: 6.5rem 1fr; gap: 0 0.75rem; min-width: 0; }
.pair.wide { grid-column: 1 / -1; }
.info dt { opacity: 0.6; }
.info dd { margin: 0; word-break: break-all; }
</style>
