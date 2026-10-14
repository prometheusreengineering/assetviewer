import { describe, expect, it } from 'vitest'
import { CDN_BASE, LUNAR_INDEXES } from '../../src/config'
import { formatBytes } from '../../src/format'
import { essentialProvider } from '../../src/providers/essential'
import { providers } from '../../src/providers'
import { lunarProvider } from '../../src/providers/lunar'
import { createQueue } from '../../src/queue'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [-5, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.00 KB'],
    [1536, '1.50 KB'],
    [624931, '610.28 KB'],
    [1024 ** 2, '1.00 MB'],
    [5.5 * 1024 ** 3, '5.50 GB'],
    [1024 ** 4, '1.00 TB'],
    [2048 * 1024 ** 4, '2048.00 TB'],
  ])('%d -> %s', (n, s) => expect(formatBytes(n)).toBe(s))
})

describe('createQueue', () => {
  const defer = () => {
    let resolve!: () => void
    let reject!: (e: unknown) => void
    const promise = new Promise<void>((a, b) => ((resolve = a), (reject = b)))
    return { promise, resolve, reject }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('never runs more than `limit` tasks at once and starts them in FIFO order', async () => {
    const run = createQueue(2)
    let active = 0
    let peak = 0
    const started: number[] = []
    const gates = Array.from({ length: 5 }, defer)
    const all = gates.map((g, i) =>
      run(async () => {
        started.push(i)
        peak = Math.max(peak, ++active)
        await g.promise
        active--
        return i
      }),
    )
    await flush()
    expect(started).toEqual([0, 1])
    gates[1]!.resolve()
    await flush()
    expect(started).toEqual([0, 1, 2])
    gates.forEach((g) => g.resolve())
    expect(await Promise.all(all)).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
  })

  it('a rejected task frees its slot and passes its error on', async () => {
    const run = createQueue(1)
    const bad = run(() => Promise.reject(new Error('boom')))
    const good = run(async () => 'ok')
    await expect(bad).rejects.toThrow('boom')
    await expect(good).resolves.toBe('ok')
  })
})

describe('config and providers', () => {
  it('points at the Lunar CDN', () => {
    expect(CDN_BASE).toBe('https://textures.lunarclientcdn.com')
    expect(LUNAR_INDEXES).toHaveLength(2)
    for (const h of LUNAR_INDEXES) expect(h).toMatch(/^[0-9a-f]{40}$/)
  })
  it('registers lunar, dawn and essential by id', () => {
    expect(Object.keys(providers)).toEqual(['lunar', 'dawn', 'essential'])
    expect(providers.lunar).toBe(lunarProvider)
    expect(providers.essential).toBe(essentialProvider)
    for (const [id, p] of Object.entries(providers)) expect(p.id).toBe(id)
  })
  it('essential needs the files of the viewer before it has anything', async () => {
    const p = essentialProvider
    expect(p.available).toBe(true)
    expect(p.name).toBe('Essential')
    await expect(p.load()).resolves.toBeUndefined()
    expect(p.setup!.needed()).toBe(true)
    expect(p.categories()).toEqual([])
    expect(p.items('everything')).toEqual([])
    const it1 = { id: 'a', name: 'a', category: 'x', fields: {}, render: '3d' as const }
    await expect(p.loadModel(it1)).rejects.toThrow(/Unknown item/)
  })
})

describe('gekModelPath', () => {
  it('picks the slim geometry for a slim player, the default otherwise', async () => {
    const { gekModelPath } = await import('../../src/providers/lunar')
    const model = { 'a.geo.json': '!query.is_slim', 'b.geo.json': 'query.is_slim' }
    expect(gekModelPath(model, false)).toBe('a.geo.json')
    expect(gekModelPath(model, true)).toBe('b.geo.json')
    expect(gekModelPath({ 'only.geo.json': '1' }, true)).toBe('only.geo.json')
    expect(gekModelPath('plain.geo.json', true)).toBe('plain.geo.json')
    expect(gekModelPath(undefined, false)).toBeUndefined()
  })
})
