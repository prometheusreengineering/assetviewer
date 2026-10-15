// Pure rules from Essential's settings.json: one-sided parts and bones hidden when cosmetics are worn together.
import type { ArmorPiece } from '../../three/armor'

export type { ArmorPiece }

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

/** MUTUALLY_EXCLUSIVE: the outfit categories a cosmetic can't be worn together with (data.slots). */
export function exclusiveCategories(settings: unknown): string[] {
  const out = new Set<string>()
  for (const s of list(settings)) {
    if (s.type !== 'MUTUALLY_EXCLUSIVE') continue
    const slots = s.data?.slots
    // One cosmetic writes PETS for the PET slot.
    for (const slot of Array.isArray(slots) ? slots : []) if (typeof slot === 'string') out.add(slot === 'PETS' ? 'pet' : slot.toLowerCase())
  }
  return [...out]
}

export const ARMOR_PIECES: ArmorPiece[] = ['helmet', 'chestplate', 'leggings', 'boots']
/** Essential's armor slot ids (Minecraft's armor inventory order; 4 is a modded glove slot). */
const PIECE_SLOT: Record<ArmorPiece, number> = { boots: 0, leggings: 1, chestplate: 2, helmet: 3 }
const SLOT_PIECE = Object.fromEntries(Object.entries(PIECE_SLOT).map(([p, i]) => [i, p])) as Record<number, ArmorPiece>
/** EnumPart armor slots for COSMETIC part groups (arms count the chestplate and gloves). */
const PART_SLOTS: Record<string, number[]> = { head: [3], body: [2], arms: [2, 4], legs: [0, 1] }

export interface WornModel extends Worn {
  /** Bones of the cosmetic that have visible cubes. */
  visible: string[]
}

const v2 = (settings: unknown) => list(settings).find((s) => s.type === 'ARMOR_HANDLING_V2')?.data?.conflicts as Record<string, unknown> | undefined
const slotsOf = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [])

/**
 * Essential's "only armor" mode: bones of each worn cosmetic hidden by the armor pieces worn.
 * ARMOR_HANDLING_V2 names bones per armor slot; otherwise ARMOR_HANDLING hides head/body/arms/legs parts
 * whose armor slots are taken.
 */
export function armorHiddenBones(worn: Worn[], armor: ArmorPiece[]): Map<string, Set<string>> {
  const taken = new Set(armor.map((p) => PIECE_SLOT[p]))
  const out = new Map<string, Set<string>>()
  const hide = (id: string, bone: string) => {
    if (!out.has(id)) out.set(id, new Set())
    out.get(id)!.add(bone)
  }
  for (const w of worn) {
    const conflicts = v2(w.settings)
    if (conflicts) {
      for (const [bone, slots] of Object.entries(conflicts)) if (slotsOf(slots).some((s) => taken.has(s))) hide(w.id, bone)
      continue
    }
    for (const s of list(w.settings)) {
      if (s.type !== 'ARMOR_HANDLING') continue
      for (const [group, on] of Object.entries(s.data ?? {})) {
        if (on === true && (PART_SLOTS[group] ?? []).some((slot) => taken.has(slot))) for (const b of GROUPS[group] ?? []) hide(w.id, b)
      }
    }
  }
  return out
}

/**
 * Essential's "only cosmetics" mode: the armor pieces a worn cosmetic covers are not drawn. Its covered slots
 * come from the ARMOR_HANDLING_V2 bones it shows, else from its visible head/body/arm/leg parts.
 */
export function blockedArmor(worn: WornModel[]): Set<ArmorPiece> {
  const slots = new Set<number>()
  for (const w of worn) {
    const shown = new Set(w.visible)
    const conflicts = v2(w.settings)
    if (conflicts) {
      for (const [bone, s] of Object.entries(conflicts)) if (shown.has(bone)) for (const x of slotsOf(s)) slots.add(x)
      continue
    }
    for (const [group, bones] of Object.entries(GROUPS)) if (bones.some((b) => shown.has(b))) for (const x of PART_SLOTS[group]!) slots.add(x)
  }
  return new Set([...slots].map((s) => SLOT_PIECE[s]).filter((p): p is ArmorPiece => !!p))
}
