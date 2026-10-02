<script setup lang="ts">
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import { ref, watch } from 'vue'
import { dialog } from '../dialogs'

const text = ref('')
const dontAsk = ref(false)

watch(dialog, (d) => {
  if (!d) return
  text.value = d.input ?? ''
  dontAsk.value = false
})

function close(ok: boolean) {
  const d = dialog.value
  if (!d) return
  dialog.value = undefined
  if (ok && d.remember && dontAsk.value) {
    try {
      localStorage.setItem(d.remember, '1')
    } catch {}
  }
  if (!ok) return d.resolve(false)
  d.resolve(d.input !== undefined ? text.value : true)
}
</script>

<template>
  <Dialog
    :visible="!!dialog"
    modal
    :draggable="false"
    :style="{ width: 'min(440px, 92vw)' }"
    @update:visible="(v: boolean) => !v && close(false)"
  >
    <template #header>
      <span class="title icon-text"><i v-if="dialog?.icon" :class="[dialog.icon, { danger: dialog.danger, warn: dialog.warn }]" />{{ dialog?.title }}</span>
    </template>
    <form v-if="dialog" class="body" @submit.prevent="close(true)">
      <p v-if="dialog.message" class="msg">{{ dialog.message }}</p>
      <InputText v-if="dialog.input !== undefined" v-model="text" :placeholder="dialog.placeholder" fluid autofocus />
      <label v-if="dialog.remember" class="remember"><Checkbox v-model="dontAsk" binary /> Don't ask again</label>
    </form>
    <template #footer>
      <Button v-if="dialog?.cancelLabel !== false" :label="dialog?.cancelLabel || 'Cancel'" size="small" severity="secondary" @click="close(false)" />
      <Button
        :label="dialog?.confirmLabel || 'OK'"
        :icon="dialog?.confirmIcon"
        size="small"
        :severity="dialog?.danger ? 'danger' : undefined"
        :disabled="dialog?.input !== undefined && !text.trim()"
        @click="close(true)"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.title { font-weight: 600; font-size: 1.1rem; gap: 0.6rem; }
.title .pi { color: var(--p-primary-color); }
.title .pi.warn { color: var(--p-amber-400); }
.title .pi.danger { color: var(--p-red-400); }
.body { display: flex; flex-direction: column; gap: 0.9rem; }
.msg { margin: 0; line-height: 1.55; opacity: 0.85; white-space: pre-line; }
.remember { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; opacity: 0.85; cursor: pointer; }
</style>
