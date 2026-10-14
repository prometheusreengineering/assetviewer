import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDawnCatalog, dawnUrl, FLAT_SHIELD, humanize, loadDawnCatalog, variantScore, words, type DawnCatalog } from '../../src/providers/dawn/catalog'
import { DAWN_FILES, G } from '../fixtures/dawn'
import { installDawnCdn } from '../helpers/cdnMock'

const index = (paths: string[]) => paths.map((name, i) => ({ name, hash: String(i).padStart(40, '0') }))
const fixture = () => buildDawnCatalog(index(DAWN_FILES.map(([p]) => p)))
const byId = (c: DawnCatalog, id: string) => c.entries.find((e) => e.item.id === id)!

afterEach(() => vi.unstubAllGlobals())

describe('names', () => {
  it.each([
    ['4thJulyHat', '4th July Hat'],
    ['spring2025BeeHalo', 'Spring 2025 Bee Halo'],
    ['MCPVPBetaCloak', 'MCPVP Beta Cloak'],
    ['RGMCLogoCloak', 'RGMC Logo Cloak'],
    ['rectangleShield320', 'Rectangle Shield 320'],
    ['summer2025ButterflyAuraV2', 'Summer 2025 Butterfly Aura V 2'],
    ['gamer8BitCrown', 'Gamer 8 Bit Crown'],
    ['blazeTrim', 'Blaze Trim'],
    ['amethyst', 'Amethyst'],
  ])('%s -> %s', (raw, name) => expect(humanize(raw)).toBe(name))

  it('splits words', () => {
    expect(words('dontTouchMyLifeBlackCrown')).toEqual(['dont', 'Touch', 'My', 'Life', 'Black', 'Crown'])
    expect(words('blazeTrim_chest')).toEqual(['blaze', 'Trim', 'chest'])
  })
})

describe('variantScore', () => {
  it('matches colour variants and shared type words', () => {
    expect(variantScore('springFireWyvernWings', 'springAbyssalWyvernWings')).toBe(3)
    expect(variantScore('springFireWyvernWings', 'springButterflyWings')).toBe(2)
    expect(variantScore('summer2024MechaWingsBlue', 'summer2024MechaWingsOrange')).toBe(4)
    expect(variantScore('sharpnessEnchantAuraRed', 'sharpnessEnchantAura')).toBe(3)
    expect(variantScore('dontTouchMyLifeWhiteCrown', 'dontTouchMyLifeBlackCrown')).toBe(5.5)
    // colour words make the closer match
    expect(variantScore('springBlackSneakers', 'springWhiteSneakers')).toBeGreaterThan(variantScore('springBlackSneakers', 'springAnimalSneakers'))
  })
  it('rejects different items', () => {
    expect(variantScore('beenTakenBandana', 'beenTakenFedora')).toBe(0)
    expect(variantScore('demon2024BloodFists', 'beenTakenCorruptedFists')).toBe(0)
    expect(variantScore('angelHalo', 'angelWings')).toBe(0)
    expect(variantScore('fooBar', 'fooBarBaz')).toBe(0)
  })
})

describe('catalog', () => {
  it('claims every file exactly once', () => {
    const c = fixture()
    const claimed = c.entries.flatMap((e) => e.files)
    expect(claimed.sort()).toEqual(DAWN_FILES.map(([p]) => p).sort())
    expect(new Set(c.entries.map((e) => e.item.id)).size).toBe(c.entries.length)
  })

  it('models with geometry, texture, animation and meta', () => {
    const hat = byId(fixture(), 'hats/testHat')
    expect(hat).toMatchObject({
      kind: 'geo',
      path: `${G}hats/testHat.webp`,
      parts: [{ geo: `${G}hats/testHat.geo.json`, texture: `${G}hats/testHat.webp` }],
      anim: `${G}hats/testHat.animation.json`,
      meta: `${G}hats/testHat.meta.json`,
    })
    expect(hat.item).toMatchObject({ name: 'Test Hat', category: 'hats', render: '3d' })
    expect(byId(fixture(), 'hats/testCrown').path).toBe(`${G}hats/testCrown.avif`)
  })

  it('a texture-only colour variant borrows the model, animation and meta', () => {
    const v = byId(fixture(), 'hats/testHatBlue')
    expect(v).toMatchObject({ kind: 'variant', variantOf: 'hats/testHat', parts: [{ geo: `${G}hats/testHat.geo.json`, texture: `${G}hats/testHatBlue.webp` }], anim: `${G}hats/testHat.animation.json` })
    expect(v.files).toEqual([`${G}hats/testHatBlue.webp`])
  })

  it('cloaks, flat shields and armor trims', () => {
    const c = fixture()
    expect(byId(c, 'cloaks/testCape')).toMatchObject({ kind: 'cloak', path: `${G}cloaks/testCape.avif`, parts: [] })
    expect(byId(c, 'shields/testShield')).toMatchObject({ kind: 'shield', parts: [{ geo: FLAT_SHIELD, texture: `${G}shields/testShield.avif` }] })
    const trim = byId(c, 'trim/glowTrim')
    expect(trim.item).toMatchObject({ name: 'Glow Trim', category: 'trim', render: '3d' })
    // slot order head, chest, legs, feet
    expect(trim.parts).toEqual([
      { geo: `${G}trim/head.geo.json`, texture: `${G}trim/glowTrim_head.webp` },
      { geo: `${G}trim/chest.geo.json`, texture: `${G}trim/glowTrim_chest.webp` },
    ])
  })

  it('files filed under the wrong folder join the model of the same name', () => {
    const aura = byId(fixture(), 'auras/strayAura')
    expect(aura.files).toContain(`${G}pets/strayAura.webp`)
    expect(aura.files).toContain(`${G}pets/strayAura.animation.json`)
    expect(aura.path).toBe(`${G}auras/strayAura.webp`)
  })

  it('textures without any model are flat images; shared models and lang files are files', () => {
    const c = fixture()
    expect(byId(c, 'boots/lonelyBoots')).toMatchObject({ kind: 'image', item: { render: 'image' } })
    expect(byId(c, FLAT_SHIELD)).toMatchObject({ kind: 'file', item: { category: 'models', name: 'rectangleShield320.geo.json' } })
    expect(byId(c, `${G}trim/head.geo.json`).item.category).toBe('models')
    expect(byId(c, 'game/lang/en_us.json')).toMatchObject({ kind: 'file', item: { category: 'lang', render: 'file' } })
  })

  it('collections are the shared leading words', () => {
    const c = fixture()
    expect(byId(c, 'hats/testHat').item.fields.collection).toBe('Test')
    expect(byId(c, 'auras/strayAura').item.fields.collection).toBeUndefined()
    const big = buildDawnCatalog(
      index(['arcaneLibrarianHat', 'arcaneLibrarianWings', 'arcaneLibrarianPet', 'spring2025BeeHalo', 'spring2025BeeHat', 'spring2025Frog', 'springFoo'].map((n) => `${G}hats/${n}.webp`)),
    )
    expect(byId(big, 'hats/arcaneLibrarianWings').item.fields.collection).toBe('Arcane Librarian')
    expect(byId(big, 'hats/spring2025BeeHalo').item.fields.collection).toBe('Spring 2025')
    expect(byId(big, 'hats/springFoo').item.fields.collection).toBe('Spring')
  })

  it('a shield without the flat model, or a trim without slot models, is an image', () => {
    const c = buildDawnCatalog(index([`${G}shields/x.webp`, `${G}trim/a_head.webp`]))
    expect(byId(c, 'shields/x').kind).toBe('image')
    expect(byId(c, 'trim/a')).toMatchObject({ kind: 'image', item: { render: 'image' } })
  })

  it('unknown paths become other files', () => {
    const c = buildDawnCatalog(index(['launcher/thing.bin', `${G}deep/nested/x.webp`]))
    expect(c.entries.map((e) => e.item.category)).toEqual(['other', 'other'])
  })
})

describe('loadDawnCatalog', () => {
  it('loads the index through the proxy and hashes it', async () => {
    const cdn = installDawnCdn(DAWN_FILES)
    const c = await loadDawnCatalog()
    expect(cdn.requests[0]).toBe('/dawn/assets_index.json')
    expect(c.entries.length).toBe(fixture().entries.length)
    expect(c.indexHash).toMatch(/^[0-9a-f]{40}$/)
    expect(c.files.get(`${G}hats/testHat.webp`)).toBe(cdn.hashes.get(`${G}hats/testHat.webp`))
    expect(dawnUrl('game/a.webp', 'abc')).toBe('/dawn/game/a.webp?h=abc')
  })
})
