import { ref } from 'vue'

/** Items picked for side-by-side comparison (ids, in pick order). */
export const MAX_COMPARE = 4
export const comparing = ref<string[]>([])

export function toggleCompare(id: string) {
  const l = comparing.value
  if (l.includes(id)) comparing.value = l.filter((x) => x !== id)
  else if (l.length < MAX_COMPARE) comparing.value = [...l, id]
}
