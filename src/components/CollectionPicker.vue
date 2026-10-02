<script setup lang="ts">
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import InputText from 'primevue/inputtext'
import Popover from 'primevue/popover'
import { computed, ref } from 'vue'
import { useCollections } from '../collections'

// Bookmark button + popover listing the collections: searchable, with the item's saved ones first (checked).
const props = defineProps<{ provider: string; itemId: string }>()
const emit = defineEmits<{ open: [boolean] }>()

const collections = useCollections(props.provider)
const selected = computed(() => collections.of(props.itemId))
const pop = ref<InstanceType<typeof Popover>>()
const query = ref('')

// The order is decided before the panel opens and stays fixed while it is open, so rows never jump.
const order = ref<string[]>([])
const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  const rank = (id: string) => (order.value.includes(id) ? 0 : 1)
  return collections
    .all()
    .filter((c) => c.name.toLowerCase().includes(q))
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => rank(a.id) - rank(b.id))
})

function toggle(e: Event) {
  if (!pop.value) return
  // Compute the order first; the popover renders its content only once shown.
  order.value = [...selected.value]
  query.value = ''
  pop.value.toggle(e)
}
const set = (id: string, on: boolean) => collections.set(id, props.itemId, on)
function create() {
  const name = prompt('Name of the new collection')
  if (name) {
    const c = collections.create(name)
    order.value = [...order.value, c.id]
    collections.set(c.id, props.itemId, true)
  }
}
</script>

<template>
  <span class="wrap" @click.stop>
    <Button
      class="btn"
      :class="{ has: selected.length }"
      size="small"
      severity="secondary"
      :title="selected.length ? `In ${selected.length} collection(s)` : 'Add to a collection'"
      @click="toggle"
    >
      <i class="pi pi-bookmark" />
      <span class="n">{{ selected.length }}</span>
    </Button>
    <Popover ref="pop" @show="emit('open', true)" @hide="emit('open', false)">
      <div class="panel">
        <InputText v-model="query" size="small" placeholder="Search collections" autofocus />
        <div class="list">
          <label v-for="r in rows" :key="r.id" class="row">
            <Checkbox :model-value="selected.includes(r.id)" binary @update:model-value="(v: boolean) => set(r.id, v)" />
            <span>{{ r.name }}</span>
          </label>
          <p v-if="!rows.length" class="none">No collections match.</p>
        </div>
        <Button label="New collection…" icon="pi pi-plus" size="small" text @click="create" />
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.wrap { display: inline-flex; }
.btn { gap: 0.35rem; padding: 0.3rem 0.55rem; }
.btn.has { color: var(--p-primary-color); }
.n { font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.panel { display: flex; flex-direction: column; gap: 0.5rem; min-width: 15rem; }
.list { display: flex; flex-direction: column; max-height: 14rem; overflow-y: auto; }
.row { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0.25rem; cursor: pointer; border-radius: 6px; }
.row:hover { background: var(--av-border); }
.none { opacity: 0.6; margin: 0.4rem 0.25rem; font-size: 0.85rem; }
</style>
