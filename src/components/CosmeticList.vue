<script setup lang="ts">
import Checkbox from 'primevue/checkbox'
import { formatBytes } from '../format'
import type { CosmeticItem } from '../providers/types'

// Compact table alternative to the card grid: same selection and gray states, click a row to open it.
defineProps<{ items: CosmeticItem[]; selected: Set<string>; grayOf: (id: string) => boolean }>()
defineEmits<{ open: [item: CosmeticItem]; select: [id: string] }>()
const size = (it: CosmeticItem) => (typeof it.fields.size === 'number' && it.fields.size ? formatBytes(it.fields.size) : '')
</script>

<template>
  <div class="list">
    <div class="row head">
      <span />
      <span>Name</span>
      <span>Category</span>
      <span>Type</span>
      <span>File</span>
      <span class="num">Size</span>
    </div>
    <div v-for="it in items" :key="it.id" class="row" :class="{ selected: selected.has(it.id), gray: grayOf(it.id) }" @click="$emit('open', it)">
      <span @click.stop><Checkbox :model-value="selected.has(it.id)" binary @update:model-value="$emit('select', it.id)" /></span>
      <span class="name" :title="it.name">{{ it.name }}</span>
      <span>{{ it.fields.category }}</span>
      <span>{{ it.fields.type }}</span>
      <span>{{ it.fields.ext }}</span>
      <span class="num">{{ size(it) }}</span>
    </div>
  </div>
</template>

<style scoped>
.list { padding: 0.5rem 1rem 1rem; }
.row { display: grid; grid-template-columns: 2rem minmax(0, 3fr) minmax(0, 1.5fr) 5rem 5rem 7rem; gap: 0.75rem; align-items: center; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--av-border); cursor: pointer; font-size: 0.9rem; content-visibility: auto; contain-intrinsic-size: auto 38px; }
.row:not(.head):hover { background: var(--av-hover); }
.row.head { position: sticky; top: 0; z-index: 1; background: var(--av-bg); cursor: default; opacity: 0.7; font-size: 0.8rem; text-transform: uppercase; content-visibility: visible; }
.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.row.selected { background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); }
.row.gray { opacity: 0.45; }
</style>
