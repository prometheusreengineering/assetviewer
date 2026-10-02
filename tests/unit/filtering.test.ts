import { describe, expect, it } from 'vitest'
import { applyView, decodeRules, decodeSorts, encodeRules, encodeSorts, matches, OPS, valueOf, type Rule } from '../../src/filtering'
import { DEFS, item } from '../helpers/items'

const rule = (field: string, op: Rule['op'], value: unknown, value2?: unknown): Rule => ({ id: 1, field, op, value, ...(value2 === undefined ? {} : { value2 }) })
const DAY = 86_400_000
const D = (s: string) => Date.parse(s)

describe('OPS', () => {
  it('lists operators for every field type', () => {
    expect(Object.keys(OPS).sort()).toEqual(['bool', 'date', 'multi', 'number', 'text'])
    expect(OPS.bool.map((o) => o.op)).toEqual(['is'])
    expect(OPS.multi.map((o) => o.op)).toEqual(['any', 'all', 'none'])
  })
})

describe('valueOf', () => {
  it('reads name from the item and other keys from fields', () => {
    const it1 = item('Crown', { name: 'ignored', size: 3 })
    expect(valueOf(it1, 'name')).toBe('Crown')
    expect(valueOf(it1, 'size')).toBe(3)
    expect(valueOf(it1, 'missing')).toBeUndefined()
  })
})

describe('matches: text', () => {
  const it1 = item('Golden Crown', { path: 'cosmetics/hats/crown.webp' })
  it.each([
    ['contains', 'gold', true],
    ['contains', 'GOLD', true],
    ['contains', 'silver', false],
    ['notcontains', 'silver', true],
    ['notcontains', 'crown', false],
    ['equals', 'golden crown', true],
    ['equals', 'golden', false],
    ['starts', 'gol', true],
    ['starts', 'crown', false],
  ] as const)('%s %s -> %s', (op, value, want) => {
    expect(matches(it1, rule('name', op, value), 'text')).toBe(want)
  })
  it('an empty query matches everything', () => {
    expect(matches(it1, rule('name', 'equals', ''), 'text')).toBe(true)
    expect(matches(it1, rule('name', 'contains', undefined), 'text')).toBe(true)
  })
  it('a missing value is the empty string', () => {
    expect(matches(item('x'), rule('path', 'contains', 'a'), 'text')).toBe(false)
    expect(matches(item('x'), rule('path', 'notcontains', 'a'), 'text')).toBe(true)
  })
})

describe('matches: number', () => {
  const it1 = item('x', { size: 10 })
  it.each([
    ['eq', 10, true],
    ['eq', 11, false],
    ['ne', 11, true],
    ['ne', 10, false],
    ['gt', 9, true],
    ['gt', 10, false],
    ['ge', 10, true],
    ['lt', 11, true],
    ['lt', 10, false],
    ['le', 10, true],
  ] as const)('%s %d -> %s', (op, value, want) => {
    expect(matches(it1, rule('size', op, value), 'number')).toBe(want)
  })
  it('between is inclusive and order independent', () => {
    expect(matches(it1, rule('size', 'between', 5, 10), 'number')).toBe(true)
    expect(matches(it1, rule('size', 'between', 10, 5), 'number')).toBe(true)
    expect(matches(it1, rule('size', 'between', 11, 20), 'number')).toBe(false)
    // no upper bound: just the lower one
    expect(matches(it1, rule('size', 'between', 10), 'number')).toBe(true)
  })
  it('an unknown value never matches; a missing bound matches all known values', () => {
    expect(matches(item('x'), rule('size', 'ne', 1), 'number')).toBe(false)
    expect(matches(item('x', { size: '10' }), rule('size', 'eq', 10), 'number')).toBe(false)
    expect(matches(it1, rule('size', 'eq', null), 'number')).toBe(true)
    expect(matches(it1, rule('size', 'eq', undefined), 'number')).toBe(true)
  })
})

describe('matches: date (whole days)', () => {
  const noon = item('x', { released: D('2024-03-10T12:00:00Z') })
  const day = D('2024-03-10T00:00:00Z')
  it('on = same day', () => {
    expect(matches(noon, rule('released', 'eq', day), 'date')).toBe(true)
    expect(matches(noon, rule('released', 'eq', day + DAY), 'date')).toBe(false)
    expect(matches(noon, rule('released', 'eq', day - DAY), 'date')).toBe(false)
  })
  it('after = from the next day on', () => {
    expect(matches(noon, rule('released', 'gt', day), 'date')).toBe(false)
    expect(matches(noon, rule('released', 'gt', day - DAY), 'date')).toBe(true)
  })
  it('before = earlier than the day', () => {
    expect(matches(noon, rule('released', 'lt', day), 'date')).toBe(false)
    expect(matches(noon, rule('released', 'lt', day + DAY), 'date')).toBe(true)
  })
  it('between includes the whole last day', () => {
    expect(matches(noon, rule('released', 'between', day - DAY, day), 'date')).toBe(true)
    expect(matches(noon, rule('released', 'between', day + DAY, day + 2 * DAY), 'date')).toBe(false)
  })
})

describe('matches: multi', () => {
  const it1 = item('x', { themes: ['A', 'B'] })
  it('any/all/none', () => {
    expect(matches(it1, rule('themes', 'any', ['B', 'C']), 'multi')).toBe(true)
    expect(matches(it1, rule('themes', 'any', ['C']), 'multi')).toBe(false)
    expect(matches(it1, rule('themes', 'all', ['A', 'B']), 'multi')).toBe(true)
    expect(matches(it1, rule('themes', 'all', ['A', 'C']), 'multi')).toBe(false)
    expect(matches(it1, rule('themes', 'none', ['C']), 'multi')).toBe(true)
    expect(matches(it1, rule('themes', 'none', ['A']), 'multi')).toBe(false)
  })
  it('an empty selection matches everything', () => {
    expect(matches(it1, rule('themes', 'all', []), 'multi')).toBe(true)
    expect(matches(it1, rule('themes', 'any', undefined), 'multi')).toBe(true)
  })
  it('a scalar value counts as a one-element list, empty/missing as none', () => {
    expect(matches(item('x', { themes: 'A' }), rule('themes', 'any', ['A']), 'multi')).toBe(true)
    expect(matches(item('x', { themes: '' }), rule('themes', 'none', ['A']), 'multi')).toBe(true)
    expect(matches(item('x'), rule('themes', 'any', ['A']), 'multi')).toBe(false)
  })
})

describe('matches: bool', () => {
  it('only a literal true is true', () => {
    expect(matches(item('x', { animated: true }), rule('animated', 'is', true), 'bool')).toBe(true)
    expect(matches(item('x', { animated: false }), rule('animated', 'is', true), 'bool')).toBe(false)
    expect(matches(item('x'), rule('animated', 'is', false), 'bool')).toBe(true)
    expect(matches(item('x', { animated: 'yes' }), rule('animated', 'is', false), 'bool')).toBe(true)
  })
})

describe('applyView', () => {
  const a = item('Alpha', { size: 3, themes: ['A'], animated: true })
  const b = item('beta', { size: 1, themes: ['B'] })
  const c = item('Gamma', { themes: ['A', 'B'], animated: false })
  const d = item('alpha 2', { size: 3 })
  const all = [a, b, c, d]

  it('search matches names case-insensitively and trims', () => {
    expect(applyView(all, '  ALPHA ', [], [], DEFS)).toEqual([a, d])
    expect(applyView(all, '', [], [], DEFS)).toEqual(all)
  })
  it('rules are ANDed and rules on unknown fields are ignored', () => {
    const rules = [rule('themes', 'any', ['A']), { ...rule('animated', 'is', true), id: 2 }, { ...rule('nope', 'eq', 1), id: 3 }]
    expect(applyView(all, '', rules, [], DEFS)).toEqual([a])
  })
  it('sorts numbers with missing values last in both directions', () => {
    expect(applyView(all, '', [], [{ field: 'size', dir: 'asc' }], DEFS)).toEqual([b, a, d, c])
    expect(applyView(all, '', [], [{ field: 'size', dir: 'desc' }], DEFS)).toEqual([a, d, b, c])
  })
  it('is stable and supports secondary keys', () => {
    expect(applyView(all, '', [], [{ field: 'size', dir: 'desc' }, { field: 'name', dir: 'desc' }], DEFS)).toEqual([d, a, b, c])
  })
  it('compares strings with numeric collation, ignoring case', () => {
    const xs = [item('Item 10'), item('item 9'), item('Item 1')]
    expect(applyView(xs, '', [], [{ field: 'name', dir: 'asc' }], DEFS).map((x) => x.name)).toEqual(['Item 1', 'item 9', 'Item 10'])
  })
  it('sorts bools false-first (missing last) and arrays by their joined text', () => {
    expect(applyView([a, b, c], '', [], [{ field: 'animated', dir: 'asc' }], DEFS)).toEqual([c, a, b])
    const xs = [item('x', { themes: ['B'] }), item('y', { themes: [] }), item('z', { themes: ['A', 'C'] })]
    expect(applyView(xs, '', [], [{ field: 'themes', dir: 'asc' }], DEFS).map((x) => x.name)).toEqual(['z', 'x', 'y'])
  })
  it('ignores sort keys for unknown fields and does not mutate the input', () => {
    const copy = [...all]
    expect(applyView(all, '', [], [{ field: 'nope', dir: 'asc' }], DEFS)).toEqual(all)
    applyView(all, '', [], [{ field: 'size', dir: 'asc' }], DEFS)
    expect(all).toEqual(copy)
  })
})

describe('URL encoding', () => {
  it('round-trips rules including value2 and unicode', () => {
    const rules: Rule[] = [
      { id: 7, field: 'name', op: 'contains', value: 'Ünïcødé ★' },
      { id: 8, field: 'size', op: 'between', value: 1, value2: 9 },
      { id: 9, field: 'themes', op: 'any', value: ['A', 'B'] },
    ]
    const s = encodeRules(rules)
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeRules(s)).toEqual([
      { id: 1, field: 'name', op: 'contains', value: 'Ünïcødé ★' },
      { id: 2, field: 'size', op: 'between', value: 1, value2: 9 },
      { id: 3, field: 'themes', op: 'any', value: ['A', 'B'] },
    ])
  })
  it('encodes no rules as the empty string', () => {
    expect(encodeRules([])).toBe('')
  })
  it('decodes garbage to no rules and drops malformed tuples', () => {
    expect(decodeRules('!!!')).toEqual([])
    expect(decodeRules(btoa('{"a":1}'))).toEqual([])
    expect(decodeRules(btoa('[[1,"eq",2],["size","eq",3],"x"]'))).toEqual([{ id: 1, field: 'size', op: 'eq', value: 3 }])
  })
  it('round-trips sorts and drops bad parts', () => {
    const sorts = [{ field: 'size', dir: 'desc' as const }, { field: 'name', dir: 'asc' as const }]
    expect(encodeSorts(sorts)).toBe('size:desc,name:asc')
    expect(decodeSorts('size:desc,name:asc')).toEqual(sorts)
    expect(decodeSorts('size:up,:asc,name,id:desc')).toEqual([{ field: 'id', dir: 'desc' }])
    expect(decodeSorts('')).toEqual([])
  })
})
