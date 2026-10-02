<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CosmeticItem, CosmeticProvider } from '../providers/types'
import { SharedRenderer } from '../three/sharedRenderer'
import CosmeticCard from './CosmeticCard.vue'
import CosmeticModal from './CosmeticModal.vue'
import CompareDialog from './CompareDialog.vue'

// selected: ids ticked; passes: scope ids passing the filter (scope = the selection if any, else all), null = no filter.
const props = defineProps<{ provider: CosmeticProvider; items: CosmeticItem[]; cols: number; selected: Set<string>; passes: Set<string> | null }>()
defineEmits<{ select: [id: string] }>()
const route = useRoute()
const router = useRouter()

const container = ref<HTMLElement>()
const renderer = new SharedRenderer()
provide('renderer', renderer)
// The open item lives in the URL (?item=id) so a link opens it directly.
const opened = computed<CosmeticItem | null>(() => {
  const id = route.query.item
  if (typeof id !== 'string') return null
  return props.provider.itemById?.(id) ?? props.items.find((it) => it.id === id) ?? null
})
const openItem = (it: CosmeticItem) => router.replace({ query: { ...route.query, item: it.id } })
function close() {
  const { item: _, ...rest } = route.query
  router.replace({ query: rest })
}

// The open comparison is in the URL (?cmp=id,id); ProviderView's selection bar starts it.
const lookup = (id: string) => props.provider.itemById?.(id) ?? props.items.find((it) => it.id === id)
const cmpItems = computed(() =>
  typeof route.query.cmp === 'string' ? route.query.cmp.split(',').map(lookup).filter((it): it is CosmeticItem => !!it) : [],
)
function closeCompare() {
  const { cmp: _, ...rest } = route.query
  router.replace({ query: rest })
}

// Gray: unselected while a selection exists; or in the scope (selected, or everything when nothing is selected) but failing the filter.
const grayOf = (id: string) =>
  props.selected.size > 0 ? !props.selected.has(id) || (!!props.passes && !props.passes.has(id)) : !!props.passes && !props.passes.has(id)

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
        :selected="selected.has(it.id)"
        :gray="grayOf(it.id)"
        :selecting="selected.size > 0"
        @open="openItem(it)"
        @select="$emit('select', it.id)"
      />
    </div>
  </div>
  <CompareDialog :provider="provider" :items="cmpItems" :visible="cmpItems.length > 1" @close="closeCompare" />
  <CosmeticModal :provider="provider" :item="opened" @close="close" />
</template>

<style scoped>
.grid-wrap { position: relative; flex: 1; overflow: auto; }
.grid { padding: 1rem; display: grid; gap: 0.75rem; }
</style>
