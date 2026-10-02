<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppDialog from './components/AppDialog.vue'
import { stats } from './stats'

const route = useRoute()
</script>

<template>
  <div class="shell">
    <router-view :key="String(route.params.provider)" />
    <footer class="foot">
      <div class="sec text">Not affiliated with Lunar Client or Moonsworth. Assets are served from textures.lunarclientcdn.com.</div>
      <div class="sec stats">
        <template v-if="stats">
          {{ stats.name }}: {{ stats.items.toLocaleString() }} items · {{ stats.files.toLocaleString() }} files · index
          <code v-for="h in stats.indexes" :key="h" :title="h">{{ h.slice(0, 7) }}</code>
        </template>
      </div>
      <div class="sec link"><a class="icon-text" href="https://github.com/prometheusreengineering/assetviewer" target="_blank" rel="noopener"><i class="pi pi-github" />GitHub</a></div>
    </footer>
    <AppDialog />
  </div>
</template>

<style scoped>
.shell { display: flex; flex-direction: column; height: 100%; }
.foot { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); font-size: 0.8rem; border-top: 1px solid var(--av-border); }
.foot .sec { padding: 0.5rem 1rem; opacity: 0.75; display: flex; align-items: center; justify-content: center; text-align: center; flex-wrap: wrap; gap: 0 0.3rem; }
.foot .sec + .sec { border-left: 1px solid var(--av-border); }
.foot a { color: inherit; }
.stats code { margin-left: 0.4rem; }
</style>
