// Pure rules from Essential's settings.json: one-sided parts and bones hidden when cosmetics are worn together.

export type Side = 'left' | 'right' | 'front' | 'back'
const SIDES: Side[] = ['left', 'right', 'front', 'back']

interface Setting {
  type?: string
  id?: string
  enabled?: boolean
  data?: Record<string, unknown>
}
const list = (settings: unknown): Setting[] => (Array.isArray(settings) ? (settings as Setting[]).filter((s) => s && typeof s === 'object' && s.enabled !== false) : [])

/** The side a bone belongs to (`side_left`, `arm_right_side_left_outer`, ...), if it is one-sided. */
export function boneSide(name: string): Side | undefined {
  return /(?:^|_)side_(left|right|front|back)(?:_|$)/.exec(name)?.[1] as Side | undefined
}

/** The sides a cosmetic can be worn on (from its bones and side skin masks), in a fixed order. */
export function sidesOf(boneNames: Iterable<string>, files: Iterable<string> = []): Side[] {
  const found = new Set<Side>()
  for (const n of boneNames) {
    const s = boneSide(n)
    if (s) found.add(s)
  }
  for (const f of files) {
    const m = /^skin_mask\.(?:steve|alex)\.(left|right|front|back)\.png$/.exec(f)
    if (m) found.add(m[1] as Side)
  }
  return SIDES.filter((s) => found.has(s))
}

/** DEFAULT_SIDE when set; otherwise right (or front) like the cosmetics that declare one. */
export function defaultSide(sides: Side[], settings: unknown): Side | undefined {
  if (!sides.length) return undefined
  const declared = list(settings).find((s) => s.type === 'DEFAULT_SIDE')?.data?.side
  if (typeof declared === 'string' && sides.includes(declared as Side)) return declared as Side
  return sides.includes('right') ? 'right' : sides.includes('front') ? 'front' : sides[0]
}

/** COSMETIC_BONE_HIDING groups -> the bones under `root` they cover. */
const GROUPS: Record<string, string[]> = {
  head: ['head'],
  body: ['body'],
  arms: ['arm_left', 'arm_right'],
  legs: ['leg_left', 'leg_right'],
}

export interface Worn {
  id: string
  settings: unknown
}

/**
 * Bones to hide when these cosmetics are worn together, per cosmetic id:
 * - EXTERNAL_HIDDEN_BONE on A with id B: B's bones named in `data` (e.g. bug wings hide a backpack's own wings);
 * - COSMETIC_BONE_HIDING on A with id B: A's head/body/arms/legs parts (a vest's body under a hood).
 */
export function hiddenBones(worn: Worn[]): Map<string, Set<string>> {
  const ids = new Set(worn.map((w) => w.id))
  const out = new Map<string, Set<string>>()
  const hide = (id: string, bone: string) => {
    if (!out.has(id)) out.set(id, new Set())
    out.get(id)!.add(bone)
  }
  for (const w of worn) {
    for (const s of list(w.settings)) {
      if (!s.id || s.id === w.id || !ids.has(s.id)) continue
      const on = Object.entries(s.data ?? {}).filter(([, v]) => v === true).map(([k]) => k)
      if (s.type === 'EXTERNAL_HIDDEN_BONE') for (const b of on) hide(s.id, b)
      else if (s.type === 'COSMETIC_BONE_HIDING') for (const g of on) for (const b of GROUPS[g] ?? []) hide(w.id, b)
    }
  }
  return out
}
