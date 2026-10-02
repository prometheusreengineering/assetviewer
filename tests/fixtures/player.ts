// A stick-figure version of the emote body (emotes/models/entity/default.bobj): the bone names the player
// code relies on, rest positions in blocks, and one triangle weighted to each bone.
const ident = (x: number, y: number, z: number) => `1 0 0 ${x} 0 1 0 ${y} 0 0 1 ${z} 0 0 0 1`

const BONES: [string, string, [number, number, number]][] = [
  ['anchor', '', [0, 0, 0]],
  ['low_body', 'anchor', [0, 0.75, 0]],
  ['body', 'low_body', [0, 1.1, 0]],
  ['head', 'body', [0, 1.5, 0]],
  ['right_arm', 'body', [-0.3125, 1.375, 0]],
  ['low_right_arm', 'right_arm', [-0.3125, 1.0, 0]],
  ['left_arm', 'body', [0.3125, 1.375, 0]],
  ['right_leg', 'low_body', [-0.125, 0.75, 0]],
  ['left_leg', 'low_body', [0.125, 0.75, 0]],
]

export const PLAYER_BONES = BONES.map((b) => b[0])

export function playerBobj(actions = ''): string {
  const out: string[] = []
  for (const [name, parent, [x, y, z]] of BONES) out.push(`arm_bone ${name} ${parent} 0 0.1 0 ${ident(x, y, z)}`)
  out.push('o body')
  BONES.forEach(([name, , [x, y, z]]) => {
    for (const [dx, dy] of [[0, 0], [0.1, 0], [0, 0.1]]) out.push(`v ${x + dx!} ${y + dy!} ${z}`, `vw ${name} 1`)
  })
  out.push('vt 0 0', 'vn 0 0 1')
  BONES.forEach((_, i) => out.push(`f ${i * 3 + 1}/1/1 ${i * 3 + 2}/1/1 ${i * 3 + 3}/1/1`))
  return out.join('\n') + '\n' + actions
}

/** An actions file: `emote_<name>` raising the right arm over `length` ticks. */
export const actionBlock = (name: string, length: number) =>
  [`an emote_${name}`, 'ao right_arm', 'ag rotation 0', `kf 0 0 LINEAR`, `kf ${length} 3 LINEAR`, 'ao head', 'ag location 1', 'kf 0 0', `kf ${length} 0.5`, ''].join('\n')

export const PROPS_BOBJ = ['# props', 'v 0 2 0', 'vw head 1', 'v 0.2 2 0', 'vw head 1', 'v 0 2.2 0', 'vw head 1', 'o hat_prop', 'f 1 2 3', ''].join('\n')
