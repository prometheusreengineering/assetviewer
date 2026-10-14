// Local only: the viewer's real Essential dumps and cache. Skipped unless ESSENTIAL_DUMPS (the dumps folder)
// is set; ESSENTIAL_CACHE defaults to the sibling .minecraft/essential/cosmetic-cache. Nothing is committed.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { MeshLambertMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { AnimationPlayer, type AnimFile } from '../../../src/three/animation/bedrockAnim'
import { buildGeoRig, type GeoFile } from '../../../src/three/geoModel'
import { buildEssentialCatalog } from '../../../src/providers/essential/catalog'
import { cachePath, listingSource, readDumps } from '../../../src/providers/essential/localData'
import { normalizeAnims } from '../../../src/providers/dawn'

const DUMPS = process.env.ESSENTIAL_DUMPS
const CACHE = process.env.ESSENTIAL_CACHE ?? (DUMPS ? join(DUMPS, '../../../essential/cosmetic-cache') : '')

const walk = (dir: string, base = ''): string[] =>
  readdirSync(join(dir, base), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, join(base, e.name)) : [join(base, e.name).split(sep).join('/')]))
const nodeSource = (dir: string) => listingSource(walk(dir), async (p) => (existsSync(join(dir, p)) ? (new Uint8Array(readFileSync(join(dir, p))).buffer as ArrayBuffer) : undefined))

describe.skipIf(!DUMPS)('local Essential data', () => {
  it('every dump becomes an item; cached geometry builds and animations play', async () => {
    const cat = buildEssentialCatalog(await readDumps(nodeSource(DUMPS!)))
    expect(cat.entries.length).toBeGreaterThan(500)
    const failures: string[] = []
    let built = 0
    const read = (sha: string) => {
      const p = join(CACHE, cachePath(sha))
      return existsSync(p) ? readFileSync(p, 'utf8') : undefined
    }
    for (const e of cat.entries) {
      if (!e.geometry || e.item.thumb === 'none') continue
      const g = read(e.files.get(e.geometry)!.sha256)
      if (!g) continue
      try {
        const { bones } = buildGeoRig(JSON.parse(g) as GeoFile, new MeshLambertMaterial(), true)
        built++
        const a = e.animations && read(e.files.get(e.animations)!.sha256)
        if (a) {
          const p = new AnimationPlayer(bones, normalizeAnims(JSON.parse(a) as AnimFile), new Map())
          for (const s of p.states) (p.setState(s), p.tick(700))
        }
      } catch (err) {
        failures.push(`${e.item.id}: ${err}`)
      }
    }
    expect(failures).toEqual([])
    expect(built).toBeGreaterThan(400)
  })
})
