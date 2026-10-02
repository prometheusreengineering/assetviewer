<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ src: string; frameW?: number; frameH?: number; frametimeMs?: number }>()
const emit = defineEmits<{ error: [] }>()

const nat = ref<{ w: number; h: number }>()
watch(
  () => props.src,
  (src) => {
    nat.value = undefined
    const img = new Image()
    img.onload = () => (nat.value = { w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => emit('error')
    img.src = src
  },
  { immediate: true },
)

// Stacked animation frames (Minecraft .mcmeta style): frames are `frameW x frameH` tiles, top to bottom.
const sheet = computed(() => {
  const n = nat.value
  if (!n || !props.frametimeMs) return undefined
  const fw = props.frameW && props.frameW <= n.w ? props.frameW : n.w
  const fh = props.frameH && props.frameH <= n.h ? props.frameH : fw
  const frames = Math.max(1, Math.floor(n.h / fh))
  return frames > 1 ? { frames, aspect: fw / fh } : undefined
})
</script>

<template>
  <div class="fit">
    <template v-if="nat">
      <div
        v-if="sheet"
        class="sheet"
        :style="{
          aspectRatio: String(sheet.aspect),
          [sheet.aspect >= 1 ? 'width' : 'height']: '100%',
          backgroundImage: `url(${src})`,
          backgroundSize: `100% ${sheet.frames * 100}%`,
          animation: `sheet-step ${sheet.frames * (frametimeMs ?? 100)}ms steps(${sheet.frames}, jump-none) infinite`,
        }"
      />
      <img v-else :src="src" />
    </template>
  </div>
</template>

<style scoped>
/* The box clips; the image is pinned to it (a percentage height inside an auto-sized grid row made tall images overflow). */
.fit { position: absolute; inset: 0; display: grid; place-items: center; overflow: hidden; }
img { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; object-fit: contain; }
.sheet { image-rendering: pixelated; background-repeat: no-repeat; max-width: 100%; max-height: 100%; }
</style>
<style>
@keyframes sheet-step { from { background-position-y: 0%; } to { background-position-y: 100%; } }
</style>
