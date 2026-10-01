// A small Molang interpreter, enough for Lunar's cosmetic animations.
// Unknown queries/variables evaluate to 0 so unsupported inputs degrade to a static pose.

type Vars = Record<string, number>
export interface Scope {
  q: Vars
  v: Vars
  c: Vars
  t: Vars
  a: Vars
  option: Vars
  readout: Vars
}
export type Compiled = (s: Scope) => number
export type FnLib = Map<string, { params: string[]; body: Compiled }>

const DEG = Math.PI / 180
const SCOPE_ALIAS: Record<string, keyof Scope> = {
  q: 'q', query: 'q', v: 'v', variable: 'v', c: 'c', context: 'c', t: 't', temp: 't', a: 'a', option: 'option', readout: 'readout',
}

const MATH: Record<string, (...n: number[]) => number> = {
  sin: (x) => Math.sin(x! * DEG),
  cos: (x) => Math.cos(x! * DEG),
  asin: (x) => Math.asin(x!) / DEG,
  acos: (x) => Math.acos(x!) / DEG,
  atan: (x) => Math.atan(x!) / DEG,
  atan2: (y, x) => Math.atan2(y!, x!) / DEG,
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  ln: Math.log,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  mod: (a, b) => (b ? a! % b : 0),
  clamp: (x, lo, hi) => Math.min(Math.max(x!, lo!), hi!),
  lerp: (a, b, t) => a! + (b! - a!) * t!,
  lerprotate: (a, b, t) => {
    let d = (((b! - a!) % 360) + 540) % 360 - 180
    if (Number.isNaN(d)) d = 0
    return a! + d * t!
  },
  random: (a = 0, b = 1) => a + Math.random() * (b - a),
  random_integer: (a = 0, b = 1) => Math.round(a + Math.random() * (b - a)),
  hermite_blend: (t) => 3 * t! * t! - 2 * t! * t! * t!,
  sign: Math.sign,
}

// ---- tokenizer --------------------------------------------------------------

type Tok = { t: 'num' | 'id' | 'op' | 'str'; v: string }
const TOKEN = /\s*(?:(\d*\.?\d+(?:e[+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9.]*)|('[^']*')|(==|!=|<=|>=|&&|\|\||\?\?|[-+*/<>!?:(),=;{}]))/gy

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < src.length) {
    const m = TOKEN.exec(src)
    if (!m) break
    if (m[1] !== undefined) out.push({ t: 'num', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2] })
    else if (m[3] !== undefined) out.push({ t: 'str', v: m[3] })
    else out.push({ t: 'op', v: m[4]! })
  }
  return out
}

// ---- parser -----------------------------------------------------------------

class Parser {
  i = 0
  private toks: Tok[]
  private lib: FnLib
  constructor(toks: Tok[], lib: FnLib) {
    this.toks = toks
    this.lib = lib
  }

  private peek = () => this.toks[this.i]
  private eat(v?: string) {
    const t = this.toks[this.i]
    if (!t || (v !== undefined && t.v !== v)) return undefined
    this.i++
    return t
  }

  program(): Compiled {
    const stmts: Compiled[] = []
    let returned = false
    while (this.i < this.toks.length) {
      if (this.eat(';')) continue
      const t = this.peek()!
      if (t.t === 'id' && t.v === 'return') {
        this.i++
        stmts.push(this.expr())
        returned = true
        break
      }
      stmts.push(this.expr())
      if (!this.eat(';') && this.i < this.toks.length) {
        this.i++ // skip stray token to guarantee progress
      }
    }
    void returned
    return (s) => {
      let r = 0
      for (const st of stmts) r = st(s)
      return r
    }
  }

  expr(): Compiled {
    const t0 = this.toks[this.i]
    const t1 = this.toks[this.i + 1]
    if (t0?.t === 'id' && t1?.t === 'op' && t1.v === '=') {
      this.i += 2
      const [scope, key] = split(t0.v)
      const rhs = this.expr()
      return (s) => (scope ? (s[scope][key] = rhs(s)) : rhs(s))
    }
    return this.ternary()
  }

  private ternary(): Compiled {
    const cond = this.coalesce()
    if (this.eat('?')) {
      const a = this.ternary()
      this.eat(':')
      const b = this.ternary()
      return (s) => (cond(s) ? a(s) : b(s))
    }
    return cond
  }

  private coalesce(): Compiled {
    let l = this.or()
    while (this.eat('??')) {
      const r = this.or()
      const prev = l
      l = (s) => prev(s) || r(s)
    }
    return l
  }

  private or(): Compiled {
    let l = this.and()
    while (this.eat('||')) {
      const r = this.and()
      const p = l
      l = (s) => (p(s) || r(s) ? 1 : 0)
    }
    return l
  }

  private and(): Compiled {
    let l = this.eq()
    while (this.eat('&&')) {
      const r = this.eq()
      const p = l
      l = (s) => (p(s) && r(s) ? 1 : 0)
    }
    return l
  }

  private eq(): Compiled {
    let l = this.cmp()
    for (;;) {
      const op = this.eat('==') ?? this.eat('!=')
      if (!op) return l
      const r = this.cmp()
      const p = l
      l = op.v === '==' ? (s) => (p(s) === r(s) ? 1 : 0) : (s) => (p(s) !== r(s) ? 1 : 0)
    }
  }

  private cmp(): Compiled {
    let l = this.add()
    for (;;) {
      const op = this.eat('<=') ?? this.eat('>=') ?? this.eat('<') ?? this.eat('>')
      if (!op) return l
      const r = this.add()
      const p = l
      const o = op.v
      l = (s) => {
        const a = p(s)
        const b = r(s)
        return (o === '<' ? a < b : o === '>' ? a > b : o === '<=' ? a <= b : a >= b) ? 1 : 0
      }
    }
  }

  private add(): Compiled {
    let l = this.mul()
    for (;;) {
      const op = this.eat('+') ?? this.eat('-')
      if (!op) return l
      const r = this.mul()
      const p = l
      l = op.v === '+' ? (s) => p(s) + r(s) : (s) => p(s) - r(s)
    }
  }

  private mul(): Compiled {
    let l = this.unary()
    for (;;) {
      const op = this.eat('*') ?? this.eat('/')
      if (!op) return l
      const r = this.unary()
      const p = l
      l = op.v === '*' ? (s) => p(s) * r(s) : (s) => {
        const d = r(s)
        return d ? p(s) / d : 0
      }
    }
  }

  private unary(): Compiled {
    if (this.eat('-')) {
      const x = this.unary()
      return (s) => -x(s)
    }
    if (this.eat('+')) return this.unary()
    if (this.eat('!')) {
      const x = this.unary()
      return (s) => (x(s) ? 0 : 1)
    }
    return this.primary()
  }

  private primary(): Compiled {
    const t = this.toks[this.i++]
    if (!t) return () => 0
    if (t.t === 'num') {
      const n = Number(t.v)
      return () => n
    }
    if (t.t === 'str') return () => 0
    if (t.v === '(') {
      const e = this.expr()
      this.eat(')')
      return e
    }
    if (t.v === '{') {
      // block: evaluate statements, value of the last one
      const inner = this.program()
      this.eat('}')
      return inner
    }
    if (t.t === 'id') {
      if (t.v === 'true') return () => 1
      if (t.v === 'false') return () => 0
      if (t.v === 'math.pi') return () => Math.PI
      if (this.peek()?.v === '(') {
        this.i++
        const args: Compiled[] = []
        if (!this.eat(')')) {
          do args.push(this.expr())
          while (this.eat(','))
          this.eat(')')
        }
        return this.call(t.v, args)
      }
      const [scope, key] = split(t.v)
      if (!scope) return () => 0
      return (s) => s[scope][key] ?? 0
    }
    return () => 0
  }

  private call(name: string, args: Compiled[]): Compiled {
    if (name.startsWith('math.')) {
      const fn = MATH[name.slice(5)]
      if (!fn) return () => 0
      return (s) => fn(...args.map((a) => a(s)))
    }
    const lib = this.lib
    return (s) => {
      const f = lib.get(name)
      if (!f) return 0
      const a: Vars = {}
      f.params.forEach((p, i) => (a[p] = args[i]?.(s) ?? 0))
      return f.body({ ...s, a })
    }
  }
}

function split(id: string): [keyof Scope | undefined, string] {
  const dot = id.indexOf('.')
  if (dot < 0) return [undefined, id]
  const scope = SCOPE_ALIAS[id.slice(0, dot)]
  return [scope, id.slice(dot + 1)]
}

export function compile(src: string, lib: FnLib): Compiled {
  return new Parser(tokenize(src), lib).program()
}

/** Parses `lunar.fn(a.x, a.y): |-` blocks from functions.molang. */
export function parseFunctions(text: string): FnLib {
  const lib: FnLib = new Map()
  const raw: { name: string; params: string[]; body: string }[] = []
  let cur: (typeof raw)[number] | undefined
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^([A-Za-z_][\w.]*)\(([^)]*)\):\s*\|-?\s*$/)
    if (h) {
      cur = { name: h[1]!, params: h[2]!.split(',').map((p) => p.trim().replace(/^a\./, '')).filter(Boolean), body: '' }
      raw.push(cur)
    } else if (cur && /^\s/.test(line)) cur.body += line + '\n'
    else if (line.trim()) cur = undefined
  }
  // Register placeholders first so functions can call each other.
  for (const r of raw) {
    let compiled: Compiled | undefined
    lib.set(r.name, {
      params: r.params,
      body: (s) => {
        compiled ??= compile(r.body, lib)
        return compiled(s)
      },
    })
  }
  return lib
}

export function newScope(): Scope {
  return { q: {}, v: {}, c: {}, t: {}, a: {}, option: { size: 5 }, readout: {} }
}
