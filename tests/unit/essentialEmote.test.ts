import { afterEach, describe, expect, it, vi } from 'vitest'
import { emoteSequence, playerParts } from '../../src/providers/essential/emote'
import { SoundPlayer, soundCues } from '../../src/providers/essential/sounds'

afterEach(() => vi.unstubAllGlobals())

describe('emoteSequence', () => {
  it("the EMOTE trigger's animation, then its on_complete loop", () => {
    const anims = { 'animation.x.start': {}, 'animation.x.loop': {} }
    expect(emoteSequence({ animations: anims, triggers: [{ type: 'EMOTE', name: 'animation.x.start', on_complete: { name: 'animation.x.loop' } }] })).toEqual(['animation.x.start', 'animation.x.loop'])
    expect(emoteSequence({ animations: anims, triggers: [{ type: 'EMOTE', name: 'animation.x.loop' }] })).toEqual(['animation.x.loop'])
    // no trigger: the first animation
    expect(emoteSequence({ animations: anims })).toEqual(['animation.x.start'])
    expect(emoteSequence({ animations: {} })).toEqual([])
  })
})

describe('playerParts', () => {
  it('standard skin layout, outer layer inflated; slim arms are 3 px', () => {
    const wide = playerParts(false)
    expect(Object.keys(wide)).toEqual(['head', 'body', 'arm_right', 'arm_left', 'leg_right', 'leg_left'])
    expect(wide.head).toEqual([
      { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
      { origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 },
    ])
    expect(wide.arm_right![0]).toMatchObject({ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] })
    const slim = playerParts(true)
    expect(slim.arm_right![0]).toMatchObject({ origin: [-7, 12, -2], size: [3, 12, 4] })
    expect(slim.arm_left![1]).toMatchObject({ origin: [4, 12, -2], size: [3, 12, 4], uv: [48, 48] })
  })
})

describe('sounds', () => {
  const defs = { sound_definitions: { beat: { sounds: ['sounds/a', { name: 'sounds/b', volume: 0.3 }] }, none: { sounds: [] } } }

  it('soundCues reads sound_effects (single or lists)', () => {
    const file = { animations: { 'animation.x': { sound_effects: { '0.5': { effect: 'beat' }, '1.0': [{ effect: 'beat' }, { effect: 'none' }], nope: { effect: 'z' } } }, other: {} } }
    expect(soundCues(file, ['animation.x'])).toEqual([
      { anim: 'animation.x', time: 0.5, effect: 'beat' },
      { anim: 'animation.x', time: 1, effect: 'beat' },
      { anim: 'animation.x', time: 1, effect: 'none' },
    ])
  })

  function fakeAudio() {
    const started: number[] = []
    class Ctx {
      destination = {}
      resume = vi.fn(async () => {})
      decodeAudioData = vi.fn(async () => ({ duration: 1 }))
      createGain() {
        return { gain: { value: 1 }, connect: (d: unknown) => d }
      }
      createBufferSource() {
        return { buffer: null, connect: (g: unknown) => g, start: () => started.push(1), stop: vi.fn(), onended: null }
      }
    }
    vi.stubGlobal('AudioContext', Ctx)
    return started
  }

  it('plays cues as the timeline passes them, only while enabled; wraps on loops; seeks play nothing', async () => {
    const started = fakeAudio()
    const read = vi.fn(async () => new ArrayBuffer(4))
    const p = new SoundPlayer([{ anim: 'a', time: 0, effect: 'beat' }, { anim: 'a', time: 1, effect: 'beat' }], defs, read)
    const flush = () => new Promise((r) => setTimeout(r, 0))
    // disabled: the clock still moves but nothing plays
    p.at(0, 2)
    p.at(0.4, 2)
    await flush()
    expect(started).toHaveLength(0)
    p.setEnabled(true)
    p.at(0.8, 2)
    p.at(1.2, 2) // passes 1.0
    await flush()
    expect(started).toHaveLength(1)
    p.at(1.9, 2)
    p.at(0.1, 2) // loop wrap passes 0.0
    await flush()
    expect(started).toHaveLength(2)
    p.at(1.5, 2) // a seek: nothing plays
    await flush()
    expect(started).toHaveLength(2)
    // decoded buffers are cached per file
    expect(read.mock.calls.length).toBeLessThanOrEqual(2)
    p.dispose()
  })
})
