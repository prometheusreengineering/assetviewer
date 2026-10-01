<script setup lang="ts">
import Menu from 'primevue/menu'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Select from 'primevue/select'
import Slider from 'primevue/slider'
import { computed, onBeforeUnmount, provide, ref, watch, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import CosmeticGrid from '../components/CosmeticGrid.vue'
import FilterBar from '../components/FilterBar.vue'
import FileBrowser from '../components/FileBrowser.vue'
import OutfitBuilder from '../components/OutfitBuilder.vue'
import { applyView, type Rule, type SortKey } from '../filtering'
import { providers } from '../providers'
import { stats } from '../stats'
import type { CategoryDef, CosmeticItem, FieldDef } from '../providers/types'

const props = defineProps<{ provider: string; category?: string }>()
const router = useRouter()
const provider = computed(() => providers[props.provider]!)

const ready = ref(false)
const error = ref('')
const categories = ref<CategoryDef[]>([])

watchEffect(async () => {
  ready.value = false
  error.value = ''
  if (!provider.value.available) return
  try {
    await provider.value.load()
    categories.value = provider.value.categories()
    const st = provider.value.stats?.()
    if (st) stats.value = { name: provider.value.name, ...st }
    ready.value = true
    if (!props.category && categories.value[0]) {
      const first = categories.value.find((c) => c.id === 'hat') ?? categories.value[0]
      router.replace(`/${props.provider}/${first.id}`)
    }
  } catch (e) {
    error.value = String(e)
  }
})

const isFiles = computed(() => props.category === 'all-files')
const isOutfit = computed(() => props.category === 'outfit')
// Pages that are not an item grid.
const isTool = computed(() => isFiles.value || isOutfit.value)

const search = ref('')

// Animation state applied to every 3D thumbnail that has it (e.g. wings: elytra). Cards report the states they find.
const animState = ref('')
const animStates = ref<string[]>([])
provide('animState', animState)
provide('animStates', animStates)
const ORDER = ['idle', 'moving', 'elytra', 'gui']
const animOptions = computed(() => [...animStates.value].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)))
const rules = ref<Rule[]>([])
const sorts = ref<SortKey[]>([])

const dimVersion = ref(0)
const measuring = ref<{ done: number; total: number }>()
let abort: AbortController | undefined
function cancelMeasure() {
  abort?.abort()
  abort = undefined
  measuring.value = undefined
}
onBeforeUnmount(cancelMeasure)
// The last sort is remembered per category.
const sortKey = () => `assetviewer.sort.${props.provider}.${props.category}`
function loadSort(): SortKey[] {
  try {
    const v = JSON.parse(localStorage.getItem(sortKey()) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
watch(
  () => props.category,
  () => {
    search.value = ''
    animState.value = ''
    animStates.value = []
    rules.value = []
    sorts.value = loadSort()
    cancelMeasure()
  },
  { immediate: true },
)
watch(sorts, (v) => {
  try {
    localStorage.setItem(sortKey(), JSON.stringify(v))
  } catch {}
})

const fields = computed<FieldDef[]>(() => (ready.value && props.category && !isTool.value ? provider.value.fields(props.category) : []))
const allItems = computed<CosmeticItem[]>(() => (ready.value && props.category && !isTool.value ? provider.value.items(props.category) : []))

// Image width/height are read lazily (a few header bytes per file) once a rule or sort needs them.
const needsDims = computed(() => [...rules.value, ...sorts.value].some((x) => x.field === 'width' || x.field === 'height'))
watch([needsDims, allItems], async ([need]) => {
  if (!need || !provider.value.ensureDimensions) return
  cancelMeasure()
  const ctl = (abort = new AbortController())
  let last = 0
  await provider.value.ensureDimensions(
    allItems.value,
    (done, total) => {
      measuring.value = { done, total }
      if (done - last >= 100 || done === total) (last = done, dimVersion.value++)
    },
    ctl.signal,
  )
  if (!ctl.signal.aborted) dimVersion.value++
})

const items = computed(() => {
  void dimVersion.value
  return applyView(allItems.value, search.value, rules.value, sorts.value, fields.value)
})

// Cards per row (zoom): fewer columns means bigger previews.
const COLS_KEY = 'assetviewer.cols'
const cols = ref(6)
try {
  const saved = Number(localStorage.getItem(COLS_KEY))
  if (saved >= 2 && saved <= 12) cols.value = saved
} catch {}
watch(cols, (c) => {
  try {
    localStorage.setItem(COLS_KEY, String(c))
  } catch {}
})


const menuModel = computed(() => {
  const groups = new Map<string, object[]>()
  for (const c of categories.value) {
    const g = c.group ?? ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push({
      label: c.group === 'Tools' ? c.label : `${c.label} (${c.count})`,
      icon: `pi ${c.icon}`,
      class: c.id === props.category ? 'cat-active' : '',
      command: () => router.push(`/${props.provider}/${c.id}`),
    })
  }
  return [...groups].map(([label, items]) => ({ label, items }))
})
</script>

<template>
  <div v-if="!provider.available" class="center">
    <div>
      <h2>{{ provider.name }} is coming soon</h2>
      <p>This section will use its own models, fields and filters.</p>
    </div>
  </div>
  <Message v-else-if="error" severity="error" class="m">{{ error }}</Message>
  <div v-else-if="!ready" class="center"><ProgressSpinner /></div>
  <div v-else class="layout">
    <aside class="side"><Menu :model="menuModel" /></aside>
    <section class="main">
      <FileBrowser v-if="isFiles" :provider="provider" />
      <OutfitBuilder v-else-if="isOutfit" :provider="provider" />
      <template v-else>
      <div class="toolbar">
        <FilterBar v-model:search="search" v-model:rules="rules" v-model:sorts="sorts" :fields="fields" :measuring="measuring">
          <Select
            v-if="animOptions.length"
            :model-value="animState || null"
            :options="animOptions"
            placeholder="Animation"
            show-clear
            class="anim"
            title="Animation shown on all 3D thumbnails"
            @update:model-value="(v: string | null) => (animState = v ?? '')"
          />
        <span class="count">{{ items.length }} items</span>
        <label class="zoom" title="Cards per row"><i class="pi pi-search-minus" /><Slider v-model="cols" :min="2" :max="12" class="slider" /><i class="pi pi-search-plus" /></label>
        </FilterBar>
      </div>
      <CosmeticGrid :key="provider.id + category" :provider="provider" :items="items" :cols="cols" />
      </template>
    </section>
  </div>
</template>

<style scoped>
.center { display: grid; place-items: center; flex: 1; text-align: center; }
.m { margin: 1rem; }
.layout { display: flex; flex: 1; min-height: 0; }
.side { width: 230px; overflow-y: auto; padding: 0.75rem; border-right: 1px solid var(--p-surface-800); }
.side :deep(.p-menu) { width: 100%; border: 0; background: transparent; }
.side :deep(.cat-active .p-menu-item-content) { background: var(--p-surface-800); color: var(--p-primary-color); }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid var(--p-surface-800); }
.ms { min-width: 12rem; max-width: 22rem; }
.anim { min-width: 11rem; }
.count { margin-left: auto; opacity: 0.6; }
.zoom { display: flex; align-items: center; gap: 0.6rem; opacity: 0.85; }
.slider { width: 9rem; }
</style>
