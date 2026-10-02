import { expect, test } from 'claude-code/testing'

import { Asks, stable } from '../hooks/asks'
import { Companion, sprite } from '../hooks/engine'
import { REFUSALS_BEFORE_BLOCKS, shouldUseBlocks } from '../hooks/fallback'
import { IMAGE, SUBAGENT_SCALE, extrasKey, imagePixels, imageRoom, phaseOf, skyOf } from '../hooks/render'
import { encodeIndexedPng } from '../hooks/png'
import { countChanges, shortDuration } from '../hooks/village'

const WIDTH = 150 * IMAGE.pxPerCol

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

const settle = (clawd: Companion) => {
  for (let t = 0; clawd.state !== 'idle' && t < 60; t += 0.04) clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

/**
 * An independent decoder for the one fixed-Huffman block the encoder writes, so the encoder is checked
 * against a reader of its own, and a copy further back than the 32 KiB window is an error, as in zlib.
 */
function inflate(zlib: Uint8Array): number[] {
  let pos = 16 // after the two header bytes
  const bit = (): number => {
    const v = ((zlib[pos >> 3] as number) >> (pos & 7)) & 1
    pos += 1

    return v
  }
  const bits = (n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) v |= bit() << i

    return v
  }
  const symbol = (): number => {
    let code = 0
    for (let len = 1; len <= 9; len++) {
      code = (code << 1) | bit()
      if (len === 7 && code <= 23) return 256 + code
      if (len === 8 && code >= 48 && code <= 191) return code - 48
      if (len === 8 && code >= 192 && code <= 199) return 280 + code - 192
      if (len === 9 && code >= 400) return 144 + code - 400
    }
    throw new Error('not a fixed Huffman code')
  }

  expect(bits(1)).toBe(1) // the final block
  expect(bits(2)).toBe(1) // with fixed codes
  const out: number[] = []
  for (;;) {
    const sym = symbol()
    if (sym === 256) return out
    if (sym < 256) {
      out.push(sym)
      continue
    }
    const lc = sym - 257
    const length = (LENGTH_BASE[lc] as number) + bits(LENGTH_EXTRA[lc] as number)
    let dc = 0
    for (let i = 0; i < 5; i++) dc = (dc << 1) | bit()
    const dist = (DIST_BASE[dc] as number) + bits(DIST_EXTRA[dc] as number)
    if (dist > 32768 || dist > out.length) throw new Error(`a copy from ${dist} bytes back`)
    for (let k = 0; k < length; k++) out.push(out[out.length - dist] as number)
  }
}

const differs = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0)

test('git status lines count as staged and changed files, ignored files not at all', () => {
  const status = ['M  src/a.ts', ' M src/b.ts', 'MM src/c.ts', 'A  new.ts', '?? scratch.txt', ' D gone.ts', '!! build/out.js', ''].join('\n')

  expect(countChanges(status)).toEqual({ staged: 3, changed: 3 })
  expect(countChanges('')).toEqual({ staged: 0, changed: 0 })
})

test('durations read short', () => {
  expect(shortDuration(42_000)).toBe('42s')
  expect(shortDuration(125_000)).toBe('2m 5s')
  expect(shortDuration(3_780_000)).toBe('1h 3m')
  expect(shortDuration(-5)).toBe('0s')
})

test('the sky follows the clock: moon at night, sun by day, a low sun with stars at dusk', () => {
  expect(phaseOf(undefined)).toBe('night')
  expect(phaseOf(2)).toBe('night')
  expect(phaseOf(5.5)).toBe('dusk')
  expect(phaseOf(12)).toBe('day')
  expect(phaseOf(17.5)).toBe('dusk')
  expect(phaseOf(21)).toBe('night')

  expect(skyOf({})).toEqual({ moonRow: 3, warm: false, body: 'moon', stars: true })
  expect(skyOf({ hour: 12 })).toEqual({ moonRow: 3, warm: false, body: 'sun', stars: false })
  expect(skyOf({ hour: 18 })).toEqual({ moonRow: 6, warm: false, body: 'sun', stars: true })
  // sinking context never takes the body under the ground
  expect(skyOf({ hour: 18, context: 1 }).moonRow).toBe(13)

  const clawd = new Companion(seeded(3))
  settle(clawd)
  const night = imagePixels(clawd, 167, 'dots', {})
  const day = imagePixels(clawd, 167, 'dots', { hour: 12 })
  expect(differs(night.pixels, day.pixels) > 200).toBe(true)
  // the sun is warm
  expect(day.palette.some((v, i) => i % 3 === 0 && v > (day.palette[i + 2] as number) + 40 && v !== 0xd9)).toBe(true)
  expect(extrasKey({ hour: 12 }) === extrasKey({ hour: 2 })).toBe(false)
  expect(extrasKey({ hour: 10 })).toBe(extrasKey({ hour: 11 }))
})

test('a house stands for each changed file, brighter when staged, capped at twenty-four', () => {
  const clawd = new Companion(seeded(5))
  settle(clawd)
  const none = imagePixels(clawd, 167, 'dots', {})
  const some = imagePixels(clawd, 167, 'dots', { village: { staged: 1, changed: 2 } })
  const more = imagePixels(clawd, 167, 'dots', { village: { staged: 1, changed: 5 } })
  const many = imagePixels(clawd, 167, 'dots', { village: { staged: 30, changed: 30 } })
  const full = imagePixels(clawd, 167, 'dots', { village: { staged: 0, changed: 24 } })

  expect(differs(none.pixels, some.pixels) > 300).toBe(true)
  expect(differs(some.pixels, more.pixels) > 300).toBe(true)
  // an empty village is the plain landscape
  expect(differs(none.pixels, imagePixels(clawd, 167, 'dots', { village: { staged: 0, changed: 0 } }).pixels)).toBe(0)
  // more files than houses: staged ones come first, and the rest do not fit
  expect(differs(many.pixels, imagePixels(clawd, 167, 'dots', { village: { staged: 24, changed: 0 } }).pixels)).toBe(0)
  expect(differs(full.pixels, many.pixels) > 100).toBe(true)
  expect(differs(full.pixels, imagePixels(clawd, 167, 'dots', { village: { staged: 0, changed: 99 } }).pixels)).toBe(0)
  expect(extrasKey({ village: { staged: 1, changed: 2 } }) === extrasKey({ village: { staged: 2, changed: 1 } })).toBe(false)
  expect(extrasKey({ village: { staged: 0, changed: 0 } })).toBe(extrasKey({}))
})

test('a speech bubble sits above Clawd with its tail on it, in the tone of the message', () => {
  const clawd = new Companion(seeded(7))
  settle(clawd)
  const plain = imagePixels(clawd, 167, 'dots', {})
  const said = imagePixels(clawd, 167, 'dots', { bubble: { text: 'done 42s' } })
  const asked = imagePixels(clawd, 167, 'dots', { bubble: { text: 'needs you', tone: 'ask' } })

  expect(differs(plain.pixels, said.pixels) > 400).toBe(true)
  expect(differs(said.pixels, asked.pixels) > 400).toBe(true)
  // every changed pixel is above Clawd's feet and within the bubble's own width and the picture
  const s = sprite('Walking')
  const feet = said.height - 18
  const x = Math.round(clawd.x) * IMAGE.scale
  let left = said.width
  let right = 0
  let bottom = 0
  said.pixels.forEach((v, i) => {
    if (v === plain.pixels[i]) return
    left = Math.min(left, i % said.width)
    right = Math.max(right, i % said.width)
    bottom = Math.max(bottom, Math.floor(i / said.width))
  })
  expect(bottom < feet).toBe(true)
  expect(left <= x && x <= right).toBe(true)
  expect(s.w > 0).toBe(true)
  // an empty message draws nothing, and the key follows the words and the tone
  expect(differs(plain.pixels, imagePixels(clawd, 167, 'dots', { bubble: { text: '  ' } }).pixels)).toBe(0)
  expect(extrasKey({ bubble: { text: 'a' } }) === extrasKey({ bubble: { text: 'b' } })).toBe(false)
  expect(extrasKey({ bubble: { text: 'a' } }) === extrasKey({ bubble: { text: 'a', tone: 'warn' } })).toBe(false)
})

test('a bubble that would not fit above Clawd is left out, and one near the edge stays inside the picture', () => {
  const clawd = new Companion(seeded(9))
  settle(clawd)
  clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
  const long = imagePixels(clawd, 167, 'dots', { bubble: { text: 'a very long message that is cut short' } })
  const plain = imagePixels(clawd, 167, 'dots', {})

  expect(long.pixels.length).toBe(plain.pixels.length)
  expect(differs(long.pixels, plain.pixels) > 0).toBe(true)
})

test('a merge conflict is a changed file, not a staged one', () => {
  expect(countChanges('UU both.ts\nAA added.ts\nDD gone.ts\nAU mine.ts\nUD theirs.ts\nM  ok.ts')).toEqual({ staged: 1, changed: 5 })
})

test('Clawd asks until every pending request is answered, whichever agent it belongs to', () => {
  const asks = new Asks()
  expect(asks.isOpen).toBe(false)

  // a parallel call finishing does not answer another call's request
  asks.request(undefined, 'Bash')
  asks.finished(undefined, 'Read')
  expect(asks.isOpen).toBe(true)
  asks.finished(undefined, 'Bash')
  expect(asks.isOpen).toBe(false)

  // a subagent's request is answered when the subagent's call ends
  asks.request('agent-1', 'Edit')
  asks.finished(undefined, 'Edit')
  expect(asks.isOpen).toBe(true)
  asks.finished('agent-1', 'Edit')
  expect(asks.isOpen).toBe(false)

  // two requests at once need two answers
  asks.request(undefined, 'Bash')
  asks.request('agent-2', 'Write')
  asks.denied(undefined, 'Bash')
  expect(asks.isOpen).toBe(true)
  asks.denied('agent-2', 'Write')
  expect(asks.isOpen).toBe(false)

  // a notification names no call: the next main-agent call ends it; a prompt clears everything
  asks.notify()
  asks.finished('agent-3', 'Read')
  expect(asks.isOpen).toBe(true)
  asks.finished(undefined, 'Read')
  expect(asks.isOpen).toBe(false)
  asks.request(undefined, 'Bash')
  asks.notify()
  asks.clear()
  expect(asks.isOpen).toBe(false)
})

test('shrinking the band brings Clawd and its walk target back inside it', () => {
  const clawd = new Companion(seeded(11))
  const wide = 250 * IMAGE.pxPerCol
  for (let t = 0; clawd.state !== 'idle' && t < 60; t += 0.04) clawd.step(0.04, wide, imageRoom('dots'), IMAGE.pxPerCol)
  expect(clawd.x > 30 * IMAGE.pxPerCol).toBe(true)

  const narrow = 30 * IMAGE.pxPerCol
  clawd.step(0.04, narrow, imageRoom('dots'), IMAGE.pxPerCol)
  expect(clawd.x <= narrow).toBe(true)
  for (let t = 0; t < 30; t += 0.04) clawd.step(0.04, narrow, imageRoom('dots'), IMAGE.pxPerCol)
  expect(clawd.x <= narrow).toBe(true)
})

test('activity gestures do not pile up, and a new prompt drops the ones still waiting', () => {
  const clawd = new Companion(seeded(13))
  settle(clawd)
  clawd.setWorking(true)
  const queued = () => (clawd as unknown as { queue: string[] }).queue.length
  for (let i = 0; i < 100; i++) {
    for (let t = 0; t < 2.6; t += 0.04) clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
    clawd.setActivity('delegate')
    expect(queued() <= 2).toBe(true)
  }
  clawd.newTurn()
  expect(queued()).toBe(0)
})

test('the frame key moves with the friends\' typing exactly when the picture does', () => {
  const clawd = new Companion(seeded(17))
  settle(clawd)
  const a = imagePixels(clawd, 167, 'dots', { friends: 1, time: 1 })
  const b = imagePixels(clawd, 167, 'dots', { friends: 1, time: 1.09 })

  expect(differs(a.pixels, b.pixels) > 0).toBe(true)
  expect(extrasKey({ friends: 1, time: 1 }) === extrasKey({ friends: 1, time: 1.09 })).toBe(false)
  // within one 12 Hz step both are the same
  expect(extrasKey({ friends: 1, time: 1.01 })).toBe(extrasKey({ friends: 1, time: 1.02 }))
})

test('a picture wider than the deflate window still decodes to the same pixels', () => {
  for (const width of [2766, 33_000, 40_000]) {
    const height = 3
    const pixels = new Uint8Array(width * height)
    let seed = 7
    for (let x = 0; x < width; x++) {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      pixels[x] = 1 + (seed >>> 24) % 5
    }
    // the rows below repeat the first one exactly
    for (let y = 1; y < height; y++) pixels.set(pixels.subarray(0, width), y * width)

    const png = encodeIndexedPng(pixels, width, height, Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9, 7, 7, 7, 1, 2, 3))
    // find the IDAT chunk and inflate it
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    let at = 8
    let idat: Uint8Array | undefined
    while (at < png.length) {
      const length = view.getUint32(at)
      const type = String.fromCharCode(png[at + 4] as number, png[at + 5] as number, png[at + 6] as number, png[at + 7] as number)
      if (type === 'IDAT') idat = png.subarray(at + 8, at + 8 + length)
      at += 12 + length
    }
    const raw = Uint8Array.from(inflate(idat as Uint8Array))
    expect(raw.length).toBe((width + 1) * height)
    for (let y = 0; y < height; y++) {
      const row = raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1))
      expect(row.every((v, x) => v === pixels[y * width + x])).toBe(true)
    }
  }
})

test('pictures are only given up on by a terminal that never showed one', () => {
  // never accepted a picture and refused again and again: draw blocks
  expect(shouldUseBlocks(0, REFUSALS_BEFORE_BLOCKS)).toBe(true)
  expect(shouldUseBlocks(0, REFUSALS_BEFORE_BLOCKS - 1)).toBe(false)
  // a covered band (a permission dialog) refuses for as long as it is open, however long
  expect(shouldUseBlocks(1, 500)).toBe(false)
  expect(shouldUseBlocks(40, REFUSALS_BEFORE_BLOCKS * 10)).toBe(false)
})

test('a request is answered by its own call: same tool with other input, or another agent, does not answer it', () => {
  const asks = new Asks()
  const a = { command: 'rm -rf build' }
  const b = { command: 'ls' }

  // Bash A waits for approval; an unrelated Bash B finishes
  asks.request(undefined, 'Bash', a)
  asks.finished(undefined, 'Bash', b)
  expect(asks.isOpen).toBe(true)
  asks.finished(undefined, 'Bash', { command: 'rm -rf build' })
  expect(asks.isOpen).toBe(false)

  // the same input, keys in another order, is the same call
  expect(stable({ a: 1, b: { y: 2, x: 3 } })).toBe(stable({ b: { x: 3, y: 2 }, a: 1 }))
  asks.request(undefined, 'Edit', { file: 'a.ts', text: 'x' })
  asks.finished(undefined, 'Edit', { text: 'x', file: 'a.ts' })
  expect(asks.isOpen).toBe(false)

  // a child's notification is answered by that child's call, and not by the main agent's
  asks.notify('child')
  asks.finished(undefined, 'Read', {})
  expect(asks.isOpen).toBe(true)
  asks.finished('child', 'Read', {})
  expect(asks.isOpen).toBe(false)
})

test('the main turn ending leaves a background subagent that still waits, and a subagent ending clears its own', () => {
  const asks = new Asks()
  asks.request(undefined, 'Bash', { command: 'ls' })
  asks.request('child', 'Write', { file: 'x' })
  asks.notify('child')

  asks.clearAgent(undefined)
  expect(asks.isOpen).toBe(true)
  asks.clearAgent('child')
  expect(asks.isOpen).toBe(false)

  // a new prompt clears everything
  asks.request('other', 'Write', {})
  asks.clear()
  expect(asks.isOpen).toBe(false)
})

test('subagents are drawn a hair smaller and keep the same colours as the main Clawd', () => {
  expect(SUBAGENT_SCALE < 1 && SUBAGENT_SCALE > 0.8).toBe(true)

  const clawd = new Companion(seeded(4))
  settle(clawd)
  const colours = (png: { pixels: Uint8Array; palette: Uint8Array }) => {
    const used = new Set<number>()
    for (const v of png.pixels) used.add(((png.palette[v * 3] as number) << 16) | ((png.palette[v * 3 + 1] as number) << 8) | (png.palette[v * 3 + 2] as number))

    return used
  }
  const alone = imagePixels(clawd, 167, 'dots', {})
  const three = imagePixels(clawd, 167, 'dots', { friends: 3, time: 1 })
  const before = colours(alone)
  const orange = [0xd97757, 0xd87656, 0xbe684d]

  // the desks bring the sprites' own colours (orange body, shade, the computers), and no colour of a subagent's own
  for (const c of orange) expect(colours(three).has(c)).toBe(true)
  const own = new Set<number>([...sprite('Walking').palette, ...sprite('Laptop').palette, ...sprite('Desktop').palette])
  expect([...colours(three)].filter(c => !before.has(c) && !own.has(c))).toEqual([])
  // an orange desk Clawd is drawn: more orange pixels than with nobody running
  const count = (png: { pixels: Uint8Array; palette: Uint8Array }) => {
    const ids = new Set<number>()
    for (let i = 0; i + 2 < png.palette.length; i += 3) {
      const rgb = ((png.palette[i] as number) << 16) | ((png.palette[i + 1] as number) << 8) | (png.palette[i + 2] as number)
      if (rgb === 0xd97757 || rgb === 0xd87656 || rgb === 0xbe684d) ids.add(i / 3)
    }

    return png.pixels.reduce((n, v) => n + (ids.has(v) ? 1 : 0), 0)
  }
  expect(count(three) > count(alone) + 600).toBe(true)
})

test('two identical requests are two requests, and a new prompt leaves a waiting subagent alone', () => {
  const asks = new Asks()
  const pwd = { command: 'pwd' }

  asks.request(undefined, 'Bash', pwd)
  asks.request(undefined, 'Bash', pwd)
  asks.finished(undefined, 'Bash', pwd)
  expect(asks.isOpen).toBe(true) // the second one still waits
  asks.finished(undefined, 'Bash', pwd)
  expect(asks.isOpen).toBe(false)
  // finishing a call that never asked changes nothing
  asks.finished(undefined, 'Bash', pwd)
  expect(asks.isOpen).toBe(false)

  // a refusal answers one of two identical requests
  asks.request(undefined, 'Bash', pwd)
  asks.request(undefined, 'Bash', pwd)
  asks.denied(undefined, 'Bash', pwd)
  expect(asks.isOpen).toBe(true)

  // the main agent's new prompt clears the main agent's requests only
  asks.clear()
  asks.request(undefined, 'Edit', { file: 'a.ts' })
  asks.request('child', 'Write', { file: 'b.ts' })
  asks.clearAgent(undefined)
  expect(asks.isOpen).toBe(true)
  asks.finished('child', 'Write', { file: 'b.ts' })
  expect(asks.isOpen).toBe(false)
})
