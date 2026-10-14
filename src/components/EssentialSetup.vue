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
const dumpsInput = ref<HTMLInputElement>()
const cacheInput = ref<HTMLInputElement>()
// Default Windows locations; pasted into the folder dialog's address bar they jump straight there.
const DUMPS_PATH = '%APPDATA%\\.minecraft\\prometheus\\essential\\dumps'
const CACHE_PATH = '%APPDATA%\\.minecraft\\essential\\cosmetic-cache'
const copied = ref('')
async function copy(path: string) {
  try {
    await navigator.clipboard.writeText(path)
    copied.value = path
    setTimeout(() => copied.value === path && (copied.value = ''), 1500)
  } catch {}
}
</script>

<template>
  <div class="setup">
    <article>
      <h1>Essential cosmetics from your own files</h1>
      <p class="lead">
        Essential has no public cosmetics index, and this site hosts none of its files. Choose two folders from your
        Minecraft install instead: the cosmetic dumps written by the Prometheus patch and Essential's own cosmetic cache.
        They are read right here in your browser; nothing is uploaded.
      </p>

      <Message v-if="error" severity="error" class="msg">{{ error }}</Message>
      <Message v-else-if="essentialState.error" severity="warn" class="msg">{{ essentialState.error }}</Message>

      <div v-if="essentialState.storedHandle && canPick" class="row">
        <Button label="Reconnect remembered folder" icon="pi pi-refresh" :loading="busy" @click="again" />
      </div>

      <ol class="steps">
        <li>
          <div class="step-head">
            <strong>Dumps folder</strong>
            <Button label="Choose" icon="pi pi-folder-open" size="small" severity="secondary" @click="dumpsInput?.click()" />
            <span v-if="dumpsFiles.length" class="picked icon-text"><i class="pi pi-check" />{{ dumpsFiles.length.toLocaleString() }} files</span>
          </div>
          <code class="path">{{ DUMPS_PATH }}</code>
          <Button :icon="copied === DUMPS_PATH ? 'pi pi-check' : 'pi pi-copy'" size="small" text rounded title="Copy the path" @click="copy(DUMPS_PATH)" />
          <input ref="dumpsInput" type="file" webkitdirectory multiple hidden @change="(e) => (dumpsFiles = files(e))" />
        </li>
        <li>
          <div class="step-head">
            <strong>Cosmetic cache</strong> <span class="opt">(optional: without it every file is downloaded)</span>
            <Button label="Choose" icon="pi pi-folder-open" size="small" severity="secondary" @click="cacheInput?.click()" />
            <span v-if="cacheFiles.length" class="picked icon-text"><i class="pi pi-check" />{{ cacheFiles.length.toLocaleString() }} files</span>
          </div>
          <code class="path">{{ CACHE_PATH }}</code>
          <Button :icon="copied === CACHE_PATH ? 'pi pi-check' : 'pi pi-copy'" size="small" text rounded title="Copy the path" @click="copy(CACHE_PATH)" />
          <input ref="cacheInput" type="file" webkitdirectory multiple hidden @change="(e) => (cacheFiles = files(e))" />
        </li>
      </ol>
      <Button label="Show my cosmetics" icon="pi pi-check" :disabled="!dumpsFiles.length" :loading="busy" @click="useFiles" />
      <p class="hint">
        Tip: paste the path into the folder dialog's address bar. Your browser may ask whether to "upload" the files: that
        only lets this page read them, nothing leaves your computer. Files missing from the cache are downloaded from the
        address in your own dump.
      </p>

      <details v-if="canPick" class="fallback">
        <summary>Minecraft installed outside AppData? Choose its folder once and it is remembered</summary>
        <p class="hint">Chrome and Edge refuse folders inside AppData ("contains system files"), so this only works for other locations.</p>
        <Button label="Choose .minecraft folder" icon="pi pi-folder-open" size="small" severity="secondary" :loading="busy" @click="pick" />
      </details>
    </article>
  </div>
</template>

<style scoped>
.setup { flex: 1; overflow-y: auto; padding: 3rem 1.5rem; }
article { max-width: 44rem; margin: 0 auto; line-height: 1.6; }
h1 { margin: 0 0 0.75rem; font-size: 1.8rem; }
.lead { opacity: 0.85; }
.row { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1rem 0; }
.steps { padding-left: 1.2rem; margin: 1.25rem 0; display: flex; flex-direction: column; gap: 1rem; }
.step-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
.opt { opacity: 0.6; font-size: 0.9rem; }
.picked { color: var(--p-primary-color); gap: 0.35rem; }
.path { font-size: 0.85rem; opacity: 0.8; user-select: all; }
.hint { font-size: 0.9rem; opacity: 0.7; margin-top: 1rem; }
.msg { margin: 1rem 0; }
.fallback { margin-top: 1.5rem; border: 1px solid var(--av-border); border-radius: 8px; padding: 0.75rem 1rem; }
.fallback summary { cursor: pointer; }
</style>
