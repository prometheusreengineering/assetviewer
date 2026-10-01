<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CosmeticItem, CosmeticProvider } from '../providers/types'
import { SharedRenderer } from '../three/sharedRenderer'
import CosmeticCard from './CosmeticCard.vue'
import CosmeticModal from './CosmeticModal.vue'
import CompareDialog from './CompareDialog.vue'
import Button from 'primevue/button'
import Chip from 'primevue/chip'
import { comparing, toggleCompare } from '../compare'

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

// Compare: picked ids live in a shared store; the open dialog is in the URL (?cmp=id,id).
const lookup = (id: string) => props.provider.itemById?.(id) ?? props.items.find((it) => it.id === id)
const picked = computed(() => comparing.value.map(lookup).filter((it): it is CosmeticItem => !!it))
const cmpItems = computed(() =>
  typeof route.query.cmp === 'string' ? route.query.cmp.split(',').map(lookup).filter((it): it is CosmeticItem => !!it) : [],
)
const openCompare = () => router.replace({ query: { ...route.query, cmp: comparing.value.join(',') } })
function closeCompare() {
  const { cmp: _, ...rest } = route.query
  router.replace({ query: rest })
}

onMounted(() => renderer.attach(container.value!))
onBeforeUnmount(() => renderer.detach())
</script>

<template>
  <div ref="container" class="grid-wrap">
    <div class="grid" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
      <CosmeticCard
        v-for="it in items"
        :key="it.id"
        :provider="provider"
        :item="it"
        :comparing="comparing.includes(it.id)"
        @open="openItem(it)"
        @compare="toggleCompare(it.id)"
      />
    </div>
  </div>
  <div v-if="picked.length" class="tray">
    <span class="t">Compare</span>
    <Chip v-for="it in picked" :key="it.id" :label="it.name" removable @remove="toggleCompare(it.id)" />
    <span v-if="picked.length < 2" class="hint">pick at least 2 (up to 4)</span>
    <Button label="Compare" icon="pi pi-clone" size="small" :disabled="picked.length < 2" @click="openCompare" />
    <Button label="Clear" size="small" text severity="secondary" @click="comparing = []" />
  </div>
  <CompareDialog :provider="provider" :items="cmpItems" :visible="cmpItems.length > 1" @close="closeCompare" />
  <CosmeticModal :provider="provider" :item="selected" @close="close" />
</template>

<style scoped>
.grid-wrap { position: relative; flex: 1; overflow: auto; }
.grid { padding: 1rem; display: grid; gap: 0.75rem; }
.tray { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; padding: 0.6rem 1rem; border-top: 1px solid var(--p-surface-800); background: var(--p-surface-900); }
.tray .t { font-weight: 600; margin-right: 0.25rem; }
.tray .hint { opacity: 0.6; font-size: 0.85rem; }
</style>
