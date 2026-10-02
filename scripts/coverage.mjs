// Classifies every file in the CDN indices as: listed item, item dependency, shown resource, or UNCLAIMED.
// Usage: node scripts/coverage.mjs   (exit code 1 if anything is unclaimed)
import { classify } from './coverageLib.mjs'

const { files, claim, left, rel } = await classify()
const byReason = {}
for (const w of claim.values()) byReason[w.split(':')[0] + ':' + (w.split(':')[1] ?? '')] = (byReason[w.split(':')[0] + ':' + (w.split(':')[1] ?? '')] ?? 0) + 1
console.log('total files', files.size, 'claimed', claim.size)
console.log(byReason)
console.log('UNCLAIMED', left.length)
const groups = {}
for (const p of left) { const g = rel(p).split('/').slice(0, 5).join('/') + '/*.' + p.split('.').slice(-1)[0]; groups[g] = (groups[g] ?? 0) + 1 }
console.log(Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 40))
const nonHat = left.filter((p) => !p.includes('/hats/'))
console.log('non-hat leftovers', nonHat.length, nonHat.slice(0, 12).map(rel))
const hat = left.filter((p) => p.includes('/hats/') && !p.endsWith('.mcmeta'))
console.log('hat leftovers (non-mcmeta)', hat.length, hat.map((p) => rel(p).replace('cosmetics/models/hats/', '')))
process.exit(left.length ? 1 : 0)
