import type { CosmeticItem, FieldDef, FieldValue } from '../../src/providers/types'

let n = 0
/** A minimal cosmetic item for filter/sort/component tests. */
export function item(name: string, fields: Record<string, FieldValue> = {}, extra: Partial<CosmeticItem> = {}): CosmeticItem {
  return { id: extra.id ?? `i${++n}`, name, category: 'hat', render: '3d', fields, ...extra }
}

export const DEFS: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'path', label: 'Path', type: 'text' },
  { key: 'size', label: 'Size', type: 'number' },
  { key: 'released', label: 'Released', type: 'date' },
  { key: 'themes', label: 'Theme', type: 'multi', options: ['A', 'B', 'C'] },
  { key: 'animated', label: 'Animated', type: 'bool' },
]
