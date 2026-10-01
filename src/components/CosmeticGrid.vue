<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CosmeticItem, CosmeticProvider } from '../providers/types'
import { SharedRenderer } from '../three/sharedRenderer'
import CosmeticCard from './CosmeticCard.vue'
import CosmeticModal from './CosmeticModal.vue'

const props = defineProps<{ provider: CosmeticProvider; items: CosmeticItem[]; cols: number }>()
const route = useRoute()
const router = useRouter()

const container = ref<HTMLElement>()
const renderer = new SharedRenderer()
provide('renderer', renderer)
// The open item lives in the URL (?item=id) so a link opens it directly.
const selected = computed<CosmeticItem | null>(() => {
  const id = route.query.item
  if (typeof id !== 'string') return null
  return props.provider.itemById?.(id) ?? props.items.find((it) => it.id === id) ?? null
})
const openItem = (it: CosmeticItem) => router.replace({ query: { ...route.query, item: it.id } })
function close() {
  const { item: _, ...rest } = route.query
  router.replace({ query: rest })
}

onMounted(() => renderer.attach(container.value!))
onBeforeUnmount(() => renderer.detach())
</script>

<template>
  <div ref="container" class="grid-wrap">
    <div class="grid" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
      <CosmeticCard v-for="it in items" :key="it.id" :provider="provider" :item="it" @open="openItem(it)" />
    </div>
  </div>
  <CosmeticModal :provider="provider" :item="selected" @close="close" />
</template>

<style scoped>
.grid-wrap { position: relative; flex: 1; overflow: auto; }
.grid { padding: 1rem; display: grid; gap: 0.75rem; }
</style>
