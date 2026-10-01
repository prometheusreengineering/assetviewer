import type { CosmeticItem, FieldDef, FieldType } from './providers/types'

export type Op = 'contains' | 'notcontains' | 'equals' | 'starts' | 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'between' | 'any' | 'all' | 'none' | 'is'

export interface Rule {
  id: number
  field: string
  op: Op
  /** string | number (numbers and epoch-ms dates) | string[] | boolean */
  value: any
  /** Upper bound for `between`. */
  value2?: any
}

export interface SortKey {
  field: string
  dir: 'asc' | 'desc'
}

export const OPS: Record<FieldType, { op: Op; label: string }[]> = {
  text: [
    { op: 'contains', label: 'contains' },
    { op: 'notcontains', label: "doesn't contain" },
    { op: 'equals', label: 'is' },
    { op: 'starts', label: 'starts with' },
  ],
  number: [
    { op: 'eq', label: '=' },
    { op: 'ne', label: '≠' },
    { op: 'gt', label: '>' },
    { op: 'ge', label: '≥' },
    { op: 'lt', label: '<' },
    { op: 'le', label: '≤' },
    { op: 'between', label: 'between' },
  ],
  date: [
    { op: 'gt', label: 'after' },
    { op: 'lt', label: 'before' },
    { op: 'eq', label: 'on' },
    { op: 'between', label: 'between' },
  ],
  multi: [
    { op: 'any', label: 'any of' },
    { op: 'all', label: 'all of' },
    { op: 'none', label: 'none of' },
  ],
  bool: [{ op: 'is', label: 'is' }],
}

export const valueOf = (item: CosmeticItem, key: string) => (key === 'name' ? item.name : item.fields[key])
const toArray = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === '' ? [] : [String(v)])
const DAY = 86_400_000

export function matches(item: CosmeticItem, rule: Rule, type: FieldType): boolean {
  const v = valueOf(item, rule.field)
  switch (type) {
    case 'bool':
      return (v === true) === !!rule.value
    case 'multi': {
      const have = toArray(v)
      const want: string[] = rule.value ?? []
      if (!want.length) return true
      if (rule.op === 'all') return want.every((x) => have.includes(x))
      if (rule.op === 'none') return !want.some((x) => have.includes(x))
      return want.some((x) => have.includes(x))
    }
    case 'text': {
      const q = String(rule.value ?? '').toLowerCase()
      if (!q) return true
      const s = String(v ?? '').toLowerCase()
      if (rule.op === 'equals') return s === q
      if (rule.op === 'starts') return s.startsWith(q)
      return rule.op === 'notcontains' ? !s.includes(q) : s.includes(q)
    }
    default: {
      if (typeof v !== 'number') return false // unknown (e.g. not measured yet) never matches
      const a = rule.value as number | null | undefined
      if (a === null || a === undefined) return true
      const b = (rule.value2 ?? a) as number
      // dates compare by whole day
      if (type === 'date') {
        if (rule.op === 'eq') return v >= a && v < a + DAY
        if (rule.op === 'between') return v >= a && v < b + DAY
        if (rule.op === 'gt') return v >= a + DAY
        return v < a
      }
      switch (rule.op) {
        case 'eq': return v === a
        case 'ne': return v !== a
        case 'gt': return v > a
        case 'ge': return v >= a
        case 'lt': return v < a
        case 'le': return v <= a
        default: return v >= Math.min(a, b) && v <= Math.max(a, b)
      }
    }
  }
}

function sortValue(item: CosmeticItem, f: FieldDef): number | string | undefined {
  const v = valueOf(item, f.key)
  if (v === undefined || v === '') return undefined
  if (f.type === 'bool') return v === true ? 1 : 0
  if (Array.isArray(v)) return v.length ? v.join(', ') : undefined
  return typeof v === 'boolean' ? (v ? 1 : 0) : v
}

/** Search + AND of all rules, then a stable multi-key sort (missing values always last). */
export function applyView(items: CosmeticItem[], search: string, rules: Rule[], sorts: SortKey[], defs: FieldDef[]): CosmeticItem[] {
  const by = new Map(defs.map((d) => [d.key, d]))
  const q = search.trim().toLowerCase()
  const active = rules.filter((r) => by.has(r.field))
  let out = items.filter((it) => (!q || it.name.toLowerCase().includes(q)) && active.every((r) => matches(it, r, by.get(r.field)!.type)))
  const keys = sorts.filter((s) => by.has(s.field))
  if (keys.length) {
    const idx = new Map(out.map((it, i) => [it, i]))
    out = out
      .map((it) => ({ it, v: keys.map((k) => sortValue(it, by.get(k.field)!)) }))
      .sort((x, y) => {
        for (let i = 0; i < keys.length; i++) {
          const a = x.v[i]
          const b = y.v[i]
          if (a === b) continue
          if (a === undefined) return 1
          if (b === undefined) return -1
          const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
          if (c) return keys[i]!.dir === 'asc' ? c : -c
        }
        return idx.get(x.it)! - idx.get(y.it)!
      })
      .map((x) => x.it)
  }
  return out
}

// ---- URL state (shareable links) -------------------------------------------

/** Rules as base64url JSON of [field, op, value, value2?] tuples. */
export function encodeRules(rules: Rule[]): string {
  if (!rules.length) return ''
  const json = JSON.stringify(rules.map((r) => (r.value2 === undefined ? [r.field, r.op, r.value] : [r.field, r.op, r.value, r.value2])))
  return btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeRules(s: string): Rule[] {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const tuples = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
    if (!Array.isArray(tuples)) return []
    return tuples
      .filter((t) => Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string')
      .map((t, i) => ({ id: i + 1, field: t[0], op: t[1], value: t[2], ...(t.length > 3 ? { value2: t[3] } : {}) }))
  } catch {
    return []
  }
}

/** Sorts as `field:asc,field:desc`. */
export const encodeSorts = (sorts: SortKey[]) => sorts.map((s) => `${s.field}:${s.dir}`).join(',')
export const decodeSorts = (s: string): SortKey[] =>
  s
    .split(',')
    .map((p) => p.split(':'))
    .filter(([f, d]) => f && (d === 'asc' || d === 'desc'))
    .map(([field, dir]) => ({ field: field!, dir: dir as SortKey['dir'] }))
