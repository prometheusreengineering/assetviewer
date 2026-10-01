<script setup lang="ts">
import Menubar from 'primevue/menubar'
import Tag from 'primevue/tag'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const items = [
  { id: 'lunar', label: 'Lunar Client', icon: 'pi pi-moon' },
  { id: 'essential', label: 'Essential', icon: 'pi pi-box', soon: true },
]
</script>

<template>
  <div class="shell">
    <Menubar :model="items" class="nav">
      <template #start><strong class="brand">Asset Viewer</strong></template>
      <template #item="{ item }">
        <a
          class="nav-item"
          :class="{ active: route.params.provider === (item as any).id }"
          @click="router.push('/' + (item as any).id)"
        >
          <span :class="item.icon" />
          <span>{{ item.label }}</span>
          <Tag v-if="(item as any).soon" value="soon" severity="secondary" />
        </a>
      </template>
    </Menubar>
    <router-view :key="String(route.params.provider)" />
  </div>
</template>

<style scoped>
.shell { display: flex; flex-direction: column; height: 100%; }
.nav { border-radius: 0; }
.brand { margin-right: 1.5rem; }
.nav-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.9rem; cursor: pointer; border-radius: 6px; }
.nav-item:hover, .nav-item.active { background: var(--p-surface-800); }
.nav-item.active { color: var(--p-primary-color); }
</style>
