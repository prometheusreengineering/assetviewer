<script lang="ts">
import { createQueue } from '../queue'

const queue = createQueue(6)
</script>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { FAV, useCollections } from '../collections'
import AnimatedImage from './AnimatedImage.vue'
import type { CosmeticItem, CosmeticProvider, LoadedModel } from '../providers/types'
import type { SharedRenderer, Slot } from '../three/sharedRenderer'

const props = defineProps<{ provider: CosmeticProvider; item: CosmeticItem }>()
defineEmits<{ open: [] }>()

const renderer = inject<SharedRenderer>('renderer')!
// Grid-wide animation state chosen in the toolbar, and the states discovered so far.
const anim = inject<Ref<string>>('animState', ref(''))
const known = inject<Ref<string[]>>('animStates', ref([]))
const el = ref<HTMLElement>()
const imgSrc = ref('')
const frames = ref<{ frameW?: number; frameH?: number; frametimeMs: number }>()
const ext = props.item.render === 'file' ? (props.item.fields.ext as string | undefined) : undefined
const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const collections = useCollections(props.provider.id)
const fav = computed(() => collections.has(FAV, props.item.id))

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
    if (loaded.states.some((s) => !known.value.includes(s))) known.value = [...new Set([...known.value, ...loaded.states])]
    applyAnim()
    slot = { el: el.value!, object: loaded.object, tick: loaded.tick }
    renderer.add(slot)
    state.value = 'ready'
  } catch (e) {
    console.warn(props.item.name, e)
    state.value = 'error'
  }
}

function applyAnim() {
  if (model && anim.value && model.states.includes(anim.value)) model.setState(anim.value)
}
watch(anim, applyAnim)

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
  <div class="card" @click="$emit('open')">
    <div ref="el" class="view">
      <AnimatedImage v-if="imgSrc" :src="imgSrc" v-bind="frames" @error="state = 'error'" />
      <div v-else-if="item.render === 'file'" class="filetile"><i class="pi pi-file" /><span>{{ ext || 'file' }}</span></div>
      <div v-else-if="item.thumb === 'none'" class="filetile"><i class="pi pi-video" /><span>3D</span></div>
      <i v-if="state === 'loading'" class="pi pi-spin pi-spinner" />
      <i v-else-if="state === 'error'" class="pi pi-exclamation-triangle" title="Failed to load" />
    </div>
    <div class="name" :title="item.name">{{ item.name }}</div>
    <button class="star" :class="{ on: fav }" :title="fav ? 'Remove from Favorites' : 'Add to Favorites'" @click.stop="collections.toggle(FAV, item.id)">
      <i :class="fav ? 'pi pi-star-fill' : 'pi pi-star'" />
    </button>
  </div>
</template>

<style scoped>
.card { position: relative; background: var(--p-surface-900); border: 1px solid var(--p-surface-800); border-radius: 10px; cursor: pointer; overflow: hidden; content-visibility: auto; contain-intrinsic-size: 190px 230px; }
.card:hover { border-color: var(--p-primary-color); }
.star { position: absolute; top: 0.4rem; right: 0.4rem; border: 0; background: color-mix(in srgb, var(--p-surface-950) 70%, transparent); color: var(--p-surface-300); border-radius: 50%; width: 1.9rem; height: 1.9rem; cursor: pointer; opacity: 0; transition: opacity 0.15s; }
.card:hover .star, .star.on { opacity: 1; }
.star.on { color: #f5c542; }
.view { position: relative; aspect-ratio: 1; display: grid; place-items: center; }
.view .pi-exclamation-triangle { opacity: 0.4; }
.filetile { display: grid; place-items: center; gap: 0.25rem; opacity: 0.7; font-size: 0.8rem; text-transform: uppercase; }
.filetile .pi { font-size: 2.5rem; }
.name { padding: 0.5rem 0.75rem; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
