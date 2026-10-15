// Held items, stand-in armor, outfit rules from Essential settings and lit particles.
import { AmbientLight, DirectionalLight, Group, Scene, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { armorHiddenBones, blockedArmor, exclusiveCategories } from '../../src/providers/essential/rules'
import { armorGeo } from '../../src/three/armor'
import { armHeld, SHIELD_DISPLAY, SHIELD_FILE_TO_MODEL, vanillaHeld } from '../../src/three/held'
import { sceneLight } from '../../src/three/particles'

/** A Bedrock file point (px) through a held matrix (object-local = file scaled by 1, 1, -1 over 16), in px. */
const place = (m: ReturnType<typeof armHeld>, p: [number, number, number]) =>
  new Vector3(p[0] / 16, p[1] / 16, -p[2] / 16)
    .applyMatrix4(m)
    .multiplyScalar(16)
    .toArray()
    .map((v) => +v.toFixed(3) + 0)

describe('held items', () => {
  it("vanilla's shield chain: the handle in the left fist, the face out to the side, the long edge forward", () => {
    const m = vanillaHeld(SHIELD_DISPLAY.left, true, SHIELD_FILE_TO_MODEL)
    // Dawn's flat shield: handle 2x6x6 at (-1, 7, -1), plate 12x22x1 at (-6, -1, -2)
    expect(place(m, [0, 10, 2])).toEqual([6, 16, 0])
    const corners = [place(m, [-6, -1, -2]), place(m, [6, 21, -2])]
    // the plate is outside the left arm (x 4..8), 12 tall and 22 long front to back
    expect(corners.map((c) => c[0])).toEqual([10, 10])
    expect(Math.abs(corners[0]![1]! - corners[1]![1]!)).toBe(12)
    expect(Math.abs(corners[0]![2]! - corners[1]![2]!)).toBe(22)
  })
  it('the right hand mirrors it', () => {
    const m = vanillaHeld(SHIELD_DISPLAY.right, false, SHIELD_FILE_TO_MODEL)
    expect(place(m, [0, 10, 2])).toEqual([-6, 16, 0])
  })
  it("a Lunar hand item's display translation is taken from the shoulder, in the arm's y-down space", () => {
    const m = armHeld({ translation: [0.8, 14, -4] }, false)
    // origin: shoulder (-5, 22) + (0.8, -14) px, 4 px forward
    expect(place(m, [0, 0, 0])).toEqual([-4.2, 8, 4])
    // the model's +z (the wand's handle) points back, its +y stays up
    expect(place(m, [0, 0, 4])).toEqual([-4.2, 8, 0])
    expect(place(m, [0, 2, 0])).toEqual([-4.2, 10, 4])
  })
})

describe('stand-in armor', () => {
  it('only the chosen pieces, as Essential player parts under root', () => {
    const bones = (pieces: Parameters<typeof armorGeo>[0]) => armorGeo(pieces)['minecraft:geometry'][0]!.bones.map((b) => b.name)
    expect(bones(['helmet'])).toEqual(['root', 'head'])
    expect(bones(['chestplate', 'boots'])).toEqual(['root', 'body', 'arm_right', 'arm_left', 'leg_right', 'leg_left'])
    // leggings and chestplate share the body bone
    const body = armorGeo(['chestplate', 'leggings'])['minecraft:geometry'][0]!.bones.find((b) => b.name === 'body')!
    expect(body.cubes).toHaveLength(2)
  })
})

describe('Essential outfit rules', () => {
  it('MUTUALLY_EXCLUSIVE slots become category ids (PETS is the PET slot); empty and disabled rules add nothing', () => {
    expect(
      exclusiveCategories([
        { type: 'MUTUALLY_EXCLUSIVE', id: 'UNUSED', data: { slots: ['HEAD', 'HAT', 'PETS'] } },
        { type: 'MUTUALLY_EXCLUSIVE', id: 'UNUSED', data: {} },
        { type: 'MUTUALLY_EXCLUSIVE', id: 'UNUSED', enabled: false, data: { slots: ['CAPE'] } },
        { type: 'VARIANTS', data: { slots: ['BACK'] } },
      ]),
    ).toEqual(['head', 'hat', 'pet'])
    expect(exclusiveCategories(undefined)).toEqual([])
  })

  it('armor hides parts by ARMOR_HANDLING, or named bones by ARMOR_HANDLING_V2 (which wins)', () => {
    const worn = [
      { id: 'ONESIE', settings: [{ type: 'ARMOR_HANDLING', id: 'ONESIE', data: { head: true, legs: true, arms: false } }] },
      {
        id: 'DRESS',
        settings: [
          { type: 'ARMOR_HANDLING', id: 'DRESS', data: { body: true } },
          { type: 'ARMOR_HANDLING_V2', id: 'DRESS', data: { conflicts: { skirt: [1], foot_left: [0], bow: [2] } } },
        ],
      },
      { id: 'PLAIN', settings: [] },
    ]
    const none = armorHiddenBones(worn, [])
    expect(none.size).toBe(0)
    const legs = armorHiddenBones(worn, ['leggings'])
    expect([...legs.get('ONESIE')!].sort()).toEqual(['leg_left', 'leg_right'])
    expect([...legs.get('DRESS')!]).toEqual(['skirt'])
    const helmet = armorHiddenBones(worn, ['helmet', 'chestplate'])
    expect([...helmet.get('ONESIE')!]).toEqual(['head'])
    // V2 replaces the old rule: the dress's body isn't hidden, only the bone tied to the chestplate
    expect([...helmet.get('DRESS')!]).toEqual(['bow'])
    expect(helmet.has('PLAIN')).toBe(false)
  })

  it('cosmetics hide the armor of the parts they show (V2: the slots of its shown conflict bones)', () => {
    expect([...blockedArmor([{ id: 'HAT', settings: [], visible: ['root', 'head', 'brim'] }])]).toEqual(['helmet'])
    expect([...blockedArmor([{ id: 'PANTS', settings: [], visible: ['leg_left'] }])].sort()).toEqual(['boots', 'leggings'])
    expect([...blockedArmor([{ id: 'TOP', settings: [], visible: ['arm_right'] }])]).toEqual(['chestplate'])
    const v2 = [{ id: 'DRESS', settings: [{ type: 'ARMOR_HANDLING_V2', id: 'DRESS', data: { conflicts: { skirt: [1], foot_left: [0] } } }], visible: ['body', 'skirt'] }]
    expect([...blockedArmor(v2)]).toEqual(['leggings'])
  })
})

describe('lit particles', () => {
  it("take the brightness the scene's lights give a surface facing the camera", () => {
    const scene = new Scene()
    expect(sceneLight(scene, new Vector3(0, 0, -5), new Vector3())).toBe(1)
    scene.add(new AmbientLight(0xffffff, Math.PI / 2))
    expect(sceneLight(scene, new Vector3(0, 0, -5), new Vector3())).toBeCloseTo(0.5)
    const key = new DirectionalLight(0xffffff, Math.PI / 4)
    key.position.set(0, 0, -1)
    scene.add(key, key.target)
    scene.updateMatrixWorld(true)
    // facing the key light: + 0.25; from behind it gives nothing
    expect(sceneLight(scene, new Vector3(0, 0, -5), new Vector3())).toBeCloseTo(0.75)
    expect(sceneLight(scene, new Vector3(0, 0, 5), new Vector3())).toBeCloseTo(0.5)
    key.intensity = 10
    expect(sceneLight(scene, new Vector3(0, 0, -5), new Vector3())).toBe(1)
    // lights deeper in the tree aren't the scene's lights
    const g = new Group()
    g.add(new AmbientLight(0xffffff, 100))
    expect(sceneLight(new Scene().add(g), new Vector3(0, 0, -5), new Vector3())).toBe(1)
  })
})
