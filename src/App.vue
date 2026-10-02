<script setup lang="ts">
import { useRoute } from 'vue-router'
import { stats } from './stats'

const route = useRoute()
</script>

<template>
  <div class="shell">
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
.foot { display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; align-items: center; padding: 0.5rem 1rem; font-size: 0.8rem; border-top: 1px solid var(--av-border); opacity: 0.75; }
.foot a { margin-left: auto; color: inherit; }
.stats code { margin-left: 0.4rem; }
</style>
