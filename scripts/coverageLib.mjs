// The classification behind scripts/coverage.mjs, shared with the live tests (tests/unit/live).
import { B, loadFiles, P, text } from './_load.mjs'

/** Classifies every file in the CDN indices: listed item, item dependency, shown resource, or unclaimed. */
export async function classify() {
  const files = await loadFiles()
  const rel = (p) => p.slice(P.length)
  const claim = new Map() // path -> reason
  const mark = (p, why) => files.has(p) && !claim.has(p) && claim.set(p, why)
  const markRel = (r, why) => mark(P + r.replace(/^lunar:/, ''), why)

  // 1. catalogs
  const json = JSON.parse(await text(files, 'cosmetics.json'))
  const csv = (await text(files, 'cosmetics/index')).split('\n').map((l) => l.trim().split(',')).filter((c) => c.length >= 12)
  const objFolders = new Map()
  for (const p of files.keys()) if (p.endsWith('.obj') && p.includes('/cosmetics/models/')) objFolders.set(p.split('/').slice(-2, -1)[0], p)
  const resources = [...json.map((c) => [c.resource.replace('lunar:', ''), c.indexType]), ...csv.map((c) => [c[8], c[7] === 'NONE' ? '' : c[7]])]
  for (const [r, key] of resources) {
    markRel(r, 'item')
    markRel(r + '.mcmeta', 'dep:mcmeta')
    if (key && objFolders.has(key)) mark(objFolders.get(key), 'dep:obj')
    const th = r.replace('cosmetics/wings/', 'cosmetics/wings/thumbnail/')
    if (th !== r) markRel(th, 'dep:thumbnail')
  }
  // 1b. textures for shared OBJ models that no catalog lists, and wing thumbnails
  for (const p of files.keys()) {
    const r = rel(p)
    if (claim.has(p)) continue
    const o = r.match(/^cosmetics\/models\/(hats|bodywear)\/([^/]+)\/(?:textures\/)?[^/]+\.webp$/)
    if (o || /^cosmetics\/wings\/thumbnail\/[^/]+\.webp$/.test(r)) { mark(p, 'item:unlisted'); markRel(r + '.mcmeta', 'dep:mcmeta') }
  }
  // 2. unlisted cosmetics (shown as "Unlisted" items)
  for (const p of files.keys()) {
    const r = rel(p)
    if (claim.has(p)) continue
    if (/^cosmetics\/models\/gek\/[^/]+\/.*\.gek\.json$/.test(r) || /^cosmetics\/cloaks\/[^/]+\.webp$/.test(r) || /^cosmetics\/wings\/[^/]+\.webp$/.test(r)) {
      mark(p, 'item:unlisted'); markRel(r + '.mcmeta', 'dep:mcmeta')
      markRel(r.replace('cosmetics/wings/', 'cosmetics/wings/thumbnail/'), 'dep:thumbnail')
    }
  }
  // 3. dependencies of every gek
  for (const p of [...files.keys()].filter((k) => k.endsWith('.gek.json'))) {
    const g = JSON.parse(await (await fetch(`${B}/file/${files.get(p)}`)).text())
    // Any "lunar:..." reference inside the gek (model, texture, animation, extra textures, ...)
    const walk = (v, key) => {
      if (typeof v === 'string' && v.startsWith('lunar:')) { markRel(v, 'dep:gek-' + key); markRel(v + '.mcmeta', 'dep:mcmeta') }
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k)
    }
    walk(g, 'ref')
  }
  // files living next to a gek (transformation json, slim geo, particles, ...) belong to it
  const dirs = new Set([...files.keys()].filter((k) => k.endsWith('.gek.json')).map((k) => k.replace(/\/(textures\/)?[^/]+$/, '')))
  for (const p of files.keys()) if (!claim.has(p) && /cosmetics\/models\/gek\//.test(p) && dirs.has(p.replace(/\/(textures\/)?[^/]+$/, ''))) mark(p, 'dep:gek-sibling')
  markRel('cosmetics/models/gek/wings/simple_2d_wings.geo.json', 'dep:wing2d')
  markRel('cosmetics/models/gek/wings/simple_2d_wings.anim.json', 'dep:wing2d')
  // 4. resources outside cosmetics models/cloaks/wings are all listed as resource items (mcmeta as dependency)
  for (const p of files.keys()) {
    const r = rel(p)
    if (claim.has(p)) continue
    const isExtra = /^cosmetics\/cloaks\/[^/]+\//.test(r) || /\.(obj|fsh)$/.test(r)
    if (/^cosmetics\/(models|cloaks|wings)\//.test(r) && !isExtra && !r.endsWith('.mcmeta')) continue
    mark(p, r.endsWith('.mcmeta') ? 'dep:mcmeta' : 'resource')
  }
  const left = [...files.keys()].filter((p) => !claim.has(p))
  return { files, claim, left, rel }
}
