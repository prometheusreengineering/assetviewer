import { describe, expect, it } from 'vitest'
import { boneSide, defaultSide, hiddenBones, sidesOf } from '../../src/providers/essential/rules'

describe('sides', () => {
  it.each([
    ['side_left', 'left'],
    ['arm_right_side_left', 'left'],
    ['arm_left_side_right_outer', 'right'],
    ['chestplate_side_front', 'front'],
    ['helmet_left', undefined],
    ['inside_left', undefined],
  ])('%s -> %s', (name, side) => expect(boneSide(name)).toBe(side))

  it('collects sides from bones and side skin masks, in order', () => {
    expect(sidesOf(['side_right', 'x', 'arm_side_left'])).toEqual(['left', 'right'])
    expect(sidesOf([], ['skin_mask.steve.back.png', 'skin_mask.alex.front.png', 'texture.png'])).toEqual(['front', 'back'])
    expect(sidesOf(['head'])).toEqual([])
  })

  it('default: DEFAULT_SIDE, else right, else front', () => {
    expect(defaultSide(['left', 'right'], [{ type: 'DEFAULT_SIDE', data: { side: 'left' } }])).toBe('left')
    expect(defaultSide(['left', 'right'], [{ type: 'DEFAULT_SIDE', enabled: false, data: { side: 'left' } }])).toBe('right')
    expect(defaultSide(['front', 'back'], undefined)).toBe('front')
    expect(defaultSide(['back'], [{ type: 'DEFAULT_SIDE', data: { side: 'up' } }])).toBe('back')
    expect(defaultSide([], undefined)).toBeUndefined()
  })
})

describe('hiddenBones', () => {
  it("EXTERNAL_HIDDEN_BONE hides the other cosmetic's bones; COSMETIC_BONE_HIDING hides its own parts", () => {
    const r = hiddenBones([
      { id: 'WINGS', settings: [{ type: 'EXTERNAL_HIDDEN_BONE', id: 'BACKPACK', data: { dragon_wings: true, straps: false } }] },
      { id: 'VEST', settings: [{ type: 'COSMETIC_BONE_HIDING', id: 'HOOD', data: { body: true, arms: true } }] },
      { id: 'BACKPACK', settings: [] },
      { id: 'HOOD', settings: null },
    ])
    expect([...r.get('BACKPACK')!]).toEqual(['dragon_wings'])
    expect([...r.get('VEST')!].sort()).toEqual(['arm_left', 'arm_right', 'body'])
    expect(r.has('WINGS')).toBe(false)
  })

  it('only applies between worn cosmetics, and skips disabled rules and rules about itself', () => {
    const r = hiddenBones([
      {
        id: 'A',
        settings: [
          { type: 'EXTERNAL_HIDDEN_BONE', id: 'NOT_WORN', data: { x: true } },
          { type: 'EXTERNAL_HIDDEN_BONE', id: 'B', enabled: false, data: { y: true } },
          { type: 'COSMETIC_BONE_HIDING', id: 'A', data: { head: true } },
        ],
      },
      { id: 'B', settings: [] },
    ])
    expect(r.size).toBe(0)
  })
})
