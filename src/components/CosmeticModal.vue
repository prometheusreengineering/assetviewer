<script setup lang="ts">
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import Slider from 'primevue/slider'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import vTooltip from 'primevue/tooltip'
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { AmbientLight, DirectionalLight, MOUSE, Mesh, PerspectiveCamera, Scene, WebGLRenderer, type MeshLambertMaterial } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import { getFileBuffer } from '../cdn'
import { download } from '../download'
import { zipFiles } from '../providers/lunar'
import type { CosmeticItem, CosmeticProvider, LoadedModel, RawFile, Timeline } from '../providers/types'
import { playerEmoteId, showOnPlayer, skinName } from '../skin'
import { FAV, useCollections } from '../collections'
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
// Free = trackball (any angle, can flip upside down); capped = orbit (stays upright, poles clamped).
const freeRotate = ref(true)
const hasModel = ref(false)
const states = ref<string[]>([])
const state = ref('')
const timeline = shallowRef<Timeline>()
const tlTime = ref(0)
const playing = ref(true)
const skinDraft = ref(skinName.value)
const isEmote = computed(() => shown.value?.category === 'emotes')
// Wearable on the player: 3D cosmetics (not emotes) when the provider can dress a player.
const canDress = computed(() => !!props.provider.dressPlayer && shown.value?.render === '3d' && !isEmote.value)
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
const animState = inject<Ref<string> | undefined>('animState', undefined)
const HELP = ['Rotate: drag', 'Move: Shift + drag (or right-drag)', 'Zoom: mouse wheel'].join(String.fromCharCode(10))
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
    hasModel.value = true
    states.value = loaded.states
    timeline.value = loaded.timeline
    const wanted = animState?.value
    if (wanted && loaded.states.includes(wanted)) loaded.setState(wanted)
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
watch(wireframe, (w) => {
  model?.object.traverse((o) => {
    if (o instanceof Mesh) (o.material as MeshLambertMaterial).wireframe = w
  })
})
watch(state, (s) => model?.setState(s))
watch(freeRotate, (f) => swapControls?.(f))
watch([showOnPlayer, playerEmoteId], () => canDress.value && shown.value && open(shown.value))
onBeforeUnmount(teardown)

const collections = useCollections(props.provider.id)
const fav = computed(() => !!shown.value && collections.has(FAV, shown.value.id))
const listOptions = computed(() => collections.all().map((c) => ({ label: c.name, value: c.id })))
const inLists = computed(() => (shown.value ? collections.of(shown.value.id) : []))
function setLists(ids: string[]) {
  const it = shown.value
  if (!it) return
  for (const c of collections.all()) collections.set(c.id, it.id, ids.includes(c.id))
}
function addToNewList() {
  const it = shown.value
  const name = it && prompt('Name of the new collection')
  if (!it || !name) return
  collections.set(collections.create(name).id, it.id, true)
}

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
function applySkin() {
  const v = skinDraft.value.trim()
  if (v === skinName.value) return
  skinName.value = v
  if (shown.value) open(shown.value)
}

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
        <label title="On: rotate to any angle. Off: stays upright (vertical angle limited)."><ToggleSwitch v-model="freeRotate" /> Free rotate</label>
        <i
          v-tooltip.top="{ value: HELP, class: 'help-tip' }"
          class="pi pi-question-circle help"
        />
        <Select v-if="states.length > 1" v-model="state" :options="states" size="small" placeholder="Animation" />
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
        <InputText v-if="usesSkin" v-model="skinDraft" size="small" placeholder="Skin (Minecraft username)" class="skin" title="Loads the skin from mc-heads.net; empty = placeholder" @keyup.enter="applySkin" @blur="applySkin" />
        <Button label="ZIP (source files)" icon="pi pi-download" size="small" @click="downloadZip" />
        <Button label="GLB" icon="pi pi-download" size="small" severity="secondary" @click="downloadGlb" />
      </template>
      <Button v-if="imgSrc" label="Download image" icon="pi pi-download" size="small" @click="downloadUrl(imgSrc, imageName())" />
      <Button
        :icon="fav ? 'pi pi-star-fill' : 'pi pi-star'"
        label="Favorite"
        size="small"
        :severity="fav ? 'warn' : 'secondary'"
        :outlined="!fav"
        @click="shown && collections.toggle(FAV, shown.id)"
      />
      <MultiSelect
        :model-value="inLists"
        :options="listOptions"
        option-label="label"
        option-value="value"
        size="small"
        placeholder="Collections"
        :max-selected-labels="2"
        class="lists"
        @update:model-value="setLists"
      >
        <template #footer>
          <div class="newlist"><Button label="New collection…" icon="pi pi-plus" size="small" text @click="addToNewList" /></div>
        </template>
      </MultiSelect>
      <Button :label="copied ? 'Copied' : 'Copy link'" icon="pi pi-link" size="small" text @click="copyLink" />
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
.scrub { width: 10rem; }
.time { font-variant-numeric: tabular-nums; opacity: 0.7; font-size: 0.85rem; }
.skin { width: 13rem; }
.pose { width: 12rem; }
.lists { width: 12rem; }
.newlist { padding: 0.25rem 0.5rem; }
.help { cursor: help; opacity: 0.6; font-size: 1.1rem; }
.help:hover { opacity: 1; }
label { display: flex; align-items: center; gap: 0.5rem; }
.info { display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem 2rem; margin: 0.75rem 0 0; font-size: 0.85rem; opacity: 0.8; }
.pair { display: grid; grid-template-columns: 6.5rem 1fr; gap: 0 0.75rem; min-width: 0; }
.pair.wide { grid-column: 1 / -1; }
.info dt { opacity: 0.6; }
.info dd { margin: 0; word-break: break-all; }
</style>
<style>
.help-tip { white-space: pre-line; }
</style>
