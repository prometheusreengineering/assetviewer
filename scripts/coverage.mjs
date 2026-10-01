// Classifies every file in the CDN indices as: listed item, item dependency, shown resource, or UNCLAIMED.
// Usage: node scripts/coverage.mjs   (exit code 1 if anything is unclaimed)
import { B, loadFiles, P, text } from './_load.mjs'

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

const byReason = {}
for (const w of claim.values()) byReason[w.split(':')[0] + ':' + (w.split(':')[1] ?? '')] = (byReason[w.split(':')[0] + ':' + (w.split(':')[1] ?? '')] ?? 0) + 1
console.log('total files', files.size, 'claimed', claim.size)
console.log(byReason)
const left = [...files.keys()].filter((p) => !claim.has(p))
console.log('UNCLAIMED', left.length)
const groups = {}
for (const p of left) { const g = rel(p).split('/').slice(0, 5).join('/') + '/*.' + p.split('.').slice(-1)[0]; groups[g] = (groups[g] ?? 0) + 1 }
console.log(Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 40))
const nonHat = left.filter((p) => !p.includes('/hats/'))
console.log('non-hat leftovers', nonHat.length, nonHat.slice(0, 12).map(rel))
const hat = left.filter((p) => p.includes('/hats/') && !p.endsWith('.mcmeta'))
console.log('hat leftovers (non-mcmeta)', hat.length, hat.map((p) => rel(p).replace('cosmetics/models/hats/', '')))
process.exit(left.length ? 1 : 0)
