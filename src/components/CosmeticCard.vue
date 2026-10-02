<script lang="ts">
import { createQueue } from '../queue'

const queue = createQueue(6)
</script>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCollections } from '../collections'
import CollectionPicker from './CollectionPicker.vue'
import AnimatedImage from './AnimatedImage.vue'
import Checkbox from 'primevue/checkbox'
import type { CosmeticItem, CosmeticProvider, LoadedModel } from '../providers/types'
import type { SharedRenderer, Slot } from '../three/sharedRenderer'

// selected: ticked; gray: faded (unselected while a selection exists, or selected but filtered out); selecting: a selection exists.
const props = defineProps<{ provider: CosmeticProvider; item: CosmeticItem; selected?: boolean; gray?: boolean; selecting?: boolean }>()
defineEmits<{ open: []; select: [] }>()

const renderer = inject<SharedRenderer>('renderer')!
const el = ref<HTMLElement>()
const imgSrc = ref('')
const frames = ref<{ frameW?: number; frameH?: number; frametimeMs: number }>()
const ext = props.item.render === 'file' ? (props.item.fields.ext as string | undefined) : undefined
const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const pickerOpen = ref(false)
// Saved items show their bookmark without hovering.
const saved = computed(() => useCollections(props.provider.id).of(props.item.id).length > 0)

let slot: Slot | undefined
let visible = false
let observer: IntersectionObserver | undefined
let model: LoadedModel | undefined

async function activate() {
  if (state.value !== 'idle') return
  state.value = 'loading'
  try {
    if (props.item.render === 'file' || props.item.thumb === 'none') {
      state.value = 'ready'
      return
    }
    // Some 3D items (emotes) use their icon as the card thumbnail; the model loads in the modal.
    if (props.item.render === 'image' || props.item.thumb === 'image') {
      frames.value = props.item.fields.animated ? await props.provider.imageFrames?.(props.item) : undefined
      imgSrc.value = await props.provider.imageUrl(props.item)
      state.value = 'ready'
      return
    }
    const loaded = await queue(async () => (visible ? props.provider.loadModel(props.item) : undefined))
    if (!loaded || !visible) {
      loaded?.dispose()
      state.value = 'idle'
      return
    }
    model = loaded
    slot = { el: el.value!, object: loaded.object, tick: loaded.tick, gray: props.gray }
    renderer.add(slot)
    state.value = 'ready'
  } catch (e) {
    console.warn(props.item.name, e)
    state.value = 'error'
  }
}

// 3D previews are drawn by the shared canvas, so the gray state is passed to its slot.
watch(
  () => props.gray,
  (g) => slot && (slot.gray = g),
)

function release() {
  if (slot) renderer.remove(slot)
  slot = undefined
  model?.dispose()
  model = undefined
  imgSrc.value = ''
  frames.value = undefined
  state.value = 'idle'
}

onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry!.isIntersecting
      if (visible) activate()
      else if (state.value !== 'loading') release()
    },
    { rootMargin: '300px' },
  )
  observer.observe(el.value!)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  visible = false
  release()
})
</script>

<template>
  <div class="card" :class="{ selected, gray, saved }" @click="$emit('open')">
    <div ref="el" class="view">
      <AnimatedImage v-if="imgSrc" :src="imgSrc" v-bind="frames" @error="state = 'error'" />
      <div v-else-if="item.render === 'file'" class="filetile"><i class="pi pi-file" /><span>{{ ext || 'file' }}</span></div>
      <div v-else-if="item.thumb === 'none'" class="filetile"><i class="pi pi-video" /><span>3D</span></div>
      <i v-if="state === 'loading'" class="pi pi-spin pi-spinner" />
      <i v-else-if="state === 'error'" class="pi pi-exclamation-triangle" title="Failed to load" />
    </div>
    <div class="name" :title="item.name">{{ item.name }}</div>
    <div class="pick" :class="{ show: selecting || selected }" @click.stop>
      <Checkbox :model-value="!!selected" binary :title="selected ? 'Deselect' : 'Select'" @update:model-value="$emit('select')" />
    </div>
    <div class="coll" :class="{ show: pickerOpen || saved }" @click.stop>
      <CollectionPicker :provider="provider.id" :item-id="item.id" @open="(o) => (pickerOpen = o)" />
    </div>
  </div>
</template>

<style scoped>
.card { position: relative; background: var(--av-card); border: 1px solid var(--av-border); border-radius: 10px; cursor: pointer; overflow: hidden; content-visibility: auto; contain-intrinsic-size: 190px 230px; }
.card:hover { border-color: var(--p-primary-color); }
.pick { position: absolute; top: 0.4rem; left: 0.4rem; z-index: 3; opacity: 0; transition: opacity 0.15s; }
/* States while a selection exists: selected = accent outline; gray = faded; selected but filtered out = gray with a dashed outline. */
.card.selected { outline: 2px solid var(--p-primary-color); outline-offset: -1px; }
.card.gray .view, .card.gray .name { filter: grayscale(1) opacity(0.5); }
.card.selected.gray { outline-style: dashed; }
/* Top right; SharedRenderer cuts this corner out of the 3D canvas (which sits above the cards) so it stays visible. */
.coll { position: absolute; top: 0.4rem; right: 0.4rem; z-index: 3; opacity: 0; transition: opacity 0.15s; }
.card:hover .coll, .coll.show { opacity: 1; }
.card:hover .pick, .pick.show { opacity: 1; }
.view { position: relative; aspect-ratio: 1; display: grid; place-items: center; overflow: hidden; }
.view .pi-exclamation-triangle { opacity: 0.4; }
.filetile { display: grid; place-items: center; gap: 0.25rem; opacity: 0.7; font-size: 0.8rem; text-transform: uppercase; }
.filetile .pi { font-size: 2.5rem; }
.name { padding: 0.5rem 0.75rem; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
