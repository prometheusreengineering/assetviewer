<script setup lang="ts">
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import ProgressBar from 'primevue/progressbar'
import { zip, type AsyncZippable } from 'fflate'
import { computed, ref } from 'vue'
import { download } from '../download'
import { formatBytes } from '../format'
import type { CosmeticItem, CosmeticProvider } from '../providers/types'

const props = defineProps<{ provider: CosmeticProvider; items: CosmeticItem[]; name: string }>()

const open = ref(false)
const phase = ref<'confirm' | 'fetching' | 'zipping' | 'done' | 'error'>('confirm')
const done = ref(0)
const failed = ref<string[]>([])
const message = ref('')
let cancelled = false

const estimate = computed(() => (open.value ? props.items.reduce((s, it) => s + (props.provider.estimateSize?.(it) ?? 0), 0) : 0))
const mb = formatBytes
// Big exports get a confirmation first; small ones start right away.
const big = computed(() => props.items.length > 300 || estimate.value > 100e6)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item'

function start() {
  open.value = true
  phase.value = 'confirm'
  done.value = 0
  failed.value = []
  if (!big.value) run()
}

async function run() {
  cancelled = false
  phase.value = 'fetching'
  const tree: AsyncZippable = {}
  const used = new Set<string>()
  const queue = [...props.items]
  // A few items at a time; the bytes come from the hash cache when already seen.
  const worker = async () => {
    for (let it = queue.shift(); it && !cancelled; it = queue.shift()) {
      try {
        const files = await props.provider.sourceFiles!(it)
        let dir = `${slug(it.category)}/${slug(it.name)}`
        if (used.has(dir)) dir += `_${slug(it.id)}`
        used.add(dir)
        for (const f of files) {
          // Images are already compressed; storing them is much faster.
          tree[`${dir}/${f.name}`] = [f.data, { level: /\.(webp|png|gif|jpe?g)$/i.test(f.name) ? 0 : 6 }]
        }
      } catch (e) {
        failed.value.push(`${it.name}: ${e}`)
      }
      done.value++
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  if (cancelled) return
  phase.value = 'zipping'
  zip(tree, (err, data) => {
    if (cancelled) return
    if (err) {
      phase.value = 'error'
      message.value = String(err)
      return
    }
    download(`${slug(props.name)}.zip`, data as Uint8Array<ArrayBuffer>, 'application/zip')
    phase.value = 'done'
    message.value = `${mb(data.length)} · ${props.items.length - failed.value.length} items`
  })
}

function cancel() {
  cancelled = true
  open.value = false
}
</script>

<template>
  <Button
    icon="pi pi-download"
    :label="`Export (${items.length})`"
    size="small"
    severity="secondary"
    :disabled="!items.length || !provider.sourceFiles"
    title="Download the source files of the items shown as one zip"
    @click="start"
  />
  <Dialog :visible="open" modal header="Export as ZIP" :style="{ width: 'min(460px, 92vw)' }" @update:visible="(v: boolean) => !v && cancel()">
    <div class="body">
      <template v-if="phase === 'confirm'">
        <p>{{ items.length.toLocaleString() }} items, about {{ mb(estimate) }} of source files.</p>
        <p class="dim">Files are grouped as category/item/…; this can take a while for large sets.</p>
      </template>
      <template v-else-if="phase === 'fetching' || phase === 'zipping'">
        <ProgressBar :value="Math.round((done / Math.max(items.length, 1)) * 100)" :mode="phase === 'zipping' ? 'indeterminate' : 'determinate'" />
        <p class="dim">{{ phase === 'zipping' ? 'Building the zip…' : `Collecting files ${done} / ${items.length}` }}</p>
      </template>
      <p v-else-if="phase === 'done'">Downloaded ({{ message }}).</p>
      <p v-else class="err">{{ message }}</p>
      <details v-if="failed.length" class="failed">
        <summary>{{ failed.length }} item(s) failed</summary>
        <div v-for="f in failed" :key="f">{{ f }}</div>
      </details>
    </div>
    <template #footer>
      <Button v-if="phase === 'confirm'" label="Cancel" text severity="secondary" @click="cancel" />
      <Button v-if="phase === 'confirm'" label="Export" icon="pi pi-download" @click="run" />
      <Button v-if="phase === 'fetching' || phase === 'zipping'" label="Cancel" text severity="secondary" @click="cancel" />
      <Button v-if="phase === 'done' || phase === 'error'" label="Close" @click="open = false" />
    </template>
  </Dialog>
</template>

<style scoped>
.body { display: flex; flex-direction: column; gap: 0.75rem; }
.dim { opacity: 0.65; font-size: 0.9rem; margin: 0; }
p { margin: 0; }
.err { color: var(--p-red-400); }
.failed { font-size: 0.8rem; opacity: 0.8; max-height: 10rem; overflow: auto; }
</style>
