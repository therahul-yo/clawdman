import { SPRITES } from './sprites'

// A port of the Claude desktop app's idle Clawd: the same sprites, the same
// animation table (frame ranges and rates) and the same "title" behaviour.
// Everything here is in sprite pixels (the 24 px wide Walking sprite is the
// unit); render.ts maps them onto terminal cells.

export type Move = {
  sp: string
  start: number
  end?: number
  loop?: readonly [number, number]
  fps: number
  oneShot?: boolean
}

// Copied from the app's `Xe` table.
export const MOVES: Record<string, Move> = {
  walk: { sp: 'Walking', start: 4, loop: [5, 9], fps: 19 },
  wave: { sp: 'Waving', start: 3, end: 16, fps: 12, oneShot: true },
  desktop: { sp: 'Desktop', start: 2, loop: [15, 75], fps: 12 },
  desktopOut: { sp: 'Desktop', start: 76, end: 87, fps: 16, oneShot: true },
  laptop: { sp: 'Laptop', start: 2, loop: [17, 33], fps: 12 },
  laptopOut: { sp: 'Laptop', start: 34, end: 42, fps: 16, oneShot: true },
  lookAround: { sp: 'LookingAround', start: 4, end: 30, fps: 12, oneShot: true },
  sway: { sp: 'Swaying', start: 4, end: 48, fps: 12, oneShot: true },
  point: { sp: 'Pointing', start: 3, end: 42, fps: 12, oneShot: true },
  turning: { sp: 'Turning', start: 2, end: 26, fps: 12, oneShot: true },
  danceOnce: { sp: 'DancingHappy', start: 4, end: 38, fps: 12, oneShot: true },
  meditate: { sp: 'Meditating', start: 2, end: 59, fps: 12, oneShot: true },
  excitedPick: { sp: 'Excited', start: 2, end: 21, fps: 14, oneShot: true },
  facepalm: { sp: 'Facepalm', start: 2, end: 33, fps: 12, oneShot: true },
  thinking: { sp: 'Thinking', start: 2, end: 36, fps: 12, oneShot: true },
  lightbulb: { sp: 'Lightbulb', start: 2, end: 48, fps: 12, oneShot: true },
  disappointed: { sp: 'Disappointed', start: 2, end: 42, fps: 12, oneShot: true },
  sparkCine: { sp: 'Spark', start: 2, end: 68, fps: 13, oneShot: true },
  confettiCine: { sp: 'Confetti', start: 2, end: 33, fps: 12, oneShot: true },
  breakOnce: { sp: 'BreakDancing', start: 2, end: 27, fps: 12, oneShot: true },
  startHop: { sp: 'JumpingHappy', start: 3, end: 20, fps: 14, oneShot: true },
  hula: { sp: 'Hula', start: 6, end: 53, fps: 12, oneShot: true },
  jump: { sp: 'Jumping', start: 0, end: 20, fps: 14, oneShot: true },
  dizzy: { sp: 'Dizzy', start: 0, end: 40, fps: 12, oneShot: true },
  // gaits, played while walking a few steps
  dash: { sp: 'Running', start: 5, loop: [5, 16], fps: 16 },
  scuttle: { sp: 'CrabWalking', start: 4, loop: [4, 11], fps: 19 },
}

// The app's title-mode pick list, and its timings.
const TITLE_FLOURISHES = ['sway', 'turning', 'danceOnce', 'breakOnce', 'meditate', 'wave']
const CHEERS = ['excitedPick', 'danceOnce']
// what Clawd does when it is clicked
const REACTIONS = [
  'startHop',
  'jump',
  'excitedPick',
  'danceOnce',
  'breakOnce',
  'hula',
  'wave',
  'sparkCine',
  'confettiCine',
  'lightbulb',
  'thinking',
  'lookAround',
  'turning',
  'facepalm',
  'disappointed',
  'dizzy',
  'meditate',
  'sway',
  'point',
  'dash',
  'scuttle',
]
// a double click, a right click and a pestering click each have a pool of their own
const BIG = ['confettiCine', 'sparkCine', 'jump', 'startHop', 'danceOnce', 'breakOnce']
const GRUMPY = ['facepalm', 'disappointed', 'dizzy', 'lookAround', 'turning']
export type PokeKind = 'normal' | 'big' | 'grumpy' | 'annoyed'
/** What Claude is doing, as far as Clawd shows it. */
export type Activity = 'look' | 'write' | 'run' | 'think' | 'delegate'
// gaits: reactions that are a short run or crab-walk along the band
const GAITS: Record<string, { speed: number; anim: string }> = {
  dash: { speed: 2.6, anim: 'dash' },
  scuttle: { speed: 1.9, anim: 'scuttle' },
}
const WALK_ANIM_RATE = 0.68
// the app moves 58 world px/s at 6 world px per sprite pixel; a terminal band is wider than the app's box, so a bit quicker
const WALK_SPEED = (58 / 6) * 1.5
export const WALKING_HEIGHT = 18 // the Walking sprite, hop included

export type Sprite = {
  w: number
  h: number
  palette: number[]
  frames: Uint8Array[]
  /** the feet: x of the centre, y of the line under them */
  ax: number
  ay: number
}

const decoded = new Map<string, Sprite>()

const parseColor = (hex: string): number => parseInt(hex.slice(1), 16)

export function sprite(name: string): Sprite {
  let s = decoded.get(name)
  if (s) return s
  const data = SPRITES[name]
  if (!data) throw new Error(`clawdman: no sprite "${name}"`)
  const pixels = Uint8Array.from(
    [...data.base].map(c => (c === '.' ? 255 : parseInt(c, 36))),
  )
  const frames = [pixels.slice()]
  for (const delta of data.deltas) {
    if (delta) {
      for (const edit of delta.split(',')) {
        const at = edit.length - 1
        const color = edit[at] as string
        pixels[parseInt(edit.slice(0, at), 36)] = color === '.' ? 255 : parseInt(color, 36)
      }
    }
    frames.push(pixels.slice())
  }
  s = {
    w: data.w,
    h: data.h,
    palette: data.palette.map(parseColor),
    frames,
    ax: Math.floor(data.a0[0] + data.a0[2] / 2),
    ay: data.a0[1] + data.a0[3],
  }
  decoded.set(name, s)
  return s
}

export type Extent = { above: number; left: number; right: number }
const extents = new Map<string, Extent>()

/** How far a move reaches above the feet and to either side of the anchor, in sprite pixels, over all its frames. */
export function extent(name: string): Extent {
  let e = extents.get(name)
  if (e) return e
  const move = MOVES[name] as Move
  const s = sprite(move.sp)
  const last = Math.min(s.frames.length - 1, move.end ?? move.loop?.[1] ?? 0)
  e = { above: 0, left: 0, right: 0 }
  for (let f = 0; f <= last; f++) {
    const frame = s.frames[f] as Uint8Array
    for (let i = 0; i < frame.length; i++) {
      if (frame[i] === 255) continue
      const x = i % s.w
      const y = (i / s.w) | 0
      e.above = Math.max(e.above, s.ay - y)
      e.left = Math.max(e.left, s.ax - x)
      e.right = Math.max(e.right, x + 1 - s.ax)
    }
  }
  extents.set(name, e)
  return e
}

type State = 'boot' | 'idle' | 'walk' | 'flourish' | 'emote' | 'emoteOut'

export class Companion {
  /** The anchor, in sprite pixels from the band's left edge. */
  x = 0
  facing: 1 | -1 = 1
  state: State = 'boot'
  anim: Move | null = null
  animName = ''
  f = 0
  animRate = 1

  private idleT = 0
  private nextFlourish = 2.5
  private hasWaved = false
  private target: number | null = null
  private afterWalk: (() => void) | null = null
  private isWorking = false
  private deskMove = 'desktop'
  private cheer = false
  private width = 0
  private pxPerCol = 4
  private room = WALKING_HEIGHT
  private placed = false
  private lastReaction = ''
  private walkSpeed = 1
  private attention = false
  private attentionTurn = 0
  /** moves to play, in order, before going back to the desk or to idling */
  private queue: string[] = []
  private deskKind: string | null = null
  private time = 0
  private lastActivityAt = -99
  /** the last reaction a click started, for the status report */

  constructor(private rng: () => number = Math.random) {}

  private home(): number {
    return Math.max(0, this.width - extent('point').right - 1)
  }

  private play(name: string): void {
    this.anim = MOVES[name] as Move
    this.animName = name
    this.f = this.anim.start
  }

  private setState(state: State, move?: string): void {
    this.state = state
    if (move) this.play(move)
    else {
      this.anim = null
      this.animName = ''
    }
  }

  private fits(name: string): boolean {
    return extent(name).above <= this.room
  }

  /** Walks to where `name` fits inside the band, then plays it. */
  private flourishAt(name: string): void {
    const e = extent(name)
    const x = Math.min(Math.max(this.x, e.left), this.width - e.right - 1)
    const start = () => {
      this.target = null
      this.afterWalk = null
      this.setState(name === 'desktop' || name === 'laptop' ? 'emote' : 'flourish', name)
    }
    if (Math.abs(x - this.x) < 1) {
      this.x = x
      start()
    } else {
      this.walkTo(x, start)
    }
  }

  private walkTo(x: number, then: (() => void) | null = null, gait: { speed: number; anim: string } | null = null): void {
    this.target = x
    this.afterWalk = then
    this.facing = x > this.x ? 1 : -1
    this.animRate = gait ? 1 : WALK_ANIM_RATE
    this.walkSpeed = gait ? gait.speed : 1
    if (gait) this.setState('walk', gait.anim)
    else if (this.state !== 'walk' || this.animName !== 'walk') this.setState('walk', 'walk')
  }

  /** The model started or stopped working: sit at the laptop while it does. */
  setWorking(isWorking: boolean): void {
    if (isWorking === this.isWorking) return
    this.isWorking = isWorking
    if (isWorking) {
      this.cheer = false
      if (this.state !== 'boot' && !this.attention) this.startDesk()
    } else if (this.state === 'emote') {
      this.animRate = 1
      this.setState('emoteOut', `${this.deskMove}Out`)
    } else if (this.state === 'walk' && this.afterWalk) {
      // still on the way to the desk; skip it
      this.target = null
      this.afterWalk = null
      this.settle()
    }
  }

  private startDesk(): void {
    // the laptop is taller; a short band gets the desktop
    const desks = ['desktop', 'laptop'].filter(m => this.fits(m))
    this.deskMove =
      this.deskKind && this.fits(this.deskKind) ? this.deskKind : (desks[Math.floor(this.rng() * desks.length)] ?? 'desktop')
    this.facing = 1
    this.animRate = 1
    this.flourishAt(this.deskMove)
  }

  /** Back on its feet: pick up whatever was waiting. */
  private settle(): void {
    this.animRate = 1
    this.walkSpeed = 1
    this.setState('idle')
    this.idleT = 0
    if (this.attention) return // the idle step keeps waving until it is cleared
    while (this.queue.length > 0) {
      const next = this.queue.shift() as string
      if (this.fits(next)) {
        this.flourishAt(next)
        return
      }
    }
    if (this.isWorking) this.startDesk()
    else if (this.cheer) this.startCheer()
  }

  /** Gets up from the desk, or if already standing takes the next queued move. */
  private leaveDesk(): void {
    if (this.state === 'emote') {
      this.animRate = 1
      this.setState('emoteOut', `${this.deskMove}Out`)
    } else if (this.state === 'idle') {
      this.settle()
    }
  }

  /** Claude needs the person (a permission to give, a question to answer): wave and point until cleared. */
  setAttention(on: boolean): void {
    if (on === this.attention) return
    this.attention = on
    if (on) {
      this.cheer = false
      this.queue.length = 0
      if (this.state === 'boot') return
      this.target = null
      this.afterWalk = null
      this.animRate = 1
      this.walkSpeed = 1
      this.setState('idle')
      this.idleT = 1 // starts waving on the very next step
    } else if (this.state === 'idle') {
      this.settle()
    }
  }

  get isAsking(): boolean {
    return this.attention
  }

  private startAttention(): void {
    this.attentionTurn += 1
    this.animRate = 1
    const move = this.attentionTurn % 2 === 1 ? 'wave' : 'point'
    this.flourishAt(this.fits(move) ? move : 'wave')
  }

  /**
   * What Claude is doing now: writing sits at the laptop, running commands at the desktop,
   * reading looks around, thinking and delegating get a quick move of their own.
   */
  setActivity(kind: Activity): void {
    if (!this.isWorking || this.attention || this.state === 'boot') return
    if (this.time - this.lastActivityAt < 2.5) return
    this.lastActivityAt = this.time
    const desk = kind === 'write' ? 'laptop' : kind === 'run' ? 'desktop' : null
    if (desk) {
      if (!this.fits(desk) || this.deskKind === desk) return
      this.deskKind = desk
      if (this.state === 'emote' && this.deskMove !== desk) this.leaveDesk()

      return
    }
    // gestures wait their turn, a couple at most: a busy turn must not leave a backlog
    if (this.queue.length >= 2) return
    this.queue.push(kind === 'look' ? 'lookAround' : kind === 'think' ? 'thinking' : 'point')
    this.leaveDesk()
  }

  /** A new prompt: gestures still waiting from the last turn are dropped. */
  newTurn(): void {
    this.queue.length = 0
  }

  /** A tool failed: a facepalm or a sigh, then back to work. */
  fail(): void {
    if (this.attention || this.state === 'boot') return
    this.queue.push(this.rng() < 0.5 ? 'facepalm' : 'disappointed')
    this.leaveDesk()
  }

  /** A long stretch of work: Clawd stretches, then settles down to meditate. */
  stretch(): void {
    if (this.attention || this.state === 'boot') return
    this.queue.push('sway', 'meditate')
    this.leaveDesk()
  }

  /** A turn finished: a short celebration once Clawd is back on its feet. */
  celebrate(): void {
    this.cheer = true
    if (this.state === 'idle' || this.state === 'flourish' || this.state === 'walk') this.startCheer()
  }

  private startCheer(): void {
    this.cheer = false
    const pool = CHEERS.filter(m => this.fits(m))
    const pick = pool[Math.floor(this.rng() * pool.length)]
    if (pick) {
      this.animRate = 1
      this.flourishAt(pick)
    }
  }

  /** A click on the scenery away from Clawd: walk there (run, when it is far). False if there is nothing to do. */
  walkToPx(x: number): boolean {
    if (this.state === 'boot' || this.state === 'emote' || this.state === 'emoteOut') return false
    const reach = extent('walk')
    const goal = Math.min(Math.max(x, reach.left), this.width - reach.right - 1)
    if (Math.abs(goal - this.x) < 6) return false
    this.afterWalk = null
    this.cheer = false
    this.idleT = 0
    const isFar = Math.abs(goal - this.x) > this.pxPerCol * 36
    this.walkTo(goal, () => this.settle(), isFar ? (GAITS.dash as { speed: number; anim: string }) : null)

    return true
  }

  /** The pointer is over the band: a standing Clawd turns to face it. */
  faceToward(x: number): void {
    if (this.state === 'idle' && Math.abs(x - this.x) > 12) this.facing = x > this.x ? 1 : -1
  }

  /** The reaction the last click started. */
  get lastPoke(): string {
    return this.lastReaction
  }

  /** Clawd was clicked: a random reaction, never the same twice in a row. */
  poke(kind: PokeKind = 'normal'): boolean {
    if (this.state === 'boot' || this.state === 'emote' || this.state === 'emoteOut') return false
    const source = kind === 'big' ? BIG : kind === 'grumpy' ? GRUMPY : kind === 'annoyed' ? ['dizzy'] : REACTIONS
    const pool = source.filter(m => this.fits(m) && (m !== this.lastReaction || source.length === 1))
    const pick = pool[Math.floor(this.rng() * pool.length)]
    if (!pick) return false
    this.lastReaction = pick
    this.target = null
    this.afterWalk = null
    this.cheer = false
    this.animRate = 1
    this.idleT = 0
    const gait = GAITS[pick]
    if (gait) {
      // a run or a crab-walk: a stretch of the band in a random direction, then back to standing
      const reach = extent('walk')
      const room = this.pxPerCol * (14 + Math.floor(this.rng() * 16))
      const dir = this.rng() < 0.5 ? -1 : 1
      const x = Math.min(Math.max(this.x + dir * room, reach.left), this.width - reach.right - 1)
      const away = Math.abs(x - this.x) < 8 ? (dir === 1 ? Math.max(reach.left, this.x - room) : Math.min(this.width - reach.right - 1, this.x + room)) : x
      this.walkTo(away, () => this.settle(), gait)
    } else {
      this.flourishAt(pick)
    }

    return true
  }

  /**
   * @param dt seconds since the last step
   * @param width the band's width in sprite pixels
   * @param room how many sprite pixels above the feet the band can show
   * @param pxPerCol sprite pixels in one terminal column
   */
  step(dt: number, width: number, room: number, pxPerCol: number): void {
    dt = Math.min(Math.max(dt, 0), 0.25)
    this.time += dt
    this.width = width
    this.room = room
    this.pxPerCol = pxPerCol
    const home = this.home()

    if (!this.placed) {
      this.placed = true
      // the app walks Clawd in at the start
      this.x = Math.max(extent('walk').left, home - 12 * pxPerCol)
      this.walkTo(home, () => this.settle())
      this.state = 'boot'
    }

    // a narrower band: keep Clawd and where it is heading inside it
    const reach = extent('walk')
    const farthest = Math.max(reach.left, Math.min(home, width - reach.right - 1))
    if (this.x > farthest) this.x = farthest
    if (this.target !== null && this.target > farthest) this.target = farthest

    this.advance(dt)

    if (this.state === 'boot' || this.state === 'walk') {
      if (this.target === null) return
      const dir = Math.sign(this.target - this.x)
      this.x += dir * WALK_SPEED * this.walkSpeed * dt
      if (dir === 0 || Math.sign(this.target - this.x) !== dir) {
        this.x = this.target
        this.target = null
        const then = this.afterWalk
        this.afterWalk = null
        if (then) then()
        else this.settle()
      }
      return
    }

    if (this.state === 'idle') {
      this.idleT += dt
      if (this.attention) {
        if (this.idleT > 0.9) {
          this.idleT = 0
          this.startAttention()
        }

        return
      }
      if (this.idleT <= this.nextFlourish) return
      this.idleT = 0
      this.nextFlourish = 2.2 + this.rng() * 3.4
      if (!this.hasWaved) {
        this.hasWaved = true
        if (this.fits('wave')) this.flourishAt('wave')
      } else if (this.rng() < 0.4) {
        // anywhere along the band, not just near home
        const walk = extent('walk')
        const x = walk.left + this.rng() * (this.width - walk.left - walk.right - 1)
        this.walkTo(x, () => this.settle())
      } else {
        const pool = TITLE_FLOURISHES.filter(m => this.fits(m))
        const pick = pool[Math.floor(this.rng() * pool.length)]
        if (pick) this.flourishAt(pick)
      }
      return
    }

    if ((this.state === 'flourish' || this.state === 'emoteOut') && !this.anim) this.settle()
  }

  private advance(dt: number): void {
    const a = this.anim
    if (!a) return
    this.f += a.fps * dt * this.animRate
    if (a.loop) {
      const [from, to] = a.loop
      if (this.f >= to + 1) this.f = from + ((this.f - from) % (to - from + 1))
    } else if (a.oneShot && a.end !== undefined && this.f >= a.end + 1) {
      this.anim = null
    }
  }

  /** Sprite pixels above the feet the current move reaches (never less than the Walking sprite). */
  aboveNeeded(): number {
    return Math.max(WALKING_HEIGHT, this.anim ? extent(this.animName).above : 0)
  }

  /** The frame on screen. Standing is the first Walking frame, as in the app. */
  current(): { name: string; frame: number } {
    if (this.anim) {
      const s = sprite(this.anim.sp)
      return { name: this.anim.sp, frame: Math.max(0, Math.min(s.frames.length - 1, this.f | 0)) }
    }
    return { name: 'Walking', frame: 0 }
  }
}
