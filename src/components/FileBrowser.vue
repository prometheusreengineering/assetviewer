<script setup lang="ts">
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import InputText from 'primevue/inputtext'
import { computed, ref } from 'vue'
import { fileUrl } from '../cdn'
import { download } from '../download'
import type { CosmeticProvider } from '../providers/types'

const props = defineProps<{ provider: CosmeticProvider }>()

const query = ref('')
const all = computed(() => props.provider.indexedFiles?.() ?? [])
const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? all.value.filter((f) => f.path.toLowerCase().includes(q)) : all.value
})

const fmt = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)

async function save(f: { path: string; hash: string }) {
  const blob = await (await fetch(fileUrl(f.hash))).blob()
  download(f.path.split('/').pop()!, blob, blob.type || 'application/octet-stream')
}
</script>

<template>
  <div class="browser">
    <div class="bar">
      <InputText v-model="query" placeholder="Filter by path…" class="q" />
      <span class="count">{{ rows.length }} files</span>
    </div>
    <DataTable :value="rows" scrollable scroll-height="flex" size="small" :virtual-scroller-options="{ itemSize: 38 }" class="table">
      <Column field="path" header="Path" />
      <Column field="size" header="Size" style="width: 7rem">
        <template #body="{ data }">{{ fmt(data.size) }}</template>
      </Column>
      <Column header="" style="width: 9rem">
        <template #body="{ data }">
          <a :href="fileUrl(data.hash)" target="_blank" rel="noopener" class="open">Open</a>
          <Button icon="pi pi-download" size="small" text rounded aria-label="Download" @click="save(data)" />
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<style scoped>
.browser { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 1rem; gap: 0.75rem; }
.bar { display: flex; gap: 1rem; align-items: center; }
.q { width: min(32rem, 100%); }
.count { margin-left: auto; opacity: 0.6; }
.table { flex: 1; min-height: 0; }
.open { margin-right: 0.5rem; color: var(--p-primary-color); }
</style>
