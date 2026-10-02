<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { stats } from '../stats'
import type { CategoryDef } from '../providers/types'

const props = defineProps<{ provider: string; name: string; categories: CategoryDef[] }>()
const router = useRouter()

// Tools are listed apart; the rest keep the sidebar's grouping.
const groups = computed(() => {
  const m = new Map<string, CategoryDef[]>()
  for (const c of props.categories) {
    const g = c.group || 'Browse'
    if (!m.has(g)) m.set(g, [])
    m.get(g)!.push(c)
  }
  return [...m].sort((a, b) => Number(a[0] === 'Tools') - Number(b[0] === 'Tools'))
})
const go = (id: string) => router.push(`/${props.provider}/${id}`)
</script>

<template>
  <div class="home">
    <header class="hero">
      <h1>Asset Viewer</h1>
      <p class="sub">Browse, preview and download the cosmetics of {{ name }}: 3D models, emotes, wings, cloaks and more.</p>
    </header>

    <div v-if="stats" class="facts">
      <div class="fact"><strong>{{ stats.items.toLocaleString() }}</strong><span>items</span></div>
      <div class="fact"><strong>{{ stats.files.toLocaleString() }}</strong><span>files</span></div>
      <div class="fact"><strong>{{ categories.length }}</strong><span>categories</span></div>
    </div>

    <section v-for="[group, cats] in groups" :key="group">
      <h2>{{ group }}</h2>
      <div class="cats">
        <button v-for="c in cats" :key="c.id" class="cat" @click="go(c.id)">
          <i :class="['pi', c.icon]" />
          <span class="label">{{ c.label }}</span>
          <span v-if="group !== 'Tools'" class="n">{{ c.count.toLocaleString() }}</span>
        </button>
      </div>
    </section>

    <section class="about">
      <h2>Tips</h2>
      <ul>
        <li>Click a card to open it in 3D; drag to rotate, Shift+drag to pan, scroll to zoom.</li>
        <li>Use "Show on player" in the preview, or the Outfit builder, to see cosmetics on a player. Set a player name at the bottom of the sidebar to use that skin.</li>
        <li>Tick cards to select them, then compare up to four or export them as a ZIP.</li>
        <li>Search, filter and sort are kept in the URL, so you can share a view.</li>
      </ul>
    </section>

    <section class="about">
      <h2>Credits</h2>
      <ul>
        <li>All assets are served from textures.lunarclientcdn.com; this is an unofficial fan-made viewer, not affiliated with Lunar Client or Moonsworth.</li>
        <li>Emotes use the Blockbuster format by McHorse; player skins are loaded from mc-heads.net.</li>
        <li>Built with Vue, PrimeVue and three.js. <a href="https://github.com/prometheusreengineering/assetviewer" target="_blank" rel="noopener"><i class="pi pi-github" /> Source on GitHub</a></li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.home { padding: 2rem 2.5rem; overflow-y: auto; flex: 1; max-width: 70rem; }
.hero h1 { margin: 0; font-size: 2.2rem; }
.sub { margin: 0.5rem 0 0; opacity: 0.75; font-size: 1.05rem; }
.facts { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1.5rem 0; }
.fact { display: flex; flex-direction: column; padding: 0.8rem 1.4rem; background: var(--av-card); border: 1px solid var(--av-border); border-radius: 10px; }
.fact strong { font-size: 1.5rem; color: var(--p-primary-color); }
.fact span { opacity: 0.65; font-size: 0.85rem; }
h2 { font-size: 1.05rem; margin: 1.5rem 0 0.6rem; opacity: 0.85; }
.cats { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: 0.6rem; }
.cat { display: flex; align-items: center; gap: 0.6rem; padding: 0.7rem 0.9rem; background: var(--av-card); color: var(--av-text); border: 1px solid var(--av-border); border-radius: 8px; cursor: pointer; font: inherit; text-align: left; }
.cat:hover { background: var(--av-hover); border-color: var(--p-primary-color); }
.cat .pi { color: var(--p-primary-color); }
.cat .label { flex: 1; }
.cat .n { opacity: 0.55; font-size: 0.85rem; }
.about ul { margin: 0; padding-left: 1.2rem; line-height: 1.7; opacity: 0.85; }
.about a { color: var(--p-primary-color); }
</style>
