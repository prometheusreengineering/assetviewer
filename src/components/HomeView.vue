<script setup lang="ts">
import Button from 'primevue/button'
import type { CosmeticProvider } from '../providers/types'

const props = defineProps<{ provider: CosmeticProvider }>()
const emit = defineEmits<{ disconnected: [] }>()
// Providers fed by the viewer's own files (Essential) can be disconnected here.
async function disconnect() {
  await props.provider.setup?.disconnect?.()
  emit('disconnected')
}
</script>

<template>
  <div class="home">
    <article>
      <h1>Asset Viewer</h1>
      <p class="lead">
        An unofficial viewer for {{ provider.name }} cosmetics. Browse every hat, cloak, wing, pet and resource on the
        public asset CDN, preview them in 3D, try them on a player with your own skin, and download the source files.
      </p>

      <p v-if="provider.setup?.disconnect" class="connected">
        Showing {{ provider.name }} cosmetics from your own files.
        <Button label="Disconnect" icon="pi pi-sign-out" size="small" severity="secondary" title="Forget the folders (and any copy kept in this browser)" @click="disconnect" />
      </p>

      <h2>About</h2>
      <p>
        Asset Viewer is made by
        <a href="https://github.com/prometheusreengineering" target="_blank" rel="noopener">Prometheus Reengineering</a>,
        a small group building open tools around game assets. The project is open source on
        <a href="https://github.com/prometheusreengineering/assetviewer" target="_blank" rel="noopener">GitHub</a>.
      </p>

      <h2>Credits</h2>
      <ul>
        <li v-if="provider.about">
          Cosmetics, textures and models belong to their owners and are loaded from {{ provider.about.host }}. This project is not affiliated with
          {{ provider.about.owner }}.
        </li>
        <li v-for="c in provider.about?.credits ?? []" :key="c">{{ c }}</li>
        <li>Player skins are loaded from mc-heads.net.</li>
        <li>Built with Vue, PrimeVue and three.js.</li>
      </ul>
    </article>
  </div>
</template>

<style scoped>
.home { flex: 1; overflow-y: auto; padding: 3rem 1.5rem; }
article { max-width: 42rem; margin: 0 auto; line-height: 1.65; }
h1 { margin: 0 0 0.75rem; font-size: 2.2rem; }
.lead { font-size: 1.1rem; opacity: 0.85; }
h2 { font-size: 1.05rem; margin: 2rem 0 0.4rem; }
p, ul { margin: 0; opacity: 0.85; }
ul { padding-left: 1.2rem; }
a { color: var(--p-primary-color); }
.connected { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-top: 1rem; }
</style>
