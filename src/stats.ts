import { ref } from 'vue'

/** Catalog numbers for the footer, set by the provider view once a catalog has loaded. */
export const stats = ref<{ name: string; items: number; files: number; indexes: string[] }>()
