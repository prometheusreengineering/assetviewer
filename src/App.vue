<script setup lang="ts">
import InputText from 'primevue/inputtext'
import Menubar from 'primevue/menubar'
import Tag from 'primevue/tag'
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { skinName } from './skin'
import { stats } from './stats'

const route = useRoute()
const router = useRouter()

// Global player name: its skin is used by emotes and the "show on player" views.
const player = ref(skinName.value)
watch(skinName, (v) => (player.value = v))
const applyPlayer = () => (skinName.value = player.value.trim())

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
      <template #end>
        <span class="player" title="Minecraft username: its skin is used on emotes and in the player previews (loaded from mc-heads.net). Empty = placeholder skin.">
          <i class="pi pi-user" />
          <InputText v-model="player" size="small" placeholder="Player name" spellcheck="false" autocomplete="off" @keyup.enter="applyPlayer" @blur="applyPlayer" />
        </span>
      </template>
    </Menubar>
    <router-view :key="String(route.params.provider)" />
    <footer class="foot">
      <span>Unofficial fan-made viewer, not affiliated with Lunar Client or Moonsworth. Assets are served from textures.lunarclientcdn.com.</span>
      <span v-if="stats" class="stats">
        {{ stats.name }}: {{ stats.items.toLocaleString() }} items · {{ stats.files.toLocaleString() }} files · index
        <code v-for="h in stats.indexes" :key="h" :title="h">{{ h.slice(0, 7) }}</code>
      </span>
      <a href="https://github.com/prometheusreengineering/assetviewer" target="_blank" rel="noopener"><i class="pi pi-github" /> GitHub</a>
    </footer>
  </div>
</template>

<style scoped>
.shell { display: flex; flex-direction: column; height: 100%; }
.nav { border-radius: 0; }
.foot { display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; align-items: center; padding: 0.5rem 1rem; font-size: 0.8rem; border-top: 1px solid var(--p-surface-800); opacity: 0.75; }
.foot a { margin-left: auto; color: inherit; }
.stats code { margin-left: 0.4rem; }
.brand { margin-right: 1.5rem; }
.player { display: flex; align-items: center; gap: 0.5rem; }
.player .pi { opacity: 0.7; }
.player :deep(input) { width: 11rem; }
.nav-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.9rem; cursor: pointer; border-radius: 6px; }
.nav-item:hover, .nav-item.active { background: var(--p-surface-800); }
.nav-item.active { color: var(--p-primary-color); }
</style>
