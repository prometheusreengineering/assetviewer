<script setup lang="ts">
import Menu from 'primevue/menu'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Select from 'primevue/select'
import Slider from 'primevue/slider'
import { computed, onBeforeUnmount, provide, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CosmeticGrid from '../components/CosmeticGrid.vue'
import FilterBar from '../components/FilterBar.vue'
import FileBrowser from '../components/FileBrowser.vue'
import OutfitBuilder from '../components/OutfitBuilder.vue'
import { applyView, decodeRules, decodeSorts, encodeRules, encodeSorts, type Rule, type SortKey } from '../filtering'
import { providers } from '../providers'
import { stats } from '../stats'
import { COLLECTION_PREFIX, FAV, useCollections } from '../collections'
import Button from 'primevue/button'
import type { CategoryDef, CosmeticItem, FieldDef } from '../providers/types'

const props = defineProps<{ provider: string; category?: string }>()
const router = useRouter()
const route = useRoute()
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
const collections = computed(() => useCollections(props.provider))
const collection = computed(() => (props.category?.startsWith(COLLECTION_PREFIX) ? collections.value.get(props.category.slice(COLLECTION_PREFIX.length)) : undefined))

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
    // A shared link (?q=&f=&s=) wins over the remembered sort.
    const q = route.query
    search.value = typeof q.q === 'string' ? q.q : ''
    animState.value = ''
    animStates.value = []
    rules.value = typeof q.f === 'string' ? decodeRules(q.f) : []
    sorts.value = typeof q.s === 'string' ? decodeSorts(q.s) : loadSort()
    cancelMeasure()
  },
  { immediate: true },
)
// Keep the view in the URL so it can be shared (outfit/all-files pages manage their own query).
watch(
  [search, rules, sorts],
  () => {
    if (isTool.value || !props.category) return
    const next = { ...route.query, q: search.value || undefined, f: encodeRules(rules.value) || undefined, s: encodeSorts(sorts.value) || undefined }
    if (next.q === route.query.q && next.f === route.query.f && next.s === route.query.s) return
    router.replace({ query: next })
  },
  { deep: true },
)
watch(sorts, (v) => {
  try {
    localStorage.setItem(sortKey(), JSON.stringify(v))
  } catch {}
})

const allItems = computed<CosmeticItem[]>(() => {
  if (!ready.value || !props.category || isTool.value) return []
  if (collection.value) return collection.value.items.map((id) => provider.value.itemById?.(id)).filter((it): it is CosmeticItem => !!it)
  return provider.value.items(props.category)
})
// A collection mixes categories: offer the union of their fields (multi options merged).
const fields = computed<FieldDef[]>(() => {
  if (!ready.value || !props.category || isTool.value) return []
  if (!collection.value) return provider.value.fields(props.category)
  const out = new Map<string, FieldDef>()
  for (const cat of new Set(allItems.value.map((it) => it.category))) {
    for (const f of provider.value.fields(cat)) {
      const prev = out.get(f.key)
      out.set(f.key, prev?.options && f.options ? { ...prev, options: [...new Set([...prev.options, ...f.options])].sort() } : prev ?? f)
    }
  }
  return [...out.values()]
})

// ---- collection actions -----------------------------------------------------
const importInput = ref<HTMLInputElement>()
function newCollection() {
  const name = prompt('Name of the new collection')
  if (!name) return
  const c = collections.value.create(name)
  router.push(`/${props.provider}/${COLLECTION_PREFIX}${c.id}`)
}
function renameCollection() {
  const c = collection.value
  const name = c && prompt('Rename collection', c.name)
  if (c && name) collections.value.rename(c.id, name)
}
function deleteCollection() {
  const c = collection.value
  if (!c || c.id === FAV || !confirm(`Delete "${c.name}"? (${c.items.length} items)`)) return
  collections.value.remove(c.id)
  router.push(`/${props.provider}/${COLLECTION_PREFIX}${FAV}`)
}
function exportCollection() {
  const c = collection.value
  if (!c) return
  const json = collections.value.exportJson([c.id], (id) => provider.value.itemById?.(id)?.name)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  a.download = `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
async function importCollections(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const n = collections.value.importJson(await file.text())
    alert(`Imported ${n} item${n === 1 ? '' : 's'}.`)
  } catch (err) {
    alert(String(err))
  } finally {
    ;(e.target as HTMLInputElement).value = ''
  }
}

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
  const model = [...groups].map(([label, items]) => ({ label, items }))
  if (provider.value.available) {
    const lists: { label: string; icon: string; class: string; command: () => void }[] = collections.value.all().map((c) => ({
      label: `${c.name} (${c.items.length})`,
      icon: c.id === FAV ? 'pi pi-star-fill' : 'pi pi-list',
      class: props.category === COLLECTION_PREFIX + c.id ? 'cat-active' : '',
      command: () => void router.push(`/${props.provider}/${COLLECTION_PREFIX}${c.id}`),
    }))
    lists.push({ label: 'New collection', icon: 'pi pi-plus', class: '', command: newCollection })
    // Right after "All files" and Tools.
    const at = model.findIndex((g) => g.label.startsWith('Cosmetics'))
    model.splice(at < 0 ? model.length : at, 0, { label: 'Collections', items: lists })
  }
  return model
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
        <template v-if="collection">
          <Button icon="pi pi-pencil" size="small" text severity="secondary" title="Rename" @click="renameCollection" />
          <Button v-if="collection.id !== 'fav'" icon="pi pi-trash" size="small" text severity="secondary" title="Delete collection" @click="deleteCollection" />
          <Button icon="pi pi-download" size="small" text severity="secondary" title="Export as JSON" @click="exportCollection" />
          <Button icon="pi pi-upload" size="small" text severity="secondary" title="Import JSON" @click="importInput?.click()" />
          <input ref="importInput" type="file" accept="application/json,.json" hidden @change="importCollections" />
        </template>
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
