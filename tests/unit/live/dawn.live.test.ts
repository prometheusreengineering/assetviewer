// Live: the real Dawn CDN (assets.dawn.gg, fetched directly: Node has no CORS). Needs network access.
import { Mesh, MeshLambertMaterial } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { AnimationPlayer, type AnimFile } from '../../../src/three/animation/bedrockAnim'
import { buildGeoRig, type GeoFile } from '../../../src/three/geoModel'
import { buildDawnCatalog, DAWN_CATEGORIES, type DawnCatalog, type DawnIndexEntry } from '../../../src/providers/dawn/catalog'

const ORIGIN = 'https://assets.dawn.gg/assets/'
let index: DawnIndexEntry[]
let cat: DawnCatalog
const json = new Map<string, unknown>()

async function fetchJson(paths: string[]) {
  const queue = [...paths]
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      for (let i = 0; ; i++) {
        try {
          json.set(p, await (await fetch(ORIGIN + p)).json())
          break
        } catch (e) {
          if (i >= 3) throw e
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
}

beforeAll(async () => {
  index = (await (await fetch(ORIGIN + 'assets_index.json')).json()) as DawnIndexEntry[]
  cat = buildDawnCatalog(index)
  await fetchJson(index.map((e) => e.name).filter((n) => /\.(geo|animation)\.json$/.test(n)))
}, 300_000)

describe('live Dawn catalog', () => {
  it('has a thousand-odd files with sha1 hashes and every file is claimed once', () => {
    expect(index.length).toBeGreaterThan(1000)
    for (const e of index) expect(e.hash).toMatch(/^[0-9a-f]{40}$/)
    const claimed = cat.entries.flatMap((e) => e.files)
    expect(claimed.length).toBe(index.length)
    expect(new Set(claimed).size).toBe(index.length)
  })

  it('every cosmetic folder has items, and almost everything has a 3D model', () => {
    for (const id of Object.keys(DAWN_CATEGORIES)) expect(cat.entries.filter((e) => e.item.category === id).length, id).toBeGreaterThan(0)
    const cos = cat.entries.filter((e) => e.kind !== 'file')
    expect(cos.filter((e) => e.item.render === 'image').length).toBeLessThan(cos.length / 50)
  })

  it('every model part points at indexed files', () => {
    for (const e of cat.entries) {
      for (const p of e.parts) {
        expect(cat.files.has(p.geo), p.geo).toBe(true)
        expect(cat.files.has(p.texture), p.texture).toBe(true)
      }
      if (e.anim) expect(cat.files.has(e.anim)).toBe(true)
    }
  })
})

describe('live Dawn models', () => {
  it('every geometry builds a rig with meshes', () => {
    const failures: string[] = []
    const mat = new MeshLambertMaterial()
    for (const [p, g] of json) {
      if (!p.endsWith('.geo.json')) continue
      try {
        const { root } = buildGeoRig(g as GeoFile, mat)
        let meshes = 0
        root.traverse((o) => void (o instanceof Mesh && meshes++))
        if (!meshes) failures.push(`${p}: no meshes`)
      } catch (e) {
        failures.push(`${p}: ${e}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('every animation compiles and plays on its model without NaNs', () => {
    const failures: string[] = []
    const mat = new MeshLambertMaterial()
    for (const e of cat.entries) {
      if (!e.anim || !e.parts[0]) continue
      try {
        const { bones } = buildGeoRig(json.get(e.parts[0].geo) as GeoFile, mat)
        const file = json.get(e.anim) as AnimFile
        const player = new AnimationPlayer(bones, file, new Map())
        for (const state of player.states) {
          player.setState(state)
          for (const ms of [0, 333, 1250, 4000]) {
            player.tick(ms)
            for (const [name, b] of bones) {
              const v = [...b.group.position.toArray(), ...b.group.rotation.toArray().slice(0, 3), ...b.group.scale.toArray()] as number[]
              if (v.some((x) => !Number.isFinite(x))) failures.push(`${e.item.id} ${state} ${name} @${ms}`)
            }
          }
        }
      } catch (err) {
        failures.push(`${e.item.id}: ${err}`)
      }
    }
    expect(failures).toEqual([])
  })
})
