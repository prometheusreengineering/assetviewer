// Live CDN in a real browser: Cache Storage, image decoding, and one model of each kind through the provider.
import { Mesh, type Object3D } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { fileUrl, getFileBuffer, getIndexBuffer } from '../../src/cdn'
import { LUNAR_INDEXES } from '../../src/config'
import { lunarProvider as lp } from '../../src/providers/lunar'
import { PREFIX } from '../../src/providers/lunar/catalog'

const drawn = (o: Object3D) => {
  o.updateMatrixWorld(true)
  let n = 0
  o.traverseVisible((x) => x instanceof Mesh && Math.abs(x.matrixWorld.determinant()) > 1e-12 && n++)
  return n
}

beforeAll(async () => {
  await lp.load()
})

describe('cdn cache (Cache Storage)', () => {
  it('stores fetched files in assetviewer-cdn-v1 and serves them from there', async () => {
    const index = new TextDecoder().decode(await getIndexBuffer(LUNAR_INDEXES[0]!))
    const [path, hash] = index.split('\n').find((l) => l.startsWith(PREFIX + 'cosmetics.json'))!.split(' ')
    expect(path).toBe(PREFIX + 'cosmetics.json')
    const a = await getFileBuffer(hash!)
    const cache = await caches.open('assetviewer-cdn-v1')
    await expect.poll(async () => !!(await cache.match(fileUrl(hash!)))).toBe(true)
    const b = await getFileBuffer(hash!)
    expect(new Uint8Array(b)).toEqual(new Uint8Array(a))
    expect(JSON.parse(new TextDecoder().decode(a)).length).toBeGreaterThan(100)
  })
})

describe('provider in the browser', () => {
  const first = (pred: (id: string, cat: string) => boolean) => lp.items('everything').find((i) => pred(i.id, i.category))!

  it.each([
    ['gek hat', 'hat'],
    ['cloak', 'cloak'],
    ['dragon wings', 'dragon_wings'],
    ['pet', 'pet'],
  ])('loads a %s with real textures', async (_, cat) => {
    const it = first((id, c) => c === cat && /^\d+$/.test(id))
    const m = await lp.loadModel(it)
    m.tick(performance.now())
    expect(drawn(m.object)).toBeGreaterThan(0)
    m.dispose()
  })

  it('loads a legacy OBJ item', async () => {
    const it = lp.items('everything').find((i) => i.render === '3d' && /^\d+$/.test(i.id) && lp.info!(i).Source?.includes('/models/hats/'))
    expect(it).toBeDefined()
    const m = await lp.loadModel(it!)
    expect(drawn(m.object)).toBeGreaterThan(0)
  })

  it('plays an emote on the player with the placeholder skin', async () => {
    const it = lp.items('emotes')[0]!
    const m = await lp.loadModel(it)
    expect(m.timeline!.duration).toBeGreaterThan(0)
    m.timeline!.seek(m.timeline!.duration / 2)
    expect(drawn(m.object)).toBeGreaterThan(0)
    m.dispose()
  })

  it('image items come as decodable blob: urls; dimensions are read from the header', async () => {
    const badge = lp.items('badges')[0]!
    const url = await lp.imageUrl(badge)
    expect(url).toMatch(/^blob:/)
    const img = new Image()
    img.src = url
    await img.decode()
    expect(img.naturalWidth).toBeGreaterThan(0)
    await lp.ensureDimensions!([badge], () => {}, new AbortController().signal)
    expect(badge.fields.width).toBe(img.naturalWidth)
    expect(badge.fields.height).toBe(img.naturalHeight)
  })
})
