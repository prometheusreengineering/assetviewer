// Live: a sample of real models through the loaders (textures stubbed, see helpers/bitmaps), every emote's
// action, every particle scheme the emotes use, and the Molang function library.
import { Matrix4, Mesh, type Object3D } from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getFileJson, getFileText } from '../../../src/cdn'
import { lunarProvider as lp } from '../../../src/providers/lunar'
import { PREFIX, type EmotesJson } from '../../../src/providers/lunar/catalog'
import { findAction, playerBody } from '../../../src/providers/lunar/emotes'
import { compile, newScope, parseFunctions } from '../../../src/three/animation/molang'
import { Emitter, type Scheme } from '../../../src/three/particles'
import type { CosmeticItem } from '../../../src/providers/types'
import { installBitmapStubs } from '../../helpers/bitmaps'
import { installMemoryCaches } from '../../helpers/memoryCaches'

const PER_CATEGORY = 4
let files: Map<string, string>
let emotes: EmotesJson
const hashOf = (rel: string) => files.get(PREFIX + rel.replace(/^lunar:/, ''))!

/** Meshes that would be drawn: visible all the way up and not collapsed to scale 0. */
function drawn(o: Object3D) {
  o.updateMatrixWorld(true)
  let n = 0
  o.traverseVisible((x) => {
    if (x instanceof Mesh && Math.abs(x.matrixWorld.determinant()) > 1e-12) n++
  })
  return n
}
/** Up to `n` items spread evenly over the list. */
const spread = <T>(xs: T[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]!))

beforeAll(async () => {
  installMemoryCaches()
  installBitmapStubs()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await lp.load()
  files = new Map(lp.indexedFiles!().map((f) => [PREFIX + f.path, f.hash]))
  emotes = await getFileJson<EmotesJson>(hashOf('emotes/emotes.json'))
})
afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('live models (sample)', () => {
  const sample = () => {
    const out: CosmeticItem[] = []
    for (const c of lp.categories()) {
      if (c.group !== 'Cosmetics (3D)' || c.id === 'emotes') continue
      // catalog items (numeric ids) that render in 3D
      out.push(...spread(lp.items(c.id).filter((i) => i.render === '3d' && /^\d+$/.test(i.id)), PER_CATEGORY))
    }
    return out
  }

  it('each sampled 3D item loads, draws something and fits the thumbnail', { timeout: 600_000 }, async () => {
    const items = sample()
    expect(items.length).toBeGreaterThan(20)
    const failures: string[] = []
    for (const it of items) {
      try {
        const m = await lp.loadModel(it)
        m.tick(0)
        if (!drawn(m.object)) failures.push(`${it.category}/${it.name}: nothing drawn`)
        const raw = await lp.loadModel(it, { raw: true })
        if (!drawn(raw.object)) failures.push(`${it.category}/${it.name}: nothing drawn in player space`)
        m.dispose()
        raw.dispose()
      } catch (e) {
        failures.push(`${it.category}/${it.name}: ${(e as Error).message}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('a few items dress the player together', { timeout: 300_000 }, async () => {
    const pick = (cat: string) => lp.items(cat).find((i) => /^\d+$/.test(i.id) && i.render === '3d')!
    const m = await lp.dressPlayer!([pick('hat'), pick('cloak'), pick('dragon_wings')].filter(Boolean))
    expect(drawn(m.object)).toBeGreaterThan(3)
    m.dispose()
  })

  it('sampled emotes load as players on a timeline', { timeout: 600_000 }, async () => {
    for (const it of spread(lp.items('emotes'), 6)) {
      const m = await lp.loadModel(it)
      expect(m.timeline!.duration).toBeGreaterThan(0)
      m.timeline!.seek(m.timeline!.duration / 2)
      expect(drawn(m.object)).toBeGreaterThan(0)
      m.dispose()
    }
  })
})

describe('live emotes', () => {
  it('the player body has the bones the dressing code uses', async () => {
    const body = await playerBody(hashOf)
    const names = body.bones.map((b) => b.name)
    for (const b of ['head', 'body', 'low_body', 'right_arm', 'left_arm', 'right_leg', 'left_leg', 'anchor']) expect(names).toContain(b)
    expect(body.meshes.has('body')).toBe(true)
  })

  it('every emote finds its action', { timeout: 900_000 }, async () => {
    const missing: string[] = []
    for (const em of emotes.emotes) if (!(await findAction('emote_' + em.name, emotes, hashOf))) missing.push(em.name)
    expect(missing).toEqual([])
  })

  it('every particle scheme the emotes reference exists, builds and simulates', { timeout: 300_000 }, async () => {
    const cfg = await getFileJson<Record<string, { morphs?: { morph: string }[] }>>(hashOf('particles/configuration.json'))
    const names = new Set<string>()
    for (const em of emotes.emotes) {
      for (const m of (em.morph && cfg[em.morph]?.morphs) || []) {
        const s = /Scheme:"([^"]+)"/.exec(m.morph)?.[1]
        if (s) names.add(s)
      }
      if (em.particleEffect) names.add(em.particleEffect)
    }
    expect(names.size).toBeGreaterThan(0)
    const missing = [...names].filter((n) => !files.has(`${PREFIX}particles/schemes/${n}.particle.json`))
    expect(missing).toEqual([])
    const lib = parseFunctions('')
    for (const n of names) {
      const scheme = await getFileJson<Scheme>(hashOf(`particles/schemes/${n}.particle.json`))
      const e = new Emitter(scheme, lib, undefined, () => new Matrix4())
      e.setEnabled(true)
      e.step(1)
      const c = e.object.geometry.getAttribute('aCenter').array as Float32Array
      expect(c.every(Number.isFinite), n).toBe(true)
      e.dispose()
    }
  })
})

describe('live Molang library', () => {
  it('parses functions.molang and every function returns a finite number', async () => {
    const lib = parseFunctions(await getFileText(hashOf('cosmetics/functions.molang')))
    expect(lib.size).toBeGreaterThan(0)
    for (const [name, f] of lib) {
      const args = f.params.map(() => '1').join(', ')
      const v = compile(`${name}(${args})`, lib)({ ...newScope(), q: { anim_time: 0.5, life_time: 0.5 } })
      expect(Number.isFinite(v), name).toBe(true)
    }
  })
})
