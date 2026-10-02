<script setup lang="ts">
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import InputText from 'primevue/inputtext'
import { computed, ref } from 'vue'
import { getFileBuffer } from '../cdn'
import { download } from '../download'
import type { CosmeticItem, CosmeticProvider } from '../providers/types'
import CosmeticModal from './CosmeticModal.vue'
import { formatBytes } from '../format'

const props = defineProps<{ provider: CosmeticProvider }>()

const query = ref('')
const selected = ref<CosmeticItem | null>(null)
const all = computed(() => props.provider.indexedFiles?.() ?? [])
const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? all.value.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) : all.value
})

const fmt = formatBytes

async function save(f: { path: string; hash: string }) {
  download(f.path.split('/').pop()!, await getFileBuffer(f.hash))
}
</script>

<template>
  <div class="browser">
    <div class="bar">
      <InputText v-model="query" placeholder="Filter by name or path…" class="q" />
      <span class="count">{{ rows.length }} files</span>
    </div>
    <DataTable :value="rows" scrollable scroll-height="flex" size="small" :virtual-scroller-options="{ itemSize: 38 }" class="table" selection-mode="single" @row-click="selected = provider.fileItem!($event.data.path)">
      <Column field="name" header="Name" />
      <Column field="path" header="Path" />
      <Column field="size" header="Size" style="width: 7rem">
        <template #body="{ data }">{{ fmt(data.size) }}</template>
      </Column>
      <Column header="" style="width: 5rem">
        <template #body="{ data }">
          <Button icon="pi pi-download" size="small" text rounded aria-label="Download" @click.stop="save(data)" />
        </template>
      </Column>
    </DataTable>
    <CosmeticModal :provider="provider" :item="selected" @close="selected = null" />
  </div>
</template>

<style scoped>
.browser { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 1rem; gap: 0.75rem; }
.bar { display: flex; gap: 1rem; align-items: center; }
.q { width: min(32rem, 100%); }
.count { margin-left: auto; opacity: 0.6; }
.table { flex: 1; min-height: 0; }
.table :deep(tr) { cursor: pointer; }
</style>
