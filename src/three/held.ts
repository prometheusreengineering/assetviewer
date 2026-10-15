// Held items on the player, from Minecraft's own transforms instead of a guessed pose.
//
// Spaces: Java model space is in blocks, y down, the player facing -z, the neck at the origin and the right
// arm at -x. Our player space is in blocks, y up, facing +z, feet at 0 (right arm also at -x). A raw rig's
// object-local space is its Bedrock file space (px) scaled by (1, 1, -1) / 16 (see the prep hooks).
import { Euler, Matrix4 } from 'three'

const DEG = Math.PI / 180
const T = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z)
const S = (x: number, y: number, z: number) => new Matrix4().makeScale(x, y, z)

/** Java model space -> our player space. */
const JAVA_TO_OURS = T(0, 1.5, 0).multiply(S(1, -1, -1))
/** A raw rig's object-local coordinates -> its Bedrock file px (inverse of the 1/16, z-mirrored root). */
const LOCAL_TO_FILE = S(16, 16, -16)
/** Java arm pivots (ModelBiped rotation points), in blocks. */
const ARM_PIVOT = { right: [-5 / 16, 2 / 16, 0], left: [5 / 16, 2 / 16, 0] } as const

export interface Display {
  rotation?: number[]
  translation?: number[]
  scale?: number[]
}

/**
 * Vanilla's third-person item-in-hand chain (ItemInHandLayer + ItemTransform + the builtin item renderer):
 * the hand point on the arm, the item display transform (mirrored for the left hand), the -0.5 block centring
 * and the builtin model flip (1, -1, -1). `fileToModel` maps the rig's Bedrock file px to the item model's
 * Java px. Returns the object matrix in our player space (rest pose).
 */
export function vanillaHeld(display: Display, left: boolean, fileToModel: Matrix4): Matrix4 {
  const side = left ? -1 : 1
  const [tx, ty, tz] = (display.translation ?? [0, 0, 0]).map((v) => v / 16) as [number, number, number]
  const [rx, ry, rz] = display.rotation ?? [0, 0, 0]
  const [sx, sy, sz] = display.scale ?? [1, 1, 1]
  const chain = T(...ARM_PIVOT[left ? 'left' : 'right'])
    .multiply(new Matrix4().makeRotationX(-90 * DEG))
    .multiply(new Matrix4().makeRotationY(180 * DEG))
    .multiply(T(side / 16, 0.125, -0.625))
    .multiply(T(side * tx, ty, tz))
    .multiply(new Matrix4().makeRotationFromEuler(new Euler(rx! * DEG, side * ry! * DEG, side * rz! * DEG, 'XYZ')))
    .multiply(S(sx!, sy!, sz!))
    .multiply(T(-0.5, -0.5, -0.5))
    .multiply(S(1, -1, -1))
    .multiply(S(1 / 16, 1 / 16, 1 / 16))
    .multiply(fileToModel)
  return JAVA_TO_OURS.clone().multiply(chain).multiply(LOCAL_TO_FILE)
}

/** Vanilla's shield model (plate -6,-11,-2 12x22x1; handle -1,-3,-1 2x6x6) as Dawn draws it: y up, 10 px higher. */
export const SHIELD_FILE_TO_MODEL = T(0, 10, 0).multiply(S(1, -1, 1))

/** Vanilla's shield.json third-person display (the left hand mirrors it). */
export const SHIELD_DISPLAY: Record<'right' | 'left', Display> = {
  right: { rotation: [0, 90, 0], translation: [10, 6, -4] },
  left: { rotation: [0, 90, 0], translation: [10, 6, 12] },
}

/**
 * A Lunar hand gek with an item `display` (held_transformation.json): its thirdperson translation is taken in
 * the arm's own space from the shoulder pivot, with the Bedrock model turned y-down like the arm. That puts
 * the wand's handle in the fist with the tip forward; vanilla's item chain would float it a block ahead.
 */
export function armHeld(display: Display, left: boolean): Matrix4 {
  const [tx, ty, tz] = (display.translation ?? [0, 0, 0]).map((v) => v / 16) as [number, number, number]
  const chain = T(...ARM_PIVOT[left ? 'left' : 'right'])
    .multiply(T(tx, ty, tz))
    .multiply(S(1 / 16, -1 / 16, 1 / 16))
  return JAVA_TO_OURS.clone().multiply(chain).multiply(LOCAL_TO_FILE)
}
