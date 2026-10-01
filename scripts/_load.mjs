export const B = 'https://textures.lunarclientcdn.com'
export const P = 'assets/lunar/'
export const INDEXES = ['8a23771c424b9d0ada1e6ba339d70dec72e75fd7', 'fd50b83af05c7cb6fc8cc886fed06f5e1ee16b1f']
export async function loadFiles() {
  const files = new Map()
  for (const id of INDEXES) {
    const t = await (await fetch(`${B}/index/${id}`)).text()
    for (const l of t.split('\n')) { const [p, h] = l.split(' '); if (p && h) files.set(p, h) }
  }
  return files
}
export const text = async (files, p) => (await fetch(`${B}/file/${files.get(P + p)}`)).text()
