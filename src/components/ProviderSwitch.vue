<script setup lang="ts">
import Popover from 'primevue/popover'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps<{ provider: string }>()
const router = useRouter()
const pop = ref<InstanceType<typeof Popover>>()

const options = [
  { id: 'lunar', label: 'Lunar Client', desc: 'Cosmetics, emotes and resources from the Lunar CDN', icon: 'pi pi-moon' },
  { id: 'essential', label: 'Essential', desc: 'Essential Mod cosmetics (coming soon)', icon: 'pi pi-box' },
]
const current = computed(() => options.find((o) => o.id === props.provider) ?? options[0]!)
function pick(id: string) {
  pop.value?.hide()
  if (id !== props.provider) router.push('/' + id)
}
</script>

<template>
  <div>
    <button class="switch" aria-haspopup="true" @click="(e) => pop?.toggle(e)">
      <i :class="current.icon" class="lead" />
      <span class="txt"><strong>{{ current.label }}</strong></span>
      <i class="pi pi-chevron-down" />
    </button>
    <Popover ref="pop">
      <div class="opts">
        <button v-for="o in options" :key="o.id" class="opt" :class="{ on: o.id === provider }" @click="pick(o.id)">
          <i :class="o.icon" class="lead" />
          <span class="txt"><strong>{{ o.label }}</strong><small>{{ o.desc }}</small></span>
          <i v-if="o.id === provider" class="pi pi-check" />
        </button>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.switch, .opt { display: flex; align-items: center; gap: 0.75rem; width: 100%; padding: 0.7rem 0.8rem; background: var(--av-card); color: var(--av-text); border: 1px solid var(--av-border); border-radius: 8px; cursor: pointer; font: inherit; text-align: left; }
.switch:hover, .opt:hover { background: var(--av-hover); }
.lead { font-size: 1.3rem; color: var(--p-primary-color); }
.txt { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.txt small { opacity: 0.65; }
.opts { display: flex; flex-direction: column; gap: 0.4rem; width: 17rem; }
.opt { border-color: transparent; }
.opt.on { background: var(--av-hover); }
</style>
