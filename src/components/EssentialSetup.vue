<script setup lang="ts">
import Button from 'primevue/button'
import Message from 'primevue/message'
import { ref, watch } from 'vue'
import { connectFiles, essentialState, pickFolder, reconnect } from '../providers/essential'

// Essential has no public index and nothing of it is hosted here: the viewer points us at their own files.
const emit = defineEmits<{ connected: [] }>()
const busy = ref(false)
const error = ref('')
const canPick = typeof window !== 'undefined' && 'showDirectoryPicker' in window
// However it got connected (picker, reconnect, or the dev hook), the page reloads its catalog.
watch(
  () => essentialState.value.connected,
  (c) => c && emit('connected'),
)
const dumpsFiles = ref<File[]>([])
const cacheFiles = ref<File[]>([])

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    // Closing the picker is not an error.
    if ((e as Error)?.name !== 'AbortError') error.value = (e as Error)?.message ?? String(e)
  } finally {
    busy.value = false
  }
}
const pick = () => run(pickFolder)
const again = () => run(async () => (await reconnect(true)) || Promise.reject(new Error('Permission to read the folder was not given.')))
const useFiles = () => run(() => connectFiles(dumpsFiles.value, cacheFiles.value.length ? cacheFiles.value : undefined))
const files = (e: Event) => [...((e.target as HTMLInputElement).files ?? [])]
</script>

<template>
  <div class="setup">
    <article>
      <h1>Essential cosmetics from your own files</h1>
      <p class="lead">
        Essential has no public cosmetics index, and this site hosts none of its files. Point it at your Minecraft folder
        instead: the cosmetic dumps written by the Prometheus patch and Essential's own cosmetic cache are read right here
        in your browser. Nothing is uploaded.
      </p>

      <Message v-if="error" severity="error" class="msg">{{ error }}</Message>
      <Message v-else-if="essentialState.error" severity="warn" class="msg">{{ essentialState.error }}</Message>

      <div v-if="canPick" class="row">
        <Button v-if="essentialState.storedHandle" label="Reconnect folder" icon="pi pi-refresh" :loading="busy" @click="again" />
        <Button label="Choose .minecraft folder" icon="pi pi-folder-open" :severity="essentialState.storedHandle ? 'secondary' : undefined" :loading="busy" @click="pick" />
      </div>
      <p class="hint">
        Expected inside it: <code>prometheus/essential/dumps</code> and <code>essential/cosmetic-cache</code>. Files missing
        from the cache are downloaded from the address in your own dump.
      </p>

      <details :open="!canPick" class="fallback">
        <summary>{{ canPick ? 'Or choose the two folders separately' : 'Choose the two folders' }}</summary>
        <label class="pickrow">
          <span>Dumps folder</span>
          <input type="file" webkitdirectory multiple @change="(e) => (dumpsFiles = files(e))" />
        </label>
        <label class="pickrow">
          <span>Cosmetic cache (optional)</span>
          <input type="file" webkitdirectory multiple @change="(e) => (cacheFiles = files(e))" />
        </label>
        <Button label="Use these folders" icon="pi pi-check" size="small" :disabled="!dumpsFiles.length" :loading="busy" @click="useFiles" />
      </details>
    </article>
  </div>
</template>

<style scoped>
.setup { flex: 1; overflow-y: auto; padding: 3rem 1.5rem; }
article { max-width: 42rem; margin: 0 auto; line-height: 1.6; }
h1 { margin: 0 0 0.75rem; font-size: 1.8rem; }
.lead { opacity: 0.85; }
.row { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1.25rem 0 0.5rem; }
.hint { font-size: 0.9rem; opacity: 0.7; }
.msg { margin: 1rem 0; }
.fallback { margin-top: 1.5rem; border: 1px solid var(--av-border); border-radius: 8px; padding: 0.75rem 1rem; }
.fallback summary { cursor: pointer; }
.pickrow { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin: 0.75rem 0; }
.pickrow span { min-width: 12rem; }
</style>
