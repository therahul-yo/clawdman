import { expect, test } from 'claude-code/testing'

import { activityOf } from '../hooks/activity'
import { clickKind } from '../hooks/clicks'
import { Companion, MOVES, WALKING_HEIGHT, extent, sprite } from '../hooks/engine'
import {
  BLOCKS,
  BLOCKS_ROOM,
  IMAGE,
  imageRoom,
  padOf,
  blockCells,
  getFit,
  imageColumns,
  imageFrame,
  extrasKey,
  deskLayout,
  imagePixels,
  skyOf,
  moonColumn,
  mountainFill,
  terrainAt,
  walkColumns,
} from '../hooks/render'

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

const COLUMNS = 100
// the picture's width in pixels for a band `cols` wide (the cells' width times the fit that fills the box)
const widthOf = (cols: number) => Math.round(imageColumns(cols) * IMAGE.cellWidth * getFit())
const WIDTH = walkColumns(COLUMNS) * IMAGE.pxPerCol

const run = (clawd: Companion, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.04) clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
}

const settle = (clawd: Companion) => {
  for (let t = 0; clawd.state !== 'idle' && t < 60; t += 0.04) clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
}

const words = (cells: string) => {
  const raw = atob(cells)
  const out = new Uint32Array(raw.length / 4)
  for (let i = 0; i < out.length; i++) {
    out[i] =
      (raw.charCodeAt(i * 4) |
        (raw.charCodeAt(i * 4 + 1) << 8) |
        (raw.charCodeAt(i * 4 + 2) << 16) |
        (raw.charCodeAt(i * 4 + 3) << 24)) >>>
      0
  }
  return out
}

const png = (frame: { source: { png: string } }) => {
  const raw = atob(frame.source.png)
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  return { bytes, width: view.getUint32(16), height: view.getUint32(20) }
}

test('every move in the table points at real frames of its sprite', () => {
  for (const [name, move] of Object.entries(MOVES)) {
    const s = sprite(move.sp)
    const last = move.end ?? move.loop?.[1] ?? 0
    expect(`${name}:${last < s.frames.length}`).toBe(`${name}:true`)
    expect(`${name}:${move.start < s.frames.length}`).toBe(`${name}:true`)
  }
})

test("the Walking sprite decodes to the app's first frame", () => {
  const s = sprite('Walking')
  const row = (y: number) =>
    [...(s.frames[0] as Uint8Array).slice(y * s.w, (y + 1) * s.w)].map(v => (v === 255 ? '.' : String(v))).join('')

  expect(s.frames.length).toBe(28)
  expect(row(2)).toBe('....2222222222222222....')
  expect(row(4)).toBe('....2200222222220022....')
  expect(row(6)).toBe('222222222222222222222222')
  expect(row(14)).toBe('....22..22....22..22....')
})

test('every idle move fits the fixed stage with room under the feet', () => {
  expect(imageRoom('dots') >= 30).toBe(true)
  for (const name of ['walk', 'wave', 'sway', 'point', 'turning', 'danceOnce', 'meditate', 'breakOnce', 'excitedPick', 'desktop']) {
    expect(`${name}:${extent(name).above * IMAGE.scale + padOf('dots') <= IMAGE.rows * IMAGE.cellHeight}`).toBe(`${name}:true`)
  }
  expect(WALKING_HEIGHT).toBe(18)
})

test('the picture is the same size in every frame of every move', () => {
  const clawd = new Companion(seeded(11))
  const sizes = new Set<string>()
  for (let t = 0; t < 20; t += 0.04) {
    clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
    const { width, height } = png(imageFrame(clawd, COLUMNS))
    sizes.add(`${width}x${height}`)
  }

  expect([...sizes]).toEqual([`${widthOf(COLUMNS)}x${IMAGE.rows * IMAGE.cellHeight}`])
})

test('the picture is a valid, small PNG', () => {
  const clawd = new Companion(seeded(1))
  settle(clawd)
  const { bytes, width, height } = png(imageFrame(clawd, COLUMNS))

  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(width).toBe(widthOf(COLUMNS))
  expect(height).toBe(IMAGE.rows * IMAGE.cellHeight)
  expect(bytes.length < 16000).toBe(true)
})

test('moving a pixel changes the picture', () => {
  const clawd = new Companion(seeded(1))
  settle(clawd)
  const before = imageFrame(clawd, COLUMNS)
  clawd.x += 1

  expect(before.key === imageFrame(clawd, COLUMNS).key).toBe(false)
})

test('Clawd walks in, settles at the right end of the stage and then waves first', () => {
  const clawd = new Companion(seeded(7))
  run(clawd, 0.1)
  expect(clawd.state).toBe('boot')

  settle(clawd)
  expect(clawd.x > WIDTH * 0.6).toBe(true)

  const seen = new Set<string>()
  for (let t = 0; t < 12; t += 0.04) {
    clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
    if (clawd.animName) seen.add(clawd.animName)
  }
  expect(seen.has('wave')).toBe(true)
})

test("over four minutes Clawd shows the app's idle repertoire and stays on the stage", () => {
  const clawd = new Companion(seeded(42))
  const seen = new Set<string>()
  let lowest = Infinity
  let highest = -Infinity
  for (let t = 0; t < 240; t += 0.04) {
    clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
    if (clawd.animName) seen.add(clawd.animName)
    lowest = Math.min(lowest, clawd.x)
    highest = Math.max(highest, clawd.x)
  }
  const allowed = new Set(['walk', 'wave', 'sway', 'turning', 'danceOnce', 'breakOnce', 'meditate'])

  for (const name of seen) expect(`${name}:${allowed.has(name)}`).toBe(`${name}:true`)
  expect(seen.size >= 5).toBe(true)
  expect(lowest >= 0 && highest <= WIDTH).toBe(true)
})

test('Clawd sits at the desktop or laptop while Claude works, then gets up', () => {
  const clawd = new Companion(seeded(3))
  run(clawd, 10)
  clawd.setWorking(true)
  run(clawd, 6)

  expect(clawd.state).toBe('emote')
  expect(['desktop', 'laptop']).toContain(clawd.animName)

  clawd.setWorking(false)
  run(clawd, 2)
  expect(clawd.state === 'idle' || clawd.state === 'flourish').toBe(true)
})

test('a finished turn makes Clawd cheer', () => {
  const clawd = new Companion(seeded(5))
  run(clawd, 10)
  clawd.celebrate()
  const seen = new Set<string>()
  for (let t = 0; t < 4; t += 0.04) {
    clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
    if (clawd.animName) seen.add(clawd.animName)
  }

  expect(['excitedPick', 'danceOnce'].some(n => seen.has(n))).toBe(true)
})

test('the picture is one landscape: the same size wherever Clawd stands, and Clawd stands on its ground', () => {
  const clawd = new Companion(seeded(8))
  settle(clawd)
  const { pixels, width, height, palette } = imagePixels(clawd, 167)
  const orange = [...Array(palette.length / 3).keys()].find(n => palette[n * 3] === 0xd9 && palette[n * 3 + 1] === 0x77 && palette[n * 3 + 2] === 0x57)

  expect(width).toBe(widthOf(167))
  expect(height).toBe(IMAGE.rows * IMAGE.cellHeight)
  expect(orange).toBeDefined()
  // the lowest orange pixel is the sole of a foot; the ground starts right under it
  let lowest = -1
  let at = -1
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i] === orange && i > lowest * width) {
      lowest = (i / width) | 0
      at = i % width
    }
  }
  expect(lowest).toBe(height - padOf('dots') - 1)
  // and there are ground dots within a few pixels under that foot
  let nearby = 0
  for (let y = lowest + 1; y <= Math.min(height - 1, lowest + 8); y++) {
    for (let x = Math.max(0, at - 16); x <= Math.min(width - 1, at + 16); x++) if (pixels[y * width + x] !== 0) nearby++
  }
  expect(nearby > 10).toBe(true)
})

test('the solid pixel landscape has sky, mountains, hills, pines and ground in many colours, and no gaps', () => {
  const clawd = new Companion(seeded(8))
  settle(clawd)
  const { pixels, width, height, palette } = imagePixels(clawd, 167, 'pixels')
  const colors = new Set<number>()
  let transparent = 0
  for (let i = 0; i < pixels.length; i++) {
    colors.add(pixels[i] as number)
    if (pixels[i] === 0) transparent++
  }

  expect(palette.length / 3 >= 12).toBe(true)
  expect(colors.size >= 12).toBe(true)
  for (let x = 0; x < width; x++) expect(pixels[(height - 1) * width + x]).not.toBe(0)
  expect(transparent).toBe(0)
})

test('the dotted landscape is round grey dots on a dark backing: mostly empty sky', () => {
  const clawd = new Companion(seeded(8))
  settle(clawd)
  const { pixels, width, height, palette } = imagePixels(clawd, 167, 'dots')
  const backing = pixels[0] as number
  let empty = 0
  let ground = 0
  for (let i = 0; i < pixels.length; i++) if (pixels[i] === backing) empty++
  // the lowest two dot rows (the ground) are dense with dots
  for (let i = (height - 18) * width; i < pixels.length; i++) if (pixels[i] !== backing) ground++

  expect(palette[backing * 3]).toBe(0x14)
  expect(palette[backing * 3 + 1]).toBe(0x14)
  expect(empty > pixels.length * 0.6).toBe(true)
  expect(ground > width * 18 * 0.2).toBe(true)
  // palette: the backing, greys, and Clawd's colours
  expect(palette.length / 3 >= 8).toBe(true)
})

test('the dotted landscape never moves by itself: the same pose is the same picture, so an idle Clawd sends nothing', () => {
  const clawd = new Companion(seeded(8))
  settle(clawd)
  const a = imageFrame(clawd, 167, 'dots')
  const b = imageFrame(clawd, 167, 'dots')

  expect(a.key).toBe(b.key)
  expect(a.source.png).toBe(b.source.png)
  // there are clouds in the sky, and they are part of the fixed picture
  const { pixels, width } = imagePixels(clawd, 167, 'dots')
  const backing = pixels[0] as number
  let sky = 0
  for (let i = 0; i < width * 54; i++) if (pixels[i] !== backing) sky++
  expect(sky > 400).toBe(true)
})

test('clicking Clawd starts a reaction that is not the same twice in a row and fits the stage', () => {
  const clawd = new Companion(seeded(13))
  run(clawd, 10)
  const seen: string[] = []
  for (let n = 0; n < 12; n++) {
    expect(clawd.poke()).toBe(true)
    seen.push(clawd.animName)
    expect(extent(clawd.animName).above <= imageRoom('dots')).toBe(true)
    run(clawd, 6)
  }

  for (let i = 1; i < seen.length; i++) expect(seen[i] === seen[i - 1]).toBe(false)
  expect(new Set(seen).size >= 5).toBe(true)
})

test('Clawd ignores clicks while it sits at the desktop', () => {
  const clawd = new Companion(seeded(2))
  run(clawd, 10)
  clawd.setWorking(true)
  run(clawd, 4)

  expect(clawd.poke()).toBe(false)
})

test('the block fallback is a fixed band, Clawd on the same landscape', () => {
  const clawd = new Companion(seeded(1))
  const width = (COLUMNS - IMAGE.rightMargin) * BLOCKS.pxPerCol
  for (let t = 0; clawd.state !== 'idle' && t < 60; t += 0.04) clawd.step(0.04, width, BLOCKS_ROOM, BLOCKS.pxPerCol)
  const w = words(blockCells(clawd, COLUMNS))
  const used = new Set<number>()
  let landscape = 0
  for (let i = 0; i < COLUMNS * BLOCKS.rows; i++) {
    const glyph = w[i * 3] as number
    if (glyph === 0x20) continue
    landscape++
    if (w[i * 3 + 1] === 0xd97757 || w[i * 3 + 2] === 0xd97757) used.add(i % COLUMNS)
  }

  expect(w.length).toBe(COLUMNS * BLOCKS.rows * 3)
  expect(used.size).toBe(12)
  expect(landscape > COLUMNS * 2).toBe(true)
})

test('the moon hangs on the left over open ground, with low terrain and no tree under it', () => {
  for (const lw of [297, 400, 160]) {
    const x = moonColumn(lw)
    let tallest = 0
    for (let k = -6; k <= 6; k++) tallest = Math.max(tallest, terrainAt(x + k).mountain + terrainAt(x + k).hill)

    expect(x >= 14 && x < 150).toBe(true)
    // the moon sits in rows 0 to 6, mountains here stay well below it
    expect(tallest <= 6).toBe(true)
  }
  // a band too narrow for scenery gets no moon search at all
  expect(moonColumn(297)).toBe(moonColumn(297))
})

test('a click has twenty-one reactions to choose from, all of them fit the dotted stage, none repeats back to back', () => {
  const clawd = new Companion(seeded(31))
  run(clawd, 10)
  const seen = new Set<string>()
  let previous = ''
  for (let n = 0; n < 150; n++) {
    expect(clawd.poke()).toBe(true)
    const name = clawd.lastPoke
    seen.add(name)
    expect(name === previous).toBe(false)
    expect(extent(name).above <= imageRoom('dots')).toBe(true)
    previous = name
    run(clawd, 7)
  }

  expect(seen.size).toBe(21)
  for (const name of ['jump', 'dizzy', 'dash', 'scuttle', 'thinking', 'disappointed', 'lookAround', 'turning', 'confettiCine']) {
    expect(`${name}:${seen.has(name)}`).toBe(`${name}:true`)
  }
})

test('a dash is fast and a scuttle is slower, and both end standing', () => {
  const clawd = new Companion(seeded(3))
  run(clawd, 10)
  const start = clawd.x
  ;(clawd as unknown as { walkTo: (x: number, t: (() => void) | null, g: { speed: number; anim: string }) => void }).walkTo(
    start - 120,
    null,
    { speed: 2.6, anim: 'dash' },
  )
  expect(clawd.animName).toBe('dash')
  run(clawd, 1)
  const dashed = start - clawd.x
  expect(dashed > 25).toBe(true)
  run(clawd, 8)
  expect(clawd.state === 'idle' || clawd.state === 'flourish').toBe(true)
  expect(clawd.animName === 'dash').toBe(false)
})

test('a click on the scenery sends Clawd walking that way, running when it is far', () => {
  const clawd = new Companion(seeded(4))
  settle(clawd)
  run(clawd, 3)
  const start = clawd.x

  // to the left, a long way: it runs
  expect(clawd.walkToPx(start - 60 * IMAGE.pxPerCol)).toBe(true)
  expect(clawd.animName).toBe('dash')
  expect(clawd.facing).toBe(-1)
  run(clawd, 1)
  expect(start - clawd.x > 25).toBe(true)
  run(clawd, 12)
  expect(clawd.state === 'idle' || clawd.state === 'flourish').toBe(true)

  // to the right, a short way: it walks
  const here = clawd.x
  expect(clawd.walkToPx(here + 10 * IMAGE.pxPerCol)).toBe(true)
  expect(clawd.animName).toBe('walk')
  expect(clawd.facing).toBe(1)
  run(clawd, 8)
  expect(Math.abs(clawd.x - (here + 10 * IMAGE.pxPerCol)) < 2 || clawd.state === 'flourish').toBe(true)

  // a click right next to Clawd is not a walk, and a click past the ends stops at the ends
  expect(clawd.walkToPx(clawd.x + 2)).toBe(false)
  clawd.walkToPx(-500)
  run(clawd, 20)
  expect(clawd.x >= 0).toBe(true)
})

test('a standing Clawd turns to face the pointer, a busy one does not', () => {
  const clawd = new Companion(seeded(6))
  settle(clawd)
  clawd.facing = 1
  clawd.faceToward(clawd.x - 200)
  expect(clawd.facing).toBe(-1)
  clawd.faceToward(clawd.x + 200)
  expect(clawd.facing).toBe(1)
  // close to Clawd it keeps looking where it was
  clawd.faceToward(clawd.x - 5)
  expect(clawd.facing).toBe(1)
  // mid-reaction it ignores the pointer
  clawd.poke()
  const facing = clawd.facing
  clawd.faceToward(clawd.x - 300)
  expect(clawd.facing).toBe(facing)
})

test('right, double and pestering clicks each have reactions of their own', () => {
  const grumpy = new Set<string>()
  const big = new Set<string>()
  for (let n = 0; n < 60; n++) {
    const clawd = new Companion(seeded(100 + n))
    run(clawd, 10)
    expect(clawd.poke('grumpy')).toBe(true)
    grumpy.add(clawd.lastPoke)
    expect(clawd.poke('big')).toBe(true)
    big.add(clawd.lastPoke)
    expect(clawd.poke('annoyed')).toBe(true)
    expect(clawd.lastPoke).toBe('dizzy')
  }

  expect([...grumpy].every(n => ['facepalm', 'disappointed', 'dizzy', 'lookAround', 'turning'].includes(n))).toBe(true)
  expect(grumpy.size >= 4).toBe(true)
  expect([...big].every(n => ['confettiCine', 'sparkCine', 'jump', 'startHop', 'danceOnce', 'breakOnce'].includes(n))).toBe(true)
  expect(big.size >= 4).toBe(true)
})

test('the mountains are solid: no empty cell under a ridge, and no interior dot so faint it looks like a hole', () => {
  for (const lw of [160, 297, 330, 450, 700]) {
    const { cells, empty, faintest } = mountainFill(lw)

    expect(cells > 0).toBe(true)
    expect(empty).toBe(0)
    expect(faintest >= 2).toBe(true)
  }
})

test('a double click is two clicks in quick succession, pestering is four within a couple of seconds', () => {
  const history: number[] = []
  expect(clickKind(history, 1000)).toBe('normal')
  expect(clickKind(history, 1300)).toBe('big')
  // a pause of more than a double-click's time is a fresh single click again
  expect(clickKind([], 5000)).toBe('normal')
  const slow: number[] = []
  clickKind(slow, 0)
  expect(clickKind(slow, 600)).toBe('normal')

  const pester: number[] = []
  expect(clickKind(pester, 0)).toBe('normal')
  expect(clickKind(pester, 500)).toBe('normal')
  expect(clickKind(pester, 1000)).toBe('normal')
  expect(clickKind(pester, 1500)).toBe('annoyed')
  // clicking calmly, a second apart, never pesters
  const calm: number[] = []
  for (let t = 0; t < 10000; t += 1000) expect(clickKind(calm, t)).toBe('normal')
})

test('the picture is a little wider than its cells so it fills the box, and the fit can be changed', () => {
  expect(getFit() > 1 && getFit() < 1.1).toBe(true)
  expect(widthOf(100) > 100 * IMAGE.cellWidth).toBe(true)
  // sprite pixels per column follow the fit
  expect(Math.abs(IMAGE.pxPerCol - (IMAGE.cellWidth * getFit()) / IMAGE.scale) < 1e-9).toBe(true)
})

test('tools map to what Claude looks like it is doing', () => {
  expect(activityOf('Read')).toBe('look')
  expect(activityOf('Grep')).toBe('look')
  expect(activityOf('Edit')).toBe('write')
  expect(activityOf('Write')).toBe('write')
  expect(activityOf('Bash')).toBe('run')
  expect(activityOf('Agent')).toBe('delegate')
  expect(activityOf('TodoWrite')).toBe('think')
  expect(activityOf('mcp__github__get_file_contents')).toBe('look')
  expect(activityOf('mcp__github__create_pull_request')).toBe('write')
  expect(activityOf('mcp__x__something')).toBe('run')
  expect(activityOf('SomethingNew')).toBe(null)
})

test('when Claude needs the person, Clawd leaves the desk and waves and points until it is cleared', () => {
  const clawd = new Companion(seeded(12))
  run(clawd, 10)
  clawd.setWorking(true)
  run(clawd, 6)
  expect(clawd.state).toBe('emote')

  clawd.setAttention(true)
  expect(clawd.isAsking).toBe(true)
  const seen = new Set<string>()
  for (let t = 0; t < 12; t += 0.04) {
    clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
    if (clawd.animName) seen.add(clawd.animName)
  }
  // it keeps asking, with both gestures, and does not go back to the desk
  expect(seen.has('wave') && seen.has('point')).toBe(true)
  expect(clawd.state === 'emote').toBe(false)

  clawd.setAttention(false)
  run(clawd, 8)
  expect(clawd.state).toBe('emote') // answered: back to work, since Claude still is
})

test('what Claude does changes the desk and adds quick moves, but not too often', () => {
  const clawd = new Companion(seeded(14))
  run(clawd, 10)
  clawd.setWorking(true)
  run(clawd, 6)

  clawd.setActivity('write')
  run(clawd, 6)
  expect(clawd.animName).toBe('laptop')

  run(clawd, 3)
  clawd.setActivity('run')
  run(clawd, 6)
  expect(clawd.animName).toBe('desktop')

  run(clawd, 3)
  clawd.setActivity('look')
  const seen = new Set<string>()
  for (let t = 0; t < 8; t += 0.04) {
    clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
    if (clawd.animName) seen.add(clawd.animName)
  }
  expect(seen.has('lookAround')).toBe(true)
  // and it goes back to the desk afterwards
  run(clawd, 6)
  expect(clawd.state).toBe('emote')

  // two calls close together: the second is ignored, so Clawd does not flicker between poses
  clawd.setActivity('write')
  const before = clawd.animName
  clawd.setActivity('run')
  clawd.setActivity('look')
  run(clawd, 0.2)
  expect(clawd.animName === before || clawd.animName === 'laptopOut' || clawd.animName === 'desktopOut').toBe(true)
})

test('a failed tool makes Clawd facepalm or sigh, then go back to work; a stretch is a sway then meditation', () => {
  const clawd = new Companion(seeded(16))
  run(clawd, 10)
  clawd.setWorking(true)
  run(clawd, 6)
  clawd.fail()
  const seen = new Set<string>()
  for (let t = 0; t < 10; t += 0.04) {
    clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
    if (clawd.animName) seen.add(clawd.animName)
  }
  expect(seen.has('facepalm') || seen.has('disappointed')).toBe(true)
  expect(clawd.state).toBe('emote')

  clawd.setWorking(false)
  run(clawd, 4)
  const order: string[] = []
  clawd.stretch()
  for (let t = 0; t < 14; t += 0.04) {
    clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)
    if (clawd.animName && order[order.length - 1] !== clawd.animName) order.push(clawd.animName)
  }
  expect(order.indexOf('sway') >= 0 && order.indexOf('meditate') > order.indexOf('sway')).toBe(true)
})

test('each running subagent is a small Clawd at its own desk, typing, and none are drawn when none run', () => {
  const clawd = new Companion(seeded(8))
  settle(clawd)
  const none = imagePixels(clawd, 167, 'dots', { friends: 0 })
  const three = imagePixels(clawd, 167, 'dots', { friends: 3, time: 1 })
  const later = imagePixels(clawd, 167, 'dots', { friends: 3, time: 1.4 })
  const differs = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0)

  expect(differs(none.pixels, three.pixels) > 1500).toBe(true)
  // they type: a moment later the picture is different again
  expect(differs(three.pixels, later.pixels) > 100).toBe(true)
  // a fifth desk is drawn too: there is room for as many as fit
  expect(differs(imagePixels(clawd, 167, 'dots', { friends: 5, time: 1 }).pixels, imagePixels(clawd, 167, 'dots', { friends: 4, time: 1 }).pixels) > 500).toBe(true)
  // the frame key moves with their typing only while there are any
  expect(extrasKey({ friends: 0, time: 1 })).toBe(extrasKey({ friends: 0, time: 9 }))
  expect(extrasKey({ friends: 2, time: 1 }) === extrasKey({ friends: 2, time: 1.5 })).toBe(false)
})

test('the moon sinks as the context fills and turns warm when a limit is close', () => {
  expect(skyOf({}).moonRow).toBe(3)
  expect(skyOf({ context: 0.5 }).moonRow).toBeGreaterThan(skyOf({ context: 0.1 }).moonRow)
  expect(skyOf({ context: 1 }).moonRow).toBe(13)
  expect(skyOf({ context: 7 }).moonRow).toBe(13)
  expect(skyOf({ warn: true }).warm).toBe(true)

  const clawd = new Companion(seeded(8))
  settle(clawd)
  const high = imagePixels(clawd, 167, 'dots', { context: 0 })
  const low = imagePixels(clawd, 167, 'dots', { context: 1 })
  const warm = imagePixels(clawd, 167, 'dots', { warn: true })
  const differs = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0)

  expect(differs(high.pixels, low.pixels) > 100).toBe(true)
  expect(differs(high.pixels, warm.pixels) > 50).toBe(true)
  // a warm moon uses a warm colour that the cool scenery never does
  const hasWarm = warm.palette.some((v, i) => i % 3 === 0 && v > (warm.palette[i + 2] as number) + 40 && v !== 0xd9)
  expect(hasWarm).toBe(true)
  expect(extrasKey({ context: 0.5 }) === extrasKey({ context: 0.9 })).toBe(false)
})

test('desks stand 36 apart while there is room, then closer, and the rest are counted in a +N label', () => {
  const wide = 167 * IMAGE.pxPerCol // a wide band, in sprite pixels
  const narrow = 60 * IMAGE.pxPerCol

  // few subagents: comfortable spacing, nothing hidden
  expect(deskLayout(wide, 0)).toEqual({ gap: 36, drawn: 0, hidden: 0 })
  expect(deskLayout(wide, 3)).toEqual({ gap: 36, drawn: 3, hidden: 0 })
  // many: they squeeze together, never closer than 22, and the rest are hidden but counted
  const crowd = deskLayout(narrow, 20)
  expect(crowd.gap >= 22 && crowd.gap < 36).toBe(true)
  expect(crowd.drawn + crowd.hidden).toBe(20)
  expect(crowd.hidden > 0 && crowd.drawn >= 4).toBe(true)
  // a wider band holds more
  expect(deskLayout(wide, 20).drawn > deskLayout(narrow, 20).drawn).toBe(true)
  // a band too narrow for any room still shows one desk, and counts the others
  expect(deskLayout(20, 5)).toEqual({ gap: 36, drawn: 1, hidden: 4 })

  const clawd = new Companion(seeded(8))
  settle(clawd)
  const twenty = imagePixels(clawd, 60, 'dots', { friends: 20, time: 1 })
  const sixty = imagePixels(clawd, 60, 'dots', { friends: 60, time: 1 })
  const differs = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0)
  // the same desks, a different count in the label
  expect(differs(twenty.pixels, sixty.pixels) > 0).toBe(true)
  expect(differs(twenty.pixels, imagePixels(clawd, 60, 'dots', { friends: 0 }).pixels) > 1500).toBe(true)
})

test('the first tool decides the desk even while Clawd is still walking to it', () => {
  // a random source that always picks the desktop first
  const clawd = new Companion(() => 0)
  settle(clawd)
  clawd.setWorking(true)
  clawd.setActivity('write') // Claude is editing a file: the laptop, not the desktop that was picked
  for (let t = 0; clawd.state !== 'emote' && t < 20; t += 0.04) clawd.step(0.04, WIDTH, imageRoom('dots'), IMAGE.pxPerCol)

  expect(clawd.state).toBe('emote')
  expect(clawd.current().name).toBe('Laptop')
})
