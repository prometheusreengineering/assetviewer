// Emote sounds: Bedrock `sound_effects` timelines name entries of sound_definitions.json, each a list of .ogg
// files (one is picked at random). Played with Web Audio while enabled; never in thumbnails.

export interface SoundCue {
  anim: string
  /** Seconds on the emote's timeline. */
  time: number
  effect: string
}

export interface SoundDefinitions {
  sound_definitions?: Record<string, { sounds?: (string | { name?: string; volume?: number })[] }>
}

interface CueFile {
  animations?: Record<string, object>
}

/** Sound cues of these animations (in their own seconds). */
export function soundCues(file: CueFile, names: string[]): SoundCue[] {
  const out: SoundCue[] = []
  for (const [anim, a] of Object.entries(file.animations ?? {})) {
    if (names.length && !names.includes(anim)) continue
    for (const [t, v] of Object.entries((a as { sound_effects?: Record<string, unknown> }).sound_effects ?? {})) {
      const time = Number(t)
      if (Number.isNaN(time)) continue
      for (const e of Array.isArray(v) ? v : [v]) {
        const effect = (e as { effect?: unknown })?.effect
        if (typeof effect === 'string') out.push({ anim, time, effect })
      }
    }
  }
  return out
}

let ctx: AudioContext | undefined
const audio = () => (ctx ??= new AudioContext())

export class SoundPlayer {
  private on = false
  private last = -1
  private playing = new Set<AudioBufferSourceNode>()
  private buffers = new Map<string, Promise<AudioBuffer | undefined>>()
  private cues: SoundCue[]
  private defs: SoundDefinitions
  private read: (path: string) => Promise<ArrayBuffer | undefined>

  constructor(cues: SoundCue[], defs: SoundDefinitions, read: (path: string) => Promise<ArrayBuffer | undefined>) {
    this.cues = cues
    this.defs = defs
    this.read = read
  }

  get count() {
    return this.cues.length
  }

  setEnabled(on: boolean) {
    this.on = on
    if (on) void audio().resume?.()
    else this.stop()
  }

  /**
   * Called with the timeline position (s): plays the cues passed since the last call. A wrap to the start
   * of a looping timeline of `length` s still plays the cues on both sides; a seek stops sounds and plays none.
   */
  at(t: number, length = Infinity) {
    const prev = this.last
    this.last = t
    let hit: (time: number) => boolean
    if (prev < 0) hit = (c) => c <= t
    else if (t >= prev && t - prev <= 0.5) hit = (c) => c > prev && c <= t
    else if (t < prev && length - prev + t <= 0.5) hit = (c) => c > prev || c <= t
    else {
      this.stop()
      return
    }
    if (!this.on) return
    for (const c of this.cues) if (hit(c.time)) void this.play(c.effect)
  }

  private async play(effect: string) {
    const list = this.defs.sound_definitions?.[effect]?.sounds ?? []
    if (!list.length) return
    const pick = list[Math.floor(Math.random() * list.length)]!
    const name = typeof pick === 'string' ? pick : pick.name
    if (!name) return
    let p = this.buffers.get(name)
    if (!p) {
      p = this.read(name).then((b) => (b ? audio().decodeAudioData(b.slice(0)) : undefined)).catch(() => undefined)
      this.buffers.set(name, p)
    }
    const buf = await p
    if (!buf || !this.on) return
    const src = audio().createBufferSource()
    src.buffer = buf
    const gain = audio().createGain()
    gain.gain.value = typeof pick === 'object' && typeof pick.volume === 'number' ? pick.volume : 1
    src.connect(gain).connect(audio().destination)
    src.onended = () => this.playing.delete(src)
    this.playing.add(src)
    src.start()
  }

  stop() {
    for (const s of this.playing) {
      try {
        s.stop()
      } catch {}
    }
    this.playing.clear()
  }

  dispose() {
    this.stop()
  }
}
