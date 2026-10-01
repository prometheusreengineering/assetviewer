<script lang="ts">
import { createQueue } from '../queue'

const queue = createQueue(6)
</script>

<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CosmeticItem, CosmeticProvider, LoadedModel } from '../providers/types'
import type { SharedRenderer, Slot } from '../three/sharedRenderer'

const props = defineProps<{ provider: CosmeticProvider; item: CosmeticItem }>()
defineEmits<{ open: [] }>()

const renderer = inject<SharedRenderer>('renderer')!
const el = ref<HTMLElement>()
const imgSrc = ref('')
const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')

let slot: Slot | undefined
let visible = false
let observer: IntersectionObserver | undefined
let model: LoadedModel | undefined

async function activate() {
  if (state.value !== 'idle') return
  state.value = 'loading'
  try {
    if (props.item.render === 'image') {
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
    slot = { el: el.value!, object: loaded.object, tick: loaded.tick }
    renderer.add(slot)
    state.value = 'ready'
  } catch (e) {
    console.warn(props.item.name, e)
    state.value = 'error'
  }
}

function release() {
  if (slot) renderer.remove(slot)
  slot = undefined
  model?.dispose()
  model = undefined
  imgSrc.value = ''
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
      <img v-if="imgSrc" :src="imgSrc" :alt="item.name" />
      <i v-if="state === 'loading'" class="pi pi-spin pi-spinner" />
      <i v-else-if="state === 'error'" class="pi pi-exclamation-triangle" title="Failed to load" />
    </div>
    <div class="name" :title="item.name">{{ item.name }}</div>
  </div>
</template>

<style scoped>
.card { background: var(--p-surface-900); border: 1px solid var(--p-surface-800); border-radius: 10px; cursor: pointer; overflow: hidden; content-visibility: auto; contain-intrinsic-size: 190px 230px; }
.card:hover { border-color: var(--p-primary-color); }
.view { position: relative; aspect-ratio: 1; display: grid; place-items: center; }
.view img { max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: pixelated; }
.name { padding: 0.5rem 0.75rem; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
