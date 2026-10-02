<script setup lang="ts">
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { ref, watch } from 'vue'
import { skinName } from '../skin'
import { dark } from '../theme'

// Global player name: its skin is used by emotes and the "show on player" views.
const player = ref(skinName.value)
watch(skinName, (v) => (player.value = v))
const applyPlayer = () => (skinName.value = player.value.trim())
</script>

<template>
  <div class="controls">
    <span class="player" title="Minecraft username: its skin is used on emotes and in the player previews (loaded from mc-heads.net). Empty = placeholder skin.">
      <i class="pi pi-user" />
      <InputText v-model="player" size="small" placeholder="Player name" spellcheck="false" autocomplete="off" fluid @keyup.enter="applyPlayer" @blur="applyPlayer" />
    </span>
    <Button :icon="dark ? 'pi pi-sun' : 'pi pi-moon'" :title="dark ? 'Switch to light mode' : 'Switch to dark mode'" :aria-label="dark ? 'Light mode' : 'Dark mode'" severity="secondary" text rounded size="small" @click="dark = !dark" />
  </div>
</template>

<style scoped>
.controls { display: flex; align-items: center; gap: 0.5rem; }
.player { display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0; }
.player .pi { opacity: 0.7; }
</style>
