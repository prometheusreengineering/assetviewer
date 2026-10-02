<script setup lang="ts">
import Menu from 'primevue/menu'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Slider from 'primevue/slider'
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CosmeticGrid from '../components/CosmeticGrid.vue'
import FilterBar from '../components/FilterBar.vue'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'
import { autoRotate } from '../viewPrefs'
import HomeView from '../components/HomeView.vue'
import ProviderSwitch from '../components/ProviderSwitch.vue'
import SideControls from '../components/SideControls.vue'
import OutfitBuilder from '../components/OutfitBuilder.vue'
import ExportButton from '../components/ExportButton.vue'
import { applyView, decodeRules, decodeSorts, encodeRules, encodeSorts, type Rule, type SortKey } from '../filtering'
import { providers } from '../providers'
import { stats } from '../stats'
import { COLLECTION_PREFIX, FAV, useCollections } from '../collections'
import { clearSelection, MAX_COMPARE, selection, setSelection, toggleSelected } from '../selection'
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
    if (props.category === 'all-files') return void router.replace(`/${props.provider}/everything`)
    if (!props.category) router.replace(`/${props.provider}/home`)
  } catch (e) {
    error.value = String(e)
  }
})

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
const isOutfit = computed(() => props.category === 'outfit')
// Pages that are not an item grid.
const isHome = computed(() => props.category === 'home')
const isTool = computed(() => isOutfit.value || isHome.value)
const collections = computed(() => useCollections(props.provider))
const collection = computed(() => (props.category?.startsWith(COLLECTION_PREFIX) ? collections.value.get(props.category.slice(COLLECTION_PREFIX.length)) : undefined))
// Tab title: the page you're on, then the app.
watchEffect(() => {
  const c = props.category
  const label = c === 'home' || !c ? '' : collection.value?.name ?? categories.value.find((x) => x.id === c)?.label ?? ''
  document.title = label ? `${label} · Asset Viewer` : provider.value.available ? 'Asset Viewer – Lunar Client cosmetics viewer' : `${provider.value.name} · Asset Viewer`
})

// Categories bigger than this get a performance warning.
const LAG_LIMIT = 500
const search = ref('')
// Grid of cards or a compact list; remembered across categories.
const VIEWS = [
  { value: 'grid', icon: 'pi pi-th-large', title: 'Grid view' },
  { value: 'list', icon: 'pi pi-list', title: 'List view' },
]
const view = ref<'grid' | 'list'>('grid')
try {
  if (localStorage.getItem('assetviewer.view') === 'list') view.value = 'list'
} catch {}
watch(view, (v) => {
  try {
    localStorage.setItem('assetviewer.view', v)
  } catch {}
})

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
    rules.value = typeof q.f === 'string' ? decodeRules(q.f) : []
    sorts.value = typeof q.s === 'string' ? decodeSorts(q.s) : loadSort()
    clearSelection()
    cancelMeasure()
  },
  { immediate: true },
)
// Keep the view in the URL so it can be shared (the outfit page manage their own query).
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

// Search is the only thing that hides items. Filter and sort never remove anything.
const items = computed(() => {
  void dimVersion.value
  return applyView(allItems.value, search.value, [], [], fields.value)
})

// ---- selection, filter and sort -------------------------------------------
// One bar. The "scope" is the selection when there is one, otherwise everything shown.
//  - sort orders the scope (the selected cards reorder among their own grid slots; unselected stay put)
//  - filter never hides: scope items that fail are grayed out, scope items that pass move to the top
const selectedSet = computed(() => new Set(selection.value))
const ordered = computed(() => {
  void dimVersion.value
  if (!sorts.value.length) return items.value
  if (!selection.value.length) return applyView(items.value, '', [], sorts.value, fields.value)
  const sorted = applyView(items.value.filter((it) => selectedSet.value.has(it.id)), '', [], sorts.value, fields.value)
  let k = 0
  return items.value.map((it) => (selectedSet.value.has(it.id) ? sorted[k++]! : it))
})
const scope = computed(() => (selection.value.length ? ordered.value.filter((it) => selectedSet.value.has(it.id)) : ordered.value))
// Ids of the scope items that pass the filter (null = no filter).
const passes = computed<Set<string> | null>(() =>
  rules.value.length ? new Set(applyView(scope.value, '', rules.value, [], fields.value).map((it) => it.id)) : null,
)
const displayItems = computed(() => {
  const p = passes.value
  if (!p) return ordered.value
  const top = ordered.value.filter((it) => p.has(it.id))
  return [...top, ...ordered.value.filter((it) => !p.has(it.id))]
})
// What Export and Compare act on: the scope items that pass the filter, in shown order.
const actionItems = computed(() => (passes.value ? scope.value.filter((it) => passes.value!.has(it.id)) : scope.value))
const allSelected = computed(() => items.value.length > 0 && items.value.every((it) => selectedSet.value.has(it.id)))
const toggleSelectAll = () => (allSelected.value ? clearSelection() : setSelection(items.value.map((it) => it.id)))
const canCompare = computed(() => selection.value.length > 0 && actionItems.value.length >= 2 && actionItems.value.length <= MAX_COMPARE)
const compareHint = computed(() => {
  if (!selection.value.length) return 'Tick 2 to ' + MAX_COMPARE + ' cards to compare them side by side'
  const n = actionItems.value.length
  if (n < 2) return `Needs at least 2 selected items${passes.value ? ' that pass the filter' : ''} (${n} now). Tick more cards${passes.value ? ' or adjust the filter' : ''}.`
  if (n > MAX_COMPARE) return `At most ${MAX_COMPARE} items can be compared (${n} selected). Untick some cards or narrow the selection with a filter.`
  return 'Compare side by side'
})
const exportHint = computed(() => {
  if (!selection.value.length) return 'Tick cards (or use Select all) to export their source files as a ZIP'
  if (!actionItems.value.length) return 'None of the selected items pass the filter. Adjust or clear the filter, or select more cards.'
  return `Export the source files of ${actionItems.value.length} item(s) as a ZIP`
})
const compare = () => router.replace({ query: { ...route.query, cmp: actionItems.value.map((it) => it.id).join(',') } })

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
  const home = { label: 'Home', icon: 'pi pi-home', class: props.category === 'home' ? 'cat-active' : '', command: () => void router.push(`/${props.provider}/home`) }
  const top = model.find((g) => g.label === '')
  if (top) top.items.unshift(home)
  else model.unshift({ label: '', items: [home] })
  const tools = model.findIndex((g) => g.label === 'Tools')
  const toolsGroup = tools < 0 ? undefined : model.splice(tools, 1)[0]
  if (provider.value.available) {
    const lists: { label: string; icon: string; class: string; command: () => void }[] = collections.value.all().map((c) => ({
      label: `${c.name} (${c.items.length})`,
      icon: 'pi pi-bookmark',
      class: props.category === COLLECTION_PREFIX + c.id ? 'cat-active' : '',
      command: () => void router.push(`/${props.provider}/${COLLECTION_PREFIX}${c.id}`),
    }))
    lists.push({ label: 'New collection', icon: 'pi pi-plus', class: '', command: newCollection })
    model.push({ label: 'Collections', items: lists })
  }
  if (toolsGroup) model.push(toolsGroup)
  return model
})
</script>

<template>
  <div class="layout">
    <aside class="side">
      <ProviderSwitch :provider="provider.id" />
      <div class="side-menu"><Menu v-if="ready" :model="menuModel" /></div>
      <SideControls />
    </aside>
    <section class="main">
      <div v-if="!provider.available" class="center">
        <div>
          <h2>{{ provider.name }} is coming soon</h2>
          <p>This section will use its own models, fields and filters.</p>
        </div>
      </div>
      <Message v-else-if="error" severity="error" class="m">{{ error }}</Message>
      <div v-else-if="!ready" class="center"><ProgressSpinner /></div>
      <template v-else>
      <HomeView v-if="isHome" :name="provider.name" />
      <OutfitBuilder v-else-if="isOutfit" :provider="provider" />
      <template v-else>
      <div v-if="collection" class="collbar">
        <h2 class="collname icon-text"><i class="pi pi-bookmark-fill" />{{ collection.name }}</h2>
        <span class="collcount">{{ plural(collection.items.length, 'item') }}</span>
        <span class="collactions">
          <Button label="Rename" icon="pi pi-pencil" size="small" severity="secondary" @click="renameCollection" />
          <Button v-if="collection.id !== 'fav'" label="Delete" icon="pi pi-trash" size="small" severity="secondary" @click="deleteCollection" />
          <Button label="Export" icon="pi pi-download" size="small" severity="secondary" title="Export this collection as JSON" @click="exportCollection" />
          <Button label="Import" icon="pi pi-upload" size="small" severity="secondary" title="Import collections from JSON" @click="importInput?.click()" />
          <input ref="importInput" type="file" accept="application/json,.json" hidden @change="importCollections" />
        </span>
      </div>
      <div class="toolbar">
        <FilterBar v-model:search="search" v-model:rules="rules" v-model:sorts="sorts" :fields="fields" :measuring="measuring">
        <Button :label="allSelected ? 'Deselect all' : 'Select all'" :icon="allSelected ? 'pi pi-minus-circle' : 'pi pi-check-square'" size="small" severity="secondary" :disabled="!items.length" @click="toggleSelectAll" />
        <!-- Selection actions are always there; they gray out (with a tooltip saying why) until they can work. -->
        <span :title="compareHint"><Button label="Compare" icon="pi pi-clone" size="small" severity="secondary" :disabled="!canCompare" @click="compare" /></span>
        <span :title="exportHint"><ExportButton :provider="provider" :items="selection.length ? actionItems : []" :disabled="!selection.length" :name="`${collection?.name ?? category ?? 'export'}_selection`" /></span>
        <template v-if="selection.length">
          <strong class="selcount">{{ actionItems.length }} selected</strong>
          <Button label="Clear" size="small" text severity="secondary" @click="clearSelection" />
        </template>
        <span class="count">{{ plural(items.length, 'item') }}</span>
        <SelectButton v-model="view" :options="VIEWS" option-value="value" option-label="title" :allow-empty="false" size="small" aria-label="View">
          <template #option="{ option }"><i :class="option.icon" :title="option.title" /></template>
        </SelectButton>
        <label v-if="view === 'grid'" class="zoom" title="Cards per row"><i class="pi pi-search-plus" /><Slider v-model="cols" :min="2" :max="12" class="slider" /><i class="pi pi-search-minus" /></label>
        <label v-if="view === 'grid'" class="zoom" title="Rotate the 3D thumbnails (also applies to the modal, compare and outfit builder)"><ToggleSwitch v-model="autoRotate" /> Auto-rotate</label>
        </FilterBar>
      </div>
      <Message v-if="allItems.length > LAG_LIMIT" severity="warn" :closable="false" class="lag" icon="pi pi-exclamation-triangle">
        This category has {{ allItems.length.toLocaleString() }} items, so you may notice subpar performance.
      </Message>
      <CosmeticGrid
        :key="provider.id + category"
        :provider="provider"
        :items="displayItems"
        :cols="cols"
        :view="view"
        :selected="selectedSet"
        :passes="passes"
        @select="toggleSelected"
      />
      </template>
      </template>
    </section>
  </div>
</template>

<style scoped>
.center { display: grid; place-items: center; flex: 1; text-align: center; }
.m { margin: 1rem; }
.layout { display: flex; flex: 1; min-height: 0; }
.side { width: 250px; display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem; border-right: 1px solid var(--av-border); }
.side-menu { flex: 1; min-height: 0; overflow-y: auto; }
.side :deep(.p-menu) { width: 100%; border: 0; background: transparent; }
.side :deep(.cat-active .p-menu-item-content) { background: var(--av-border); color: var(--p-primary-color); }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.toolbar { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid var(--av-border); }
.lag { margin: 0.5rem 1rem 0; }
.collbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; padding: 0.75rem 1rem; border-bottom: 1px solid var(--av-border); background: var(--av-card); }
.collname { margin: 0; font-size: 1.2rem; line-height: 1; gap: 0.6rem; }
.collname .pi { color: var(--p-primary-color); font-size: 1.1rem; }
.collcount { opacity: 0.6; }
.collactions { margin-left: auto; display: flex; flex-wrap: wrap; gap: 0.6rem; }
.selcount { color: var(--p-primary-color); }
.ms { min-width: 12rem; max-width: 22rem; }
.count { margin-left: auto; opacity: 0.6; }
.zoom { display: flex; align-items: center; gap: 0.6rem; opacity: 0.85; }
.slider { width: 9rem; }
</style>
