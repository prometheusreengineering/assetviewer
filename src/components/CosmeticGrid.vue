<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref } from 'vue'
import type { CosmeticItem, CosmeticProvider } from '../providers/types'
import { SharedRenderer } from '../three/sharedRenderer'
import CosmeticCard from './CosmeticCard.vue'
import CosmeticModal from './CosmeticModal.vue'

defineProps<{ provider: CosmeticProvider; items: CosmeticItem[]; cols: number }>()

const container = ref<HTMLElement>()
const renderer = new SharedRenderer()
provide('renderer', renderer)
const selected = ref<CosmeticItem | null>(null)

onMounted(() => renderer.attach(container.value!))
onBeforeUnmount(() => renderer.detach())
</script>

<template>
  <div ref="container" class="grid-wrap">
    <div class="grid" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
      <CosmeticCard v-for="it in items" :key="it.id" :provider="provider" :item="it" @open="selected = it" />
    </div>
  </div>
  <CosmeticModal :provider="provider" :item="selected" @close="selected = null" />
</template>

<style scoped>
.grid-wrap { position: relative; flex: 1; overflow: auto; }
.grid { padding: 1rem; display: grid; gap: 0.75rem; }
</style>
