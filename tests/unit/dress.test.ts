import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, SkinnedMesh, Vector3 } from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EmotesJson, Kind, LunarEntry } from '../../src/providers/lunar/catalog'
import { dressPlayer, grow, PART_CENTER, socket, WORN_SCALE } from '../../src/providers/lunar/dress'
import type { LoadedModel } from '../../src/providers/types'
import { createPlayer } from '../../src/three/player'
import { parseBobj } from '../../src/three/bobj'
import { fakeBitmap, installBitmapStubs } from '../helpers/bitmaps'
import { installCdn, type FakeCdn } from '../helpers/cdnMock'
import { LUNAR_FILES, LUNAR_FULL, P } from '../fixtures/lunar'
import { playerBobj } from '../fixtures/player'

let cdn: FakeCdn
const hashOf = (rel: string) => cdn.hashes.get(P + rel)!
const data = LUNAR_FILES.find(([p]) => p === 'emotes/emotes.json')![1] as EmotesJson

beforeAll(() => {
  cdn = installCdn(LUNAR_FULL)
  installBitmapStubs()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const entry = (kind: Kind, category = 'hat'): LunarEntry => ({ kind, path: 'x', modelKey: '', info: {}, item: { id: 'x' + Math.random(), name: 'x', category, render: '3d', fields: {} } })
const model = (object: Object3D, extra: Partial<LoadedModel> = {}): LoadedModel => ({ object, files: [{ name: 'f', data: new Uint8Array(1) }], frames: 1, tick: vi.fn(), states: [], state: '', setState: vi.fn(), dispose: vi.fn(), ...extra })
const box = (w = 0.2, h = 0.2, d = 0.2) => new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial())
/** The player bone an object ended up under (through its socket holder). */
const boneOf = (o: Object3D) => o.parent?.parent?.name
/** Dresses with hand-made raw models: entries[i] gets objects[i]. */
async function dress(objects: Object3D[], entries: LunarEntry[], emote?: EmotesJson['emotes'][number]) {
  const models = objects.map((o) => model(o))
  const loaded = await dressPlayer(entries, emote, data, hashOf, async (e) => models[entries.indexOf(e)]!)
  loaded.object.updateMatrixWorld(true)
  return { loaded, models }
}

describe('grow', () => {
  it('scales by WORN_SCALE around the part center', () => {
    const m = grow('head')
    const c = new Vector3(...PART_CENTER.head!)
    expect(c.clone().applyMatrix4(m).distanceTo(c)).toBeCloseTo(0)
    const p = c.clone().add(new Vector3(0, 1, 0)).applyMatrix4(m)
    expect(p.y - c.y).toBeCloseTo(WORN_SCALE)
    expect(grow('nope').equals(new Matrix4())).toBe(true)
  })
})

describe('socket', () => {
  it('re-parents an object under a bone without moving it', () => {
    const scene = new Group()
    const bone = new Group()
    bone.position.set(1, 2, 3)
    bone.rotation.set(0.3, 0.2, 0.1)
    const parent = new Group()
    parent.position.set(-1, 0, 4)
    const obj = new Group()
    obj.position.set(0.5, 0.5, 0.5)
    scene.add(bone, parent)
    parent.add(obj)
    scene.updateMatrixWorld(true)
    const before = obj.getWorldPosition(new Vector3())
    socket(bone, obj)
    scene.updateMatrixWorld(true)
    expect(obj.parent!.parent).toBe(bone)
    expect(obj.getWorldPosition(new Vector3()).distanceTo(before)).toBeCloseTo(0)
    expect(obj.position.toArray()).toEqual([0.5, 0.5, 0.5])
    // the holder follows the bone from then on
    bone.position.x += 1
    scene.updateMatrixWorld(true)
    expect(obj.getWorldPosition(new Vector3()).x).toBeCloseTo(before.x + 1)
  })
  it('with a part, the object is grown around the part center', () => {
    const scene = new Group()
    const bone = new Group()
    const obj = new Group()
    obj.position.set(...PART_CENTER.head!).add(new Vector3(0, 1, 0))
    scene.add(bone, obj)
    scene.updateMatrixWorld(true)
    socket(bone, obj, 'head')
    scene.updateMatrixWorld(true)
    expect(obj.getWorldPosition(new Vector3()).y).toBeCloseTo(PART_CENTER.head![1] + WORN_SCALE)
  })
})

describe('dressPlayer: gek biped bones', () => {
  it('sockets each biped bone to its player bone (armor bones via their missing parent)', async () => {
    const root = new Group()
    const head = new Group()
    head.name = 'bipedHead'
    head.position.set(0, 1.6, 0)
    const body = new Group()
    body.name = 'bipedBody'
    const rightArm = new Group()
    rightArm.name = 'bipedRightArm'
    rightArm.position.set(-0.3, 1.3, 0)
    const sword = new Group()
    sword.name = 'sword'
    sword.userData.missingParent = 'armorRightArm'
    sword.position.set(-0.4, 1, 0)
    const item = new Group()
    item.name = 'bipedLeftItem'
    item.position.set(0.4, 1, 0)
    root.add(head, body, rightArm, sword, item)
    await dress([root], [entry('gek')])
    expect(boneOf(head)).toBe('head')
    expect(boneOf(body)).toBe('low_body')
    expect(boneOf(rightArm)).toBe('right_arm')
    expect(boneOf(sword)).toBe('right_arm')
    expect(boneOf(item)).toBe('left_arm')
  })
  it('follows the limb on the same side when a model mirrors its pivots', async () => {
    const root = new Group()
    const arm = new Group()
    arm.name = 'bipedRightArm'
    arm.position.set(0.3, 1.3, 0)
    const leg = new Group()
    leg.name = 'bipedLeftLeg'
    leg.position.set(-0.1, 0.5, 0)
    const centered = new Group()
    centered.name = 'bipedLeftArm'
    root.add(arm, leg, centered)
    await dress([root], [entry('gek')])
    expect(boneOf(arm)).toBe('left_arm')
    expect(boneOf(leg)).toBe('right_leg')
    expect(boneOf(centered)).toBe('left_arm')
  })
  it('nested biped bones are each socketed', async () => {
    const root = new Group()
    const bodyB = new Group()
    bodyB.name = 'bipedBody'
    const headB = new Group()
    headB.name = 'bipedHeadwear'
    bodyB.add(headB)
    root.add(bodyB)
    await dress([root], [entry('gek')])
    expect(boneOf(bodyB)).toBe('low_body')
    expect(boneOf(headB)).toBe('head')
  })
})

describe('dressPlayer: attached_bone', () => {
  it.each([
    ['HEAD', 'head'],
    ['SHOULDER', 'low_body'],
    ['RIGHT_ARM', 'right_arm'],
  ])('%s -> %s', async (attached, bone) => {
    const o = new Group()
    o.add(box())
    o.userData.attachedBone = attached
    await dress([o], [entry('gek')])
    expect(boneOf(o)).toBe(bone)
    if (attached === 'RIGHT_ARM') {
      expect(o.position.toArray()).toEqual([-0.375, 0.7, 0.1])
      expect(o.rotation.x).toBeCloseTo(-Math.PI / 2)
    }
  })
  it('no biped bones and no attached bone: stays in the scene', async () => {
    const o = new Group()
    const { loaded } = await dress([o], [entry('cloak')])
    expect(o.parent).toBe(loaded.object.children[0])
  })
})

describe('dressPlayer: legacy OBJ placement', () => {
  const obj = (folder: string, body: boolean, mesh: Mesh, space = 'local') => {
    const o = new Group()
    o.add(mesh)
    Object.assign(o.userData, { objSpace: space, objBody: body, objFolder: folder })
    return o
  }
  it('hats around the head center go to the head center; hats above it sit on the head', async () => {
    const centered = obj('tophat', false, box())
    const above = obj('crown', false, box(0.2, 0.2, 0.2).translateY(0.2))
    await dress([centered, above], [entry('obj'), entry('obj')])
    expect(centered.position.y).toBeCloseTo(1.75)
    // min.y = 0.1 > -0.05: lifted so its bottom is at HEAD_TOP
    expect(above.position.y).toBeCloseTo(1.75 + 0.25 - 0.1)
    expect(boneOf(centered)).toBe('head')
  })
  it('folder exceptions: mask, bandanna (turned), face bandanna; glasses are lowered', async () => {
    const mask = obj('mask', false, box())
    const band = obj('bandanna', false, box())
    const face = obj('facebandanna', false, box())
    const glasses = obj('specs', false, box())
    await dress([mask, band, face, glasses], [entry('obj', 'mask'), entry('obj', 'bandanna'), entry('obj', 'bandanna'), entry('obj', 'glasses')])
    expect(mask.position.y).toBeCloseTo(1.62)
    expect(band.position.y).toBeCloseTo(1.875)
    expect(band.rotation.y).toBeCloseTo(-Math.PI / 2)
    expect(face.position.y).toBeCloseTo(1.6)
    expect(glasses.position.y).toBeCloseTo(1.75 - 1 / 16)
  })
  it('bodywear: hanging at the neck, bow ties under it, flat ones onto the chest, others at the chest', async () => {
    const tie = obj('tie', true, box(0.1, 0.3, 0.05).translateY(-0.2))
    const bow = obj('bow', true, box(0.2, 0.1, 0.01).translateY(0.05))
    const flat = obj('logo', true, box(0.4, 0.4, 0.02))
    const vest = obj('vest', true, box(0.5, 0.6, 0.3))
    await dress([tie, bow, flat, vest], [entry('obj', 'bodywear'), entry('obj', 'bodywear'), entry('obj', 'bodywear'), entry('obj', 'bodywear')])
    expect(tie.position.y).toBeCloseTo(1.5)
    expect(bow.position.y).toBeCloseTo(1.5 - 0.1 - 0.03)
    expect(bow.position.z).toBeCloseTo(0.135 + 0.005)
    expect(flat.position.y).toBeCloseTo(1.125)
    expect(flat.position.z).toBeCloseTo(0.135 + 0.01)
    expect(vest.position.y).toBeCloseTo(1.125)
    expect(vest.position.z).toBe(0)
    expect(boneOf(vest)).toBe('low_body')
  })
  it('player-space OBJs are left where they are', async () => {
    const feet = obj('boots', true, box(), 'feet')
    feet.position.set(0, 0.1, 0)
    await dress([feet], [entry('obj', 'bodywear')])
    expect(feet.position.y).toBeCloseTo(0.1)
    expect(boneOf(feet)).toBe('low_body')
  })
})

describe('dressPlayer: player and emote', () => {
  it('hides the parts worn cosmetics replace', async () => {
    const o = new Group()
    o.userData.hideParts = ['right_arm', 'head']
    const { loaded } = await dress([o], [entry('gek')])
    let body: SkinnedMesh | undefined
    loaded.object.traverse((x) => x instanceof SkinnedMesh && x.name === 'body' && (body = x))
    // 9 triangles; head, right_arm and low_right_arm hidden
    expect(body!.geometry.getIndex()!.count).toBe(6 * 3)
  })
  it('a fixed frame facing the camera, and an emote timeline that poses the player', async () => {
    const { loaded, models } = await dress([new Group()], [entry('gek')], data.emotes[0])
    const scene = loaded.object.children[0]!
    expect(scene.scale.x).toBeCloseTo(0.68)
    expect(scene.position.y).toBeCloseTo(-0.78)
    expect(scene.rotation.y).toBeCloseTo(Math.PI)
    expect(loaded.timeline!.duration).toBe(2.5)
    loaded.tick(1000)
    loaded.tick(2000)
    expect(models[0]!.tick).toHaveBeenCalledWith(2000)
    loaded.dispose()
    expect(models[0]!.dispose).toHaveBeenCalled()
  })
  it('an emote longer than its declared duration uses the action length', async () => {
    const { loaded } = await dress([], [], data.emotes[1])
    expect(loaded.timeline!.duration).toBe(1.5)
  })
})

describe('createPlayer', () => {
  const body = parseBobj(playerBobj())
  it('a skinned body with the armature under it', () => {
    const p = createPlayer(body, fakeBitmap(64, 64))
    const mesh = p.object.children[0] as SkinnedMesh
    expect(mesh).toBeInstanceOf(SkinnedMesh)
    expect(mesh.children.map((c) => c.name)).toEqual(['anchor'])
    expect(p.skel.bones.size).toBe(9)
  })
  it('hideParts drops triangles by main bone and can be undone', () => {
    const p = createPlayer(body, fakeBitmap(64, 64))
    const g = (p.object.children[0] as SkinnedMesh).geometry
    p.hideParts(['left_leg', 'body'])
    expect(g.getIndex()!.count).toBe(6 * 3)
    p.hideParts(['unknown'])
    expect(g.getIndex()).toBeNull()
    p.hideParts([])
    expect(g.getIndex()).toBeNull()
  })
  it('addMesh skins props to the same skeleton; setSkin swaps the texture', () => {
    const p = createPlayer(body, fakeBitmap(64, 64))
    const prop = p.addMesh({ name: 'prop', pos: [0, 0, 0, 1, 0, 0, 0, 1, 0], uv: [0, 0, 0, 0, 0, 0], normal: [0, 1, 0, 0, 1, 0, 0, 1, 0], weights: [[['head', 1]], [['head', 1]], [['head', 1]]] }, fakeBitmap(16, 16))
    expect(prop.skeleton).toBe(p.skel.skeleton)
    const mat = (p.object.children[0] as SkinnedMesh).material as MeshBasicMaterial
    const old = mat.map!
    const spy = vi.spyOn(old, 'dispose')
    p.setSkin(fakeBitmap(64, 64))
    expect(mat.map).not.toBe(old)
    expect(spy).toHaveBeenCalled()
    p.dispose()
  })
  it('pose applies the action to the skeleton', () => {
    const p = createPlayer(parseBobj(playerBobj()), fakeBitmap(64, 64))
    const arm = p.skel.bones.get('right_arm')!
    const rest = arm.matrix.clone()
    const action = parseBobj('# x\n' + 'an a\nao right_arm\nag rotation 0\nkf 0 0\nkf 10 1\n').actions.get('a')
    p.pose(action, 5)
    expect(arm.matrix.equals(rest)).toBe(false)
    p.pose(undefined, 5)
    expect(arm.matrix.equals(rest)).toBe(true)
  })
})
