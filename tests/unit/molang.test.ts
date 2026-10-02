import { afterEach, describe, expect, it, vi } from 'vitest'
import { compile, newScope, parseFunctions, type FnLib } from '../../src/three/animation/molang'

const NO_LIB: FnLib = new Map()
const run = (src: string, setup?: (s: ReturnType<typeof newScope>) => void, lib = NO_LIB) => {
  const s = newScope()
  setup?.(s)
  return compile(src, lib)(s)
}

afterEach(() => vi.restoreAllMocks())

describe('numbers and arithmetic', () => {
  it.each([
    ['1', 1],
    ['.5', 0.5],
    ['1.25', 1.25],
    ['2e3', 2000],
    ['1.5e-1', 0.15],
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 - 4 - 3', 3],
    ['8 / 4 / 2', 1],
    ['-3 + 5', 2],
    ['--2', 2],
    ['+4', 4],
    ['2 * -3', -6],
    ['5 / 0', 0],
    ['', 0],
  ])('%s = %d', (src, want) => expect(run(src)).toBeCloseTo(want))
})

describe('logic and comparison', () => {
  it.each([
    ['1 < 2', 1],
    ['2 < 1', 0],
    ['2 <= 2', 1],
    ['3 >= 4', 0],
    ['3 > 2', 1],
    ['1 == 1', 1],
    ['1 != 1', 0],
    ['1 == 1 == 1', 1],
    ['!0', 1],
    ['!5', 0],
    ['1 && 0', 0],
    ['1 && 2', 1],
    ['0 || 0', 0],
    ['0 || 3', 1],
    ['1 || 0 && 0', 1],
    ['true', 1],
    ['false', 0],
    ['1 < 2 ? 10 : 20', 10],
    ['0 ? 10 : 1 ? 30 : 40', 30],
    ['0 ?? 7', 7],
    ['3 ?? 7', 3],
  ])('%s = %d', (src, want) => expect(run(src)).toBe(want))
})

describe('math library (degrees)', () => {
  it.each([
    ['math.sin(90)', 1],
    ['math.cos(180)', -1],
    ['math.asin(1)', 90],
    ['math.acos(0)', 90],
    ['math.atan(1)', 45],
    ['math.atan2(1, 1)', 45],
    ['math.abs(-3)', 3],
    ['math.sqrt(16)', 4],
    ['math.exp(0)', 1],
    ['math.ln(1)', 0],
    ['math.floor(1.7)', 1],
    ['math.ceil(1.2)', 2],
    ['math.round(1.5)', 2],
    ['math.trunc(-1.7)', -1],
    ['math.pow(2, 10)', 1024],
    ['math.min(3, 1, 2)', 1],
    ['math.max(3, 1, 2)', 3],
    ['math.mod(7, 3)', 1],
    ['math.mod(7, 0)', 0],
    ['math.clamp(5, 0, 2)', 2],
    ['math.clamp(-5, 0, 2)', 0],
    ['math.lerp(0, 10, 0.25)', 2.5],
    ['math.lerprotate(350, 10, 0.5)', 360],
    ['math.lerprotate(10, 350, 0.5)', 0],
    ['math.hermite_blend(0.5)', 0.5],
    ['math.sign(-4)', -1],
    ['math.pi', Math.PI],
    ['math.nope(1)', 0],
  ])('%s = %d', (src, want) => expect(run(src)).toBeCloseTo(want, 6))

  it('random and random_integer use their range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(run('math.random(2, 4)')).toBe(3)
    expect(run('math.random()')).toBe(0.5)
    expect(run('math.random_integer(0, 3)')).toBe(2)
  })
})

describe('variables and scopes', () => {
  it('reads queries, variables and their long aliases; unknown ones are 0', () => {
    const set = (s: ReturnType<typeof newScope>) => {
      s.q.anim_time = 2
      s.v.speed = 3
    }
    expect(run('q.anim_time * query.anim_time', set)).toBe(4)
    expect(run('v.speed + variable.speed', set)).toBe(6)
    expect(run('q.nothing + v.nope + c.x + t.y', set)).toBe(0)
    // no recognised scope
    expect(run('foo.bar + plain', set)).toBe(0)
  })

  it('assigns to v/t/c and returns the assigned value', () => {
    const s = newScope()
    expect(compile('v.x = 2; t.y = v.x * 3; context.z = 1; v.x + t.y', NO_LIB)(s)).toBe(8)
    expect(s.v.x).toBe(2)
    expect(s.t.y).toBe(6)
    expect(s.c.z).toBe(1)
  })

  it('an assignment without a scope just evaluates', () => {
    expect(run('x = 4')).toBe(4)
  })

  it('blocks evaluate to their last statement and return stops the program', () => {
    expect(run('{ v.a = 1; v.a + 1 }')).toBe(2)
    expect(run('v.a = 5; return v.a * 2; v.a = 100')).toBe(10)
  })

  it('strings evaluate to 0 and stray tokens are skipped', () => {
    expect(run("'hello'")).toBe(0)
    expect(run('1 2')).toBe(1)
    expect(run('1 2; 3')).toBe(3)
    expect(run(')')).toBe(0)
  })

  it('newScope has the documented defaults', () => {
    expect(newScope()).toEqual({ q: {}, v: {}, c: {}, t: {}, a: {}, option: { size: 5 }, readout: {} })
    expect(run('option.size')).toBe(5)
  })
})

describe('parseFunctions', () => {
  const SRC = [
    'lunar.double(a.x): |-',
    '  return a.x * 2;',
    'lunar.add(a.x, a.y): |-',
    '  return a.x + a.y;',
    '',
    'lunar.quad(a.x): |',
    '  return lunar.double(lunar.double(a.x));',
    'not a header',
    'lunar.uses_q(): |-',
    '  return q.anim_time + 1;',
    'lunar.later(a.x): |-',
    '  return lunar.defined_after(a.x);',
    'lunar.defined_after(a.x): |-',
    '  return a.x - 1;',
  ].join('\r\n')

  it('parses headers, parameters and bodies (CRLF)', () => {
    const lib = parseFunctions(SRC)
    expect([...lib.keys()]).toEqual(['lunar.double', 'lunar.add', 'lunar.quad', 'lunar.uses_q', 'lunar.later', 'lunar.defined_after'])
    expect(lib.get('lunar.add')!.params).toEqual(['x', 'y'])
    expect(lib.get('lunar.uses_q')!.params).toEqual([])
  })

  it('functions can be called from expressions, call each other and see the caller scope', () => {
    const lib = parseFunctions(SRC)
    expect(run('lunar.double(4)', undefined, lib)).toBe(8)
    expect(run('lunar.add(1, 2) + lunar.add(3)', undefined, lib)).toBe(6)
    expect(run('lunar.quad(1)', undefined, lib)).toBe(4)
    expect(run('lunar.later(5)', undefined, lib)).toBe(4)
    expect(run('lunar.uses_q()', (s) => (s.q.anim_time = 2), lib)).toBe(3)
    expect(run('lunar.unknown(1)', undefined, lib)).toBe(0)
  })

  it('does not leak arguments into the caller', () => {
    const lib = parseFunctions(SRC)
    const s = newScope()
    compile('lunar.double(3)', lib)(s)
    expect(s.a).toEqual({})
  })
})
