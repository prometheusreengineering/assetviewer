<script setup lang="ts">
import InputText from 'primevue/inputtext'
import Menu from 'primevue/menu'
import Message from 'primevue/message'
import MultiSelect from 'primevue/multiselect'
import ProgressSpinner from 'primevue/progressspinner'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, ref, watch, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import CosmeticGrid from '../components/CosmeticGrid.vue'
import { providers } from '../providers'
import type { CategoryDef, CosmeticItem, FilterDef } from '../providers/types'

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
    ready.value = true
    if (!props.category && categories.value[0]) {
      const first = categories.value.find((c) => c.id === 'hat') ?? categories.value[0]
      router.replace(`/${props.provider}/${first.id}`)
    }
  } catch (e) {
    error.value = String(e)
  }
})

const search = ref('')
const filterState = ref<Record<string, any>>({})
watch(
  () => props.category,
  () => {
    search.value = ''
    filterState.value = {}
  },
)

const filters = computed<FilterDef[]>(() => (ready.value && props.category ? provider.value.filters(props.category) : []))
const allItems = computed<CosmeticItem[]>(() => (ready.value && props.category ? provider.value.items(props.category) : []))

const items = computed(() => {
  const q = search.value.trim().toLowerCase()
  return allItems.value.filter((it) => {
    if (q && !it.name.toLowerCase().includes(q)) return false
    for (const f of filters.value) {
      const v = filterState.value[f.key]
      const field = it.fields[f.key]
      if (f.type === 'toggle' && v && field !== true) return false
      if (f.type === 'multi' && Array.isArray(v) && v.length && !(Array.isArray(field) && v.some((x) => field.includes(x)))) return false
    }
    return true
  })
})

const menuModel = computed(() =>
  categories.value.map((c) => ({
    label: `${c.label} (${c.count})`,
    icon: `pi ${c.icon}`,
    class: c.id === props.category ? 'cat-active' : '',
    command: () => router.push(`/${props.provider}/${c.id}`),
  })),
)
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
      <div class="toolbar">
        <InputText v-model="search" placeholder="Search…" />
        <template v-for="f in filters" :key="f.key">
          <MultiSelect
            v-if="f.type === 'multi'"
            v-model="filterState[f.key]"
            :options="f.options"
            :placeholder="f.label"
            display="chip"
            filter
            :max-selected-labels="2"
            class="ms"
          />
          <label v-else class="toggle"><ToggleSwitch v-model="filterState[f.key]" />{{ f.label }}</label>
        </template>
        <span class="count">{{ items.length }} items</span>
      </div>
      <CosmeticGrid :key="provider.id + category" :provider="provider" :items="items" />
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
.toggle { display: flex; align-items: center; gap: 0.5rem; }
.count { margin-left: auto; opacity: 0.6; }
</style>
