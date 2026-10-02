import { Mesh } from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EmotesJson } from '../../src/providers/lunar/catalog'
import { BODY, emoteEffects, emoteSources, emoteTimeline, findAction, newPlayer, playerBody } from '../../src/providers/lunar/emotes'
import { installBitmapStubs } from '../helpers/bitmaps'
import { installCdn, type FakeCdn } from '../helpers/cdnMock'
import { LUNAR_FULL, LUNAR_FILES, P } from '../fixtures/lunar'
import { PLAYER_BONES } from '../fixtures/player'

let cdn: FakeCdn
const hashOf = (rel: string) => {
  const h = cdn.hashes.get(P + rel.replace(/^lunar:/, ''))
  if (!h) throw new Error('Not in CDN index: ' + rel)
  return h
}
const data = LUNAR_FILES.find(([p]) => p === 'emotes/emotes.json')![1] as EmotesJson
const emote = (id: number) => data.emotes.find((e) => e.id === id)!

beforeAll(() => {
  cdn = installCdn(LUNAR_FULL)
  installBitmapStubs()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('emoteTimeline', () => {
  it('loops: current tick = elapsed ms / 50 modulo the duration', () => {
    const seen: number[] = []
    const { timeline, tick } = emoteTimeline(40, true, (t) => seen.push(t))
    expect(timeline.duration).toBe(2)
    tick(1000) // start
    tick(1500)
    tick(1000 + 50 * 45)
    expect(seen).toEqual([0, 10, 5])
    expect(timeline.time).toBe(0.25)
  })
  it('non-looping emotes hold the last pose for 20 ticks, then restart', () => {
    const seen: number[] = []
    const { tick } = emoteTimeline(40, false, (t) => seen.push(t))
    tick(0)
    tick(50 * 50)
    tick(50 * 61)
    expect(seen).toEqual([0, 40, 1])
  })
  it('pause freezes the tick and resume continues from there', () => {
    const seen: number[] = []
    const { timeline, tick } = emoteTimeline(100, true, (t) => seen.push(t))
    tick(0)
    tick(500)
    timeline.paused = true
    expect(timeline.paused).toBe(true)
    tick(5000)
    timeline.paused = true
    timeline.paused = false
    tick(5100)
    expect(seen).toEqual([0, 10, 10, 12])
  })
  it('seek clamps, applies immediately and continues from the new point', () => {
    const seen: number[] = []
    const { timeline, tick } = emoteTimeline(40, true, (t) => seen.push(t))
    tick(100_000)
    timeline.seek(1)
    timeline.seek(-5)
    timeline.seek(99)
    expect(seen).toEqual([0, 20, 0, 40])
    timeline.seek(1)
    tick(100_100)
    expect(seen.at(-1)).toBe(22)
  })
  // performance.now() is small right after page load: seeking further than it must not restart playback.
  it('seek early after page load keeps the position', () => {
    const seen: number[] = []
    const { timeline, tick } = emoteTimeline(40, true, (t) => seen.push(t))
    tick(0)
    timeline.seek(1)
    tick(100)
    expect(seen.at(-1)).toBe(22)
  })
})

describe('findAction', () => {
  it('scans the action files until the action is found and slices its block', async () => {
    const found = await findAction('emote_wave_hello', data, hashOf)
    expect(found!.file).toBe('emotes/models/actions_b.bobj')
    expect(found!.action.length).toBe(40)
    expect(found!.text.startsWith('an emote_wave_hello\n')).toBe(true)
    expect(found!.action.bones.get('right_arm')![0]!.kind).toBe('rotation')
  })
  it('is cached per name', async () => {
    const a = findAction('emote_dance', data, hashOf)
    expect(findAction('emote_dance', data, hashOf)).toBe(a)
    expect((await a)!.action.length).toBe(30)
  })
  it('an unknown action resolves to undefined', async () => {
    expect(await findAction('emote_nope', data, hashOf)).toBeUndefined()
  })
})

describe('emoteSources', () => {
  it('body, action, props and textures (from emotes.json, else default.json)', async () => {
    const s = await emoteSources(emote(1), data, hashOf)
    expect(s.files.map((f) => f.name)).toEqual(['default.bobj', 'wave_hello.bobj', 'hat_prop.bobj', 'prop.webp'])
    expect(s.props).toEqual([{ mesh: expect.objectContaining({ name: 'hat_prop' }), texRel: 'emotes/textures/prop.webp', showAt: 5 }])
    const noTex = await emoteSources(emote(1), { ...data, meshes: {} }, hashOf)
    expect(noTex.props[0]!.texRel).toBe('emotes/textures/prop.webp')
  })
  it('props that are nowhere are skipped; an emote without props has just body + action', async () => {
    const s = await emoteSources({ ...emote(1), meshes: [{ name: 'ghost_prop', show_at: 0 }] }, data, hashOf)
    expect(s.props).toEqual([])
    const d = await emoteSources(emote(2), data, hashOf)
    expect(d.files.map((f) => f.name)).toEqual(['default.bobj', 'dance.bobj'])
    const none = await emoteSources(emote(3), data, hashOf)
    expect(none.found).toBeUndefined()
    expect(none.files.map((f) => f.name)).toEqual(['default.bobj'])
  })
  it('the body path', () => expect(BODY).toBe('emotes/models/entity/default.bobj'))
})

describe('player body', () => {
  it('is parsed once and has the armature', async () => {
    const a = playerBody(hashOf)
    expect(playerBody(hashOf)).toBe(a)
    expect((await a).bones.map((b) => b.name)).toEqual(PLAYER_BONES)
  })
  it('newPlayer builds a skinned player', async () => {
    const p = await newPlayer(hashOf)
    expect(p.skel.bones.has('head')).toBe(true)
    p.dispose()
  })
})

describe('emoteEffects', () => {
  const live = (fx: { object: { children: unknown[] } }) => (fx.object.children as Mesh[]).map((m) => m.geometry.drawRange.count / 6)

  it('morph entries: scheme + bone + start/length; bad entries are skipped', async () => {
    const p = await newPlayer(hashOf)
    const fx = (await emoteEffects(emote(1), hashOf, p, 50))!
    // one valid entry (the no-scheme and unknown-bone ones are dropped)
    expect(fx.object.children).toHaveLength(1)
    fx.update(0)
    fx.update(5)
    expect(live(fx)).toEqual([0])
    fx.update(15)
    expect(live(fx)[0]).toBeGreaterThan(0)
    // a jump back resets the particles
    fx.update(2)
    expect(live(fx)).toEqual([0])
    fx.dispose()
  })
  it('particleEffect uses the scheme for the whole emote', async () => {
    const p = await newPlayer(hashOf)
    const fx = (await emoteEffects(emote(3), hashOf, p, 20))!
    expect(fx.object.children).toHaveLength(1)
    fx.update(0)
    fx.update(5)
    expect(live(fx)[0]).toBeGreaterThan(0)
  })
  it('no morph and no effect: undefined', async () => {
    const p = await newPlayer(hashOf)
    expect(await emoteEffects(emote(2), hashOf, p, 20)).toBeUndefined()
    expect(await emoteEffects({ ...emote(2), morph: 'not_configured' }, hashOf, p, 20)).toBeUndefined()
  })
})
