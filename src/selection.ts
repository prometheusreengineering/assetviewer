import { ref } from 'vue'

/** Cards ticked in the grid (ids, in pick order). Cleared when the category changes. */
export const MAX_COMPARE = 4
export const selection = ref<string[]>([])

export function toggleSelected(id: string) {
  const l = selection.value
  selection.value = l.includes(id) ? l.filter((x) => x !== id) : [...l, id]
}
export const setSelection = (ids: string[]) => (selection.value = [...ids])
export const clearSelection = () => (selection.value = [])
