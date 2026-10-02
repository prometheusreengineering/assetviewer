<script setup lang="ts">
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Menu from 'primevue/menu'
import CollectionPicker from './CollectionPicker.vue'
import Slider from 'primevue/slider'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { AmbientLight, DirectionalLight, MOUSE, Mesh, PerspectiveCamera, Scene, WebGLRenderer, type MeshLambertMaterial } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import { getFileBuffer } from '../cdn'
import { download } from '../download'
import { formatBytes } from '../format'
import { autoRotate, freeRotate, wireframe } from '../viewPrefs'
import { zipFiles } from '../providers/lunar'
import type { CosmeticItem, CosmeticProvider, LoadedModel, RawFile, Timeline } from '../providers/types'
import { playerEmoteId, showOnPlayer, skinName } from '../skin'
import AnimatedImage from './AnimatedImage.vue'
import ControlsHelp from './ControlsHelp.vue'

const props = defineProps<{ provider: CosmeticProvider; item: CosmeticItem | null }>()
const emit = defineEmits<{ close: [] }>()
// Pinned: no backdrop and clicking outside doesn't close it, so the app stays usable while it is open.
const pinned = ref(false)

const canvasHost = ref<HTMLElement>()
const imgSrc = ref('')
const imgFrames = ref<{ frameW?: number; frameH?: number; frametimeMs: number }>()
const raw = ref<RawFile>()
const loading = ref(false)
const error = ref('')
// Free = trackball (any angle, can flip upside down); capped = orbit (stays upright, poles clamped).
const hasModel = ref(false)
const states = ref<string[]>([])
const state = ref('')
const timeline = shallowRef<Timeline>()
const tlTime = ref(0)
const playing = ref(true)
const isEmote = computed(() => shown.value?.category === 'emotes')
// Wearable on the player: 3D cosmetics (not emotes) when the provider can dress a player.
const canDress = computed(() => !!props.provider.dressPlayer && shown.value?.render === '3d' && !isEmote.value)
// Second row: animation, show-on-player (+ what it reveals), or an emote's skin and play controls.
const hasRow2 = computed(() => states.value.length > 1 || canDress.value || !!timeline.value)
const dressed = computed(() => canDress.value && showOnPlayer.value)
const usesSkin = computed(() => isEmote.value || dressed.value)
const emoteOptions = computed(() => (canDress.value ? props.provider.items('emotes').map((e) => ({ label: e.name, value: e.id })) : []))

let model: LoadedModel | undefined
let renderer: WebGLRenderer | undefined
type Controls = TrackballControls | OrbitControls
let controls: Controls | undefined
let swapControls: ((free: boolean) => void) | undefined
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
  swapControls = undefined
  hasModel.value = false
  imgSrc.value = ''
  imgFrames.value = undefined
  raw.value = undefined
  states.value = []
  state.value = ''
  timeline.value = undefined
  tlTime.value = 0
  playing.value = true
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
    const emote = playerEmoteId.value ? props.provider.itemById?.(playerEmoteId.value) : undefined
    const [loaded, { TrackballControls }, { OrbitControls }] = await Promise.all([
      dressed.value ? props.provider.dressPlayer!([item], emote) : props.provider.loadModel(item),
      import('three/examples/jsm/controls/TrackballControls.js'),
      import('three/examples/jsm/controls/OrbitControls.js'),
    ])
    await nextTick()
    const host = canvasHost.value
    if (!host || mine !== token) {
      loaded.dispose()
      return
    }
    model = loaded
    // ".webp, .obj, .json": the distinct extensions of the source files in the zip
    zipExts.value = [...new Set(loaded.files.map((f) => '.' + (f.name.split('.').pop() ?? '').toLowerCase()))].join(', ')
    hasModel.value = true
    applyWireframe(wireframe.value)
    states.value = loaded.states
    timeline.value = loaded.timeline
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
    // Shift + drag moves the model (right-drag also pans; the wheel zooms) in both modes.
    const onDown = (e: PointerEvent) => {
      if (controls) controls.mouseButtons.LEFT = e.shiftKey ? MOUSE.PAN : MOUSE.ROTATE
    }
    r.domElement.addEventListener('pointerdown', onDown, { capture: true })
    swapControls = (free) => {
      controls?.dispose()
      camera.up.set(0, 1, 0)
      camera.position.set(0, 0.5, -4.2)
      if (free) {
        const c = new TrackballControls(camera, r.domElement)
        c.panSpeed = 0.1
        c.rotateSpeed = 3
        c.dynamicDampingFactor = 0.1
        c.minDistance = 2
        c.maxDistance = 9
        controls = c
      } else {
        const c = new OrbitControls(camera, r.domElement)
        c.enableDamping = true
        c.dampingFactor = 0.1
        c.minDistance = 2
        c.maxDistance = 9
        c.maxPolarAngle = Math.PI * 0.95
        c.minPolarAngle = Math.PI * 0.05
        controls = c
      }
    }
    swapControls(freeRotate.value)
    let last = 0
    const loop = (ms: number) => {
      raf = requestAnimationFrame(loop)
      if (autoRotate.value && last) loaded.object.rotation.y += Math.min(ms - last, 100) * 0.0002
      last = ms
      controls?.update()
      loaded.tick(ms)
      // Only refresh the scrubber when it visibly moves.
      const tl = loaded.timeline
      if (tl && Math.abs(tl.time - tlTime.value) >= 0.05) tlTime.value = Math.round(tl.time * 20) / 20
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
const applyWireframe = (w: boolean) =>
  model?.object.traverse((o) => {
    if (o instanceof Mesh) (o.material as MeshLambertMaterial).wireframe = w
  })
watch(wireframe, applyWireframe)
watch(state, (s) => model?.setState(s))
// The header's player name changed: redraw anything wearing the skin.
watch(skinName, () => usesSkin.value && shown.value && open(shown.value))
watch(freeRotate, (f) => swapControls?.(f))
watch([showOnPlayer, playerEmoteId], () => canDress.value && shown.value && open(shown.value))
// A deep link (?item=) already has the item when the modal mounts, so the watch above never fires for it.
onMounted(() => props.item && open(props.item))
onBeforeUnmount(teardown)

const copied = ref(false)
async function copyLink() {
  await navigator.clipboard.writeText(location.href)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function togglePlay() {
  if (!timeline.value) return
  playing.value = !playing.value
  timeline.value.paused = !playing.value
}
function seek(v: number | number[]) {
  const t = Array.isArray(v) ? v[0]! : v
  tlTime.value = t
  timeline.value?.seek(t)
}

const slug = () => (shown.value?.name ?? 'item').toLowerCase().replace(/[^a-z0-9]+/g, '_')

// Download menu: each option says what the file(s) contain. Shown as a dropdown when there is more than one.
const downloadMenu = ref<InstanceType<typeof Menu>>()
const zipExts = ref('')
const downloadOptions = computed(() => {
  if (hasModel.value) {
    // A single source file is downloaded as is, not zipped.
    const only = model?.files.length === 1 ? model.files[0]! : undefined
    const ext = only?.name.split('.').pop()?.toLowerCase() ?? ''
    return [
      only
        ? { label: `${ext.toUpperCase()} (.${ext})`, sub: 'original source file from the CDN', icon: 'pi pi-file', command: () => download(only.name, only.data as Uint8Array<ArrayBuffer>, 'application/octet-stream') }
        : { label: `ZIP (${zipExts.value})`, sub: 'original source files from the CDN', icon: 'pi pi-folder', command: downloadZip },
      { label: 'GLB (.glb)', sub: 'auto-generated all-in-one 3D file', icon: 'pi pi-box', command: downloadGlb },
    ]
  }
  if (imgSrc.value) {
    const ext = (props.item?.fields.ext as string) || 'webp'
    return [{ label: `${ext.toUpperCase()} (.${ext})`, sub: 'original source file from the CDN', icon: 'pi pi-image', command: () => downloadUrl(imgSrc.value, imageName()) }]
  }
  if (raw.value) {
    const r = raw.value
    const ext = r.name.includes('.') ? r.name.split('.').pop()! : ''
    return [{ label: ext ? `${ext.toUpperCase()} (.${ext})` : `${r.name} (no extension)`, sub: 'original source file from the CDN', icon: 'pi pi-file', command: () => downloadUrl(r.url, r.name) }]
  }
  return []
})

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
    :modal="!pinned"
    :dismissable-mask="!pinned"
    :pt="{ mask: { class: pinned ? 'pin-mask' : '' } }"
    :style="{ width: 'min(900px, 95vw)' }"
    @update:visible="(v: boolean) => !v && (pinned = false, emit('close'))"
  >
    <template #header>
      <div class="titlebar">
        <CollectionPicker v-if="item" :provider="provider.id" :item-id="item.id" />
        <span class="p-dialog-title">{{ item?.name }}</span>
        <Button
          icon="pi pi-thumbtack"
          :severity="pinned ? undefined : 'secondary'"
          :title="pinned ? 'Unpin' : 'Pin: keep this window open and keep using the app (drag it aside)'"
          size="small"
          rounded
          text
          @click="pinned = !pinned"
        />
      </div>
    </template>
    <div class="stage" :class="{ text: !!raw }">
      <div v-show="item?.render === '3d'" ref="canvasHost" class="canvas" />
      <AnimatedImage v-if="imgSrc" :src="imgSrc" v-bind="imgFrames" />
      <pre v-if="raw" class="code">{{ raw.text ?? `Binary file, ${formatBytes(raw.size)}. Use the download button.` }}</pre>
      <ControlsHelp v-if="hasModel" />
      <i v-if="loading" class="pi pi-spin pi-spinner busy" />
      <p v-if="error" class="err">{{ error }}</p>
    </div>
    <div class="actions">
      <template v-if="hasModel">
        <div class="row">
          <label><ToggleSwitch v-model="autoRotate" /> Auto-rotate</label>
          <label><ToggleSwitch v-model="wireframe" /> Wireframe</label>
          <label title="On: rotate to any angle. Off: stays upright (vertical angle limited)."><ToggleSwitch v-model="freeRotate" /> Free rotate</label>
        </div>
        <div v-if="hasRow2" class="row">
          <Select v-if="states.some((s) => s !== 'idle' && s !== 'main')" v-model="state" :options="states" size="small" placeholder="Animation" />
          <label v-if="canDress"><ToggleSwitch v-model="showOnPlayer" /> Show on player</label>
          <Select
            v-if="dressed"
            v-model="playerEmoteId"
            :options="emoteOptions"
            option-label="label"
            option-value="value"
            filter
            show-clear
            size="small"
            placeholder="Pose: standing"
            class="pose"
            title="Play an emote while wearing it"
          />
          <template v-if="timeline">
            <Button :icon="playing ? 'pi pi-pause' : 'pi pi-play'" size="small" text rounded :title="playing ? 'Pause' : 'Play'" @click="togglePlay" />
            <Slider :model-value="tlTime" :min="0" :max="timeline.duration" :step="0.05" class="scrub" @update:model-value="seek" />
            <span class="time">{{ tlTime.toFixed(1) }} / {{ timeline.duration.toFixed(1) }} s</span>
          </template>
        </div>
      </template>
      <div class="row buttons">
        <Button v-if="downloadOptions.length" size="small" aria-haspopup="true" @click="downloadMenu?.toggle($event)">
          <i class="pi pi-download" />
          <span>Download</span>
          <i class="pi pi-chevron-down chev" />
        </Button>
        <Button :label="copied ? 'Copied' : 'Copy link'" icon="pi pi-link" size="small" @click="copyLink" />
      </div>
    </div>
    <!-- Outside the button row: its placeholder element added an extra gap there. -->
    <Menu ref="downloadMenu" :model="downloadOptions" popup class="dl-menu">
      <template #item="{ item }">
        <a class="dl-item">
          <i :class="item.icon" />
          <span class="dl-text"><span class="dl-label">{{ item.label }}</span><span class="dl-sub">{{ (item as { sub?: string }).sub }}</span></span>
        </a>
      </template>
    </Menu>
    <dl v-if="infoRows.length" class="info">
      <div v-for="[k, v] in infoRows" :key="k" class="pair" :class="{ wide: v.length > 36 }">
        <dt>{{ k }}</dt>
        <dd>{{ v }}</dd>
      </div>
    </dl>
  </Dialog>
</template>

<style scoped>
.stage { position: relative; height: 60vh; background: var(--av-stage); border-radius: 8px; overflow: hidden; }
.canvas { position: absolute; inset: 0; }
.code { position: absolute; inset: 0; margin: 0; padding: 1rem; overflow: auto; font-size: 0.8rem; }
.busy { position: absolute; inset: 0; margin: auto; width: 2rem; height: 2rem; font-size: 2rem; }
.err { position: absolute; inset: 0; display: grid; place-items: center; color: var(--p-red-400); }
.actions { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.75rem; }
.row { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.row.buttons { gap: 0.6rem; }
.scrub { width: 10rem; }
.time { font-variant-numeric: tabular-nums; opacity: 0.7; font-size: 0.85rem; }
.pose { width: 12rem; }
.dl-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.55rem 0.9rem; cursor: pointer; }
.dl-item:hover { background: var(--av-border); }
.dl-text { display: flex; flex-direction: column; }
.dl-label { font-weight: 600; }
.dl-sub { font-size: 0.8rem; opacity: 0.65; }
.titlebar { display: flex; align-items: center; gap: 0.6rem; min-width: 0; flex: 1; }
.titlebar .p-button:last-child { margin-left: auto; }
label { display: flex; align-items: center; gap: 0.5rem; }
.info { display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem 2rem; margin: 0.75rem 0 0; font-size: 0.85rem; opacity: 0.8; }
.pair { display: grid; grid-template-columns: 6.5rem 1fr; gap: 0 0.75rem; min-width: 0; }
.pair.wide { grid-column: 1 / -1; }
.info dt { opacity: 0.6; }
.info dd { margin: 0; word-break: break-all; }
</style>
