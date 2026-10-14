import { describe, expect, it } from 'vitest'
import { vanillaName } from '../../src/three/vanillaTextures'

describe('vanilla stand-ins', () => {
  it.each([
    ['minecraft:textures/blocks/dirt.png', 'dirt'],
    ['minecraft:textures/blocks/snow.png', 'snow'],
    ['minecraft:textures/items/snowball.png', 'snowball'],
    ['grass', 'grass_side'],
    ['grass_top', 'grass_top'],
    ['minecraft:textures/blocks/wool_colored_white.png', undefined],
  ])('%s -> %s', (ref, name) => expect(vanillaName(ref)).toBe(name))
})
