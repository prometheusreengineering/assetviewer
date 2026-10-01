<script setup lang="ts">
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import ToggleSwitch from 'primevue/toggleswitch'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type MeshLambertMaterial,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { download } from '../download'
import { zipFiles } from '../providers/lunar'
import type { CosmeticItem, CosmeticProvider, LoadedModel } from '../providers/types'

const props = defineProps<{ provider: CosmeticProvider; item: CosmeticItem | null }>()
const emit = defineEmits<{ close: [] }>()

const canvasHost = ref<HTMLElement>()
const imgSrc = ref('')
const loading = ref(false)
const error = ref('')
const wireframe = ref(false)
const autoRotate = ref(true)
const hasModel = ref(false)

let model: LoadedModel | undefined
let renderer: WebGLRenderer | undefined
let controls: OrbitControls | undefined
let raf = 0

function teardown() {
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
  error.value = ''
}

async function open(item: CosmeticItem) {
  teardown()
  loading.value = true
  try {
    if (item.render === 'image') {
      imgSrc.value = await props.provider.imageUrl(item)
      return
    }
    const loaded = await props.provider.loadModel(item)
    await nextTick()
    const host = canvasHost.value
    if (!host) {
      loaded.dispose()
      return
    }
    model = loaded
    hasModel.value = true
    const scene = new Scene()
    scene.add(new AmbientLight(0xffffff, 2.2))
    const key = new DirectionalLight(0xffffff, 1.4)
    key.position.set(-2, 3, -4)
    scene.add(key, loaded.object)
    const camera = new PerspectiveCamera(30, host.clientWidth / host.clientHeight, 0.1, 50)
    camera.position.set(0, 0.5, -4.2)
    const r = new WebGLRenderer({ antialias: true, alpha: true })
    renderer = r
    r.setPixelRatio(Math.min(devicePixelRatio, 2))
    r.setSize(host.clientWidth, host.clientHeight)
    host.appendChild(r.domElement)
    const c = new OrbitControls(camera, r.domElement)
    controls = c
    c.enableDamping = true
    const loop = (ms: number) => {
      raf = requestAnimationFrame(loop)
      c.autoRotate = autoRotate.value
      c.update()
      loaded.tick(ms)
      r.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
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
onBeforeUnmount(teardown)

const slug = () => props.item!.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

function downloadZip() {
  download(`${slug()}.zip`, zipFiles(model!.files), 'application/zip')
}

function downloadGlb() {
  new GLTFExporter().parse(
    model!.object,
    (result) => download(`${slug()}.glb`, result as ArrayBuffer, 'model/gltf-binary'),
    (e) => (error.value = String(e)),
    { binary: true },
  )
}

async function downloadImage() {
  const blob = await (await fetch(imgSrc.value)).blob()
  download(`${slug()}.webp`, blob, 'image/webp')
}
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
    <div class="stage">
      <div v-show="!imgSrc" ref="canvasHost" class="canvas" />
      <img v-if="imgSrc" :src="imgSrc" class="flat" />
      <i v-if="loading" class="pi pi-spin pi-spinner busy" />
      <p v-if="error" class="err">{{ error }}</p>
    </div>
    <div class="actions">
      <template v-if="hasModel">
        <label><ToggleSwitch v-model="autoRotate" /> Auto-rotate</label>
        <label><ToggleSwitch v-model="wireframe" /> Wireframe</label>
        <Button label="ZIP (source files)" icon="pi pi-download" size="small" @click="downloadZip" />
        <Button label="GLB" icon="pi pi-download" size="small" severity="secondary" @click="downloadGlb" />
      </template>
      <Button v-if="imgSrc" label="Download image" icon="pi pi-download" size="small" @click="downloadImage" />
    </div>
  </Dialog>
</template>

<style scoped>
.stage { position: relative; height: 60vh; background: var(--p-surface-950); border-radius: 8px; overflow: hidden; display: grid; place-items: center; }
.canvas { position: absolute; inset: 0; }
.flat { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
.busy { position: absolute; font-size: 2rem; }
.err { color: var(--p-red-400); }
.actions { display: flex; gap: 1rem; align-items: center; margin-top: 0.75rem; flex-wrap: wrap; }
label { display: flex; align-items: center; gap: 0.5rem; }
</style>
