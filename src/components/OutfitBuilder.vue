<script setup lang="ts">
import Button from 'primevue/button'
import Select from 'primevue/select'
import Slider from 'primevue/slider'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CosmeticProvider, Timeline } from '../providers/types'
import { skinName } from '../skin'
import { Viewer } from '../three/viewer'

const props = defineProps<{ provider: CosmeticProvider }>()
const route = useRoute()
const router = useRouter()

// Every wearable 3D category is a slot.
const slots = computed(() => props.provider.categories().filter((c) => c.group?.startsWith('Cosmetics') && c.id !== 'emotes'))
const options = (cat: string) => props.provider.items(cat).map((it) => ({ label: it.name, value: it.id }))
const optionCache = new Map<string, { label: string; value: string }[]>()
const optionsFor = (cat: string) => {
  if (!optionCache.has(cat)) optionCache.set(cat, options(cat))
  return optionCache.get(cat)!
}
const emoteOptions = computed(() => props.provider.items('emotes').map((e) => ({ label: e.name, value: e.id })))

// Outfit = category -> item id. The URL (?o=cat:id,...&e=emote) wins over the saved outfit, so links share it.
const KEY = 'assetviewer.outfit'
type Outfit = Record<string, string>
function parseOutfit(o: unknown): Outfit {
  if (typeof o !== 'string' || !o) return {}
  return Object.fromEntries(
    o
      .split(',')
      .map((p) => [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)])
      .filter(([c, id]) => c && id),
  )
}
const encode = (o: Outfit) => Object.entries(o).map(([c, id]) => `${c}:${id}`).join(',')
let saved: { o?: string; e?: string } = {}
try {
  saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
} catch {}
const fromUrl = typeof route.query.o === 'string' || typeof route.query.e === 'string'
const outfit = ref<Outfit>(parseOutfit(fromUrl ? route.query.o : saved.o))
const emoteId = ref<string | null>(((fromUrl ? route.query.e : saved.e) as string) || null)

const host = ref<HTMLElement>()
let viewer: Viewer | undefined
const loading = ref(false)
const error = ref('')
const autoRotate = ref(true)
const timeline = shallowRef<Timeline>()
const tlTime = ref(0)
const playing = ref(true)
let token = 0

const worn = computed(() => Object.values(outfit.value).map((id) => props.provider.itemById?.(id)).filter((x) => !!x))

async function rebuild() {
  if (!viewer || !props.provider.dressPlayer) return
  const mine = ++token
  loading.value = true
  error.value = ''
  try {
    const emote = emoteId.value ? props.provider.itemById?.(emoteId.value) : undefined
    const model = await props.provider.dressPlayer(worn.value, emote)
    if (mine !== token || !viewer) return model.dispose()
    viewer.setModel(model)
    timeline.value = model.timeline
    playing.value = true
  } catch (e) {
    if (mine === token) error.value = String(e)
  } finally {
    if (mine === token) loading.value = false
  }
}

watch([outfit, emoteId], ([o, e]) => {
  const q = { o: encode(o) || undefined, e: e || undefined }
  try {
    localStorage.setItem(KEY, JSON.stringify(q))
  } catch {}
  router.replace({ query: { ...route.query, ...q } })
  rebuild()
}, { deep: true })
watch(autoRotate, (v) => viewer && (viewer.autoRotate = v))

function setSlot(cat: string, id: string | null) {
  const o = { ...outfit.value }
  if (id) o[cat] = id
  else delete o[cat]
  outfit.value = o
}
function randomize() {
  // One random item in a few common slots; the rest are left empty.
  const pick = ['hat', 'cloak', 'dragon_wings', 'backpack', 'shoes', 'neckwear'].filter((c) => slots.value.some((s) => s.id === c))
  const o: Outfit = {}
  for (const c of pick) {
    const list = props.provider.items(c)
    if (list.length && Math.random() < 0.8) o[c] = list[Math.floor(Math.random() * list.length)]!.id
  }
  outfit.value = o
}
const copied = ref(false)
async function copyLink() {
  await navigator.clipboard.writeText(location.href)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
// The header's player name changed.
watch(skinName, rebuild)
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

onMounted(() => {
  viewer = new Viewer(host.value!)
  viewer.onFrame = (m) => {
    const tl = m.timeline
    if (tl && Math.abs(tl.time - tlTime.value) >= 0.05) tlTime.value = Math.round(tl.time * 20) / 20
  }
  rebuild()
})
onBeforeUnmount(() => {
  token++
  viewer?.dispose()
  viewer = undefined
})
</script>

<template>
  <div class="outfit">
    <aside class="slots">
      <div class="head">
        <Button label="Random" icon="pi pi-sparkles" size="small" severity="secondary" @click="randomize" />
        <Button label="Clear" icon="pi pi-times" size="small" severity="secondary" text :disabled="!worn.length" @click="outfit = {}" />
        <Button :label="copied ? 'Copied' : 'Copy link'" icon="pi pi-link" size="small" text @click="copyLink" />
      </div>
      <label v-for="s in slots" :key="s.id" class="slot">
        <span><i :class="['pi', s.icon]" /> {{ s.label }}</span>
        <Select
          :model-value="outfit[s.id] ?? null"
          :options="optionsFor(s.id)"
          option-label="label"
          option-value="value"
          filter
          show-clear
          size="small"
          placeholder="None"
          :virtual-scroller-options="{ itemSize: 34 }"
          class="pick"
          @update:model-value="(v: string | null) => setSlot(s.id, v)"
        />
      </label>
    </aside>
    <section class="stage">
      <div ref="host" class="canvas" />
      <i v-if="loading" class="pi pi-spin pi-spinner busy" />
      <p v-if="error" class="err">{{ error }}</p>
      <div class="controls">
        <label><ToggleSwitch v-model="autoRotate" /> Auto-rotate</label>
        <Select v-model="emoteId" :options="emoteOptions" option-label="label" option-value="value" filter show-clear size="small" placeholder="Pose: standing" class="pose" />
        <template v-if="timeline">
          <Button :icon="playing ? 'pi pi-pause' : 'pi pi-play'" size="small" text rounded @click="togglePlay" />
          <Slider :model-value="tlTime" :min="0" :max="timeline.duration" :step="0.05" class="scrub" @update:model-value="seek" />
        </template>
        <span class="count">{{ worn.length }} worn</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.outfit { display: flex; flex: 1; min-height: 0; }
.slots { width: 300px; overflow-y: auto; padding: 0.75rem 1rem; border-right: 1px solid var(--p-surface-800); display: flex; flex-direction: column; gap: 0.5rem; }
.head { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 0.25rem; }
.slot { display: grid; grid-template-columns: 7.5rem 1fr; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
.slot span { opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slot .pi { font-size: 0.8rem; opacity: 0.7; }
.pick { min-width: 0; }
.stage { position: relative; flex: 1; display: flex; flex-direction: column; min-width: 0; }
.canvas { flex: 1; min-height: 0; }
.busy { position: absolute; top: 1rem; right: 1rem; font-size: 1.5rem; }
.err { position: absolute; top: 1rem; left: 1rem; color: var(--p-red-400); }
.controls { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; padding: 0.75rem 1rem; border-top: 1px solid var(--p-surface-800); }
.controls label { display: flex; align-items: center; gap: 0.5rem; }
.pose { width: 13rem; }
.scrub { width: 10rem; }
.count { margin-left: auto; opacity: 0.6; }
</style>
