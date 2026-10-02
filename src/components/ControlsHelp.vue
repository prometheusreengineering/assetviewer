<script setup lang="ts">
import vTooltip from 'primevue/tooltip'

// Its own component with no props, so the parent's frequent re-renders (emote scrubber) never touch the
// tooltip directive, which re-binds its listeners on every update.
const HELP = ['Rotate: drag', 'Move: Shift + drag (or right-drag)', 'Zoom: mouse wheel'].join(String.fromCharCode(10))
const TIP = { value: HELP, class: 'help-tip' }
</script>

<template>
  <i v-tooltip.left="TIP" class="pi pi-question-circle help" />
</template>

<style scoped>
.help { position: absolute; right: 0.75rem; bottom: 0.75rem; z-index: 2; cursor: help; opacity: 0.6; font-size: 1.2rem; }
.help:hover { opacity: 1; }
</style>
<style>
.help-tip { white-space: pre-line; }
</style>
