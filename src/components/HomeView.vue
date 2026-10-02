<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
  <div class="home">
    <article>
      <h1>Asset Viewer</h1>
      <p class="lead">
        An unofficial viewer for {{ name }} cosmetics. Browse every hat, cloak, wing, pet, emote and resource on the
        public asset CDN, preview them in 3D, try them on a player with your own skin, and download the source files.
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
        <li>Cosmetics, textures and models belong to their owners and are loaded from textures.lunarclientcdn.com. This project is not affiliated with Lunar Client or Moonsworth.</li>
        <li>Emotes are stored in McHorse's Blockbuster model format.</li>
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
</style>
