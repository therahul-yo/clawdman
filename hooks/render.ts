import { sprite } from './engine'
import type { Companion } from './engine'
import { renderBubble } from './font'
import { encodeIndexedPng } from './png'

const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += abc[a >> 2]
    out += abc[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : abc[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : abc[c & 63]
  }
  return out
}

// ---------------------------------------------------------------------------
// Pixels, for terminals that draw pictures (kitty graphics: Ghostty, kitty, ...)
//
// The whole band is one picture, four cell rows tall: a pixel-art landscape
// with Clawd standing on its ground. A cell is taken as 16 x 36 picture pixels
// (about the 1 : 2.2 of a terminal font) and one sprite pixel as 3 x 3 of them,
// so the landscape is drawn at the same pixel size as Clawd. The picture is
// scaled down by the terminal, so a coarser picture costs nothing in looks and
// keeps every frame small. The picture is an
// indexed PNG: flat colours and repeats, a few KB a frame.

// A terminal fits the picture into its box of cells by height, so a picture with the
// same shape as the cells would still come out a little narrower than the box and
// sit in from both edges. The picture is made this much wider than its cells to fill
// the box edge to edge; it depends on the font's shape, so `/clawdman fit` can change it.
let fit = 1.035
export const getFit = (): number => fit
export const setFit = (value: number): void => {
  fit = Math.min(1.2, Math.max(0.9, value))
}

export const IMAGE = {
  scale: 3,
  cellWidth: 16,
  cellHeight: 36,
  rows: 4,
  /** the most columns one picture spans */
  maxColumns: 250,
  /** columns kept clear at the right: Claude Code draws its own [-] control there */
  rightMargin: 6,
  /** picture pixels from the bottom edge up to the top of the ground, where Clawd's feet rest */
  pad: 9,
  /** sprite pixels in a cell, across: follows the fit */
  get pxPerCol(): number {
    return (this.cellWidth * fit) / this.scale
  },
  /** sprite pixels in a cell, down */
  pxPerRow: 36 / 3,
} as const

const WIDTH_PX = (columns: number) => Math.round(imageColumns(columns) * IMAGE.cellWidth * fit)
const HEIGHT_PX = IMAGE.rows * IMAGE.cellHeight

export type SceneStyle = 'dots' | 'pixels'

/** Picture pixels from the bottom edge up to the top of the ground, where Clawd's feet rest. */
export const padOf = (style: SceneStyle): number => (style === 'dots' ? 18 : IMAGE.pad)

/** Sprite pixels above the feet the picture can show. */
export const imageRoom = (style: SceneStyle): number => (HEIGHT_PX - padOf(style)) / IMAGE.scale

/** Columns the picture spans. */
export const imageColumns = (columns: number): number => Math.min(columns, IMAGE.maxColumns)

/** Columns Clawd can walk along: the band less the margin Claude Code keeps for its own control. */
export const walkColumns = (columns: number): number => Math.max(12, imageColumns(columns) - IMAGE.rightMargin)

// The picture's palette: entry 0 is transparent, the rest are added as colours turn up.
const paletteColors: number[] = [0]
const paletteIndex = new Map<number, number>()
const indexOfColor = (rgb: number): number => {
  let index = paletteIndex.get(rgb)
  if (index === undefined) {
    index = paletteColors.length
    paletteColors.push(rgb)
    paletteIndex.set(rgb, index)
  }

  return index
}

const hash = (n: number): number => {
  let h = Math.imul(n + 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)

  return (h ^ (h >>> 16)) >>> 0
}


// The landscape, in sprite pixels (SH rows tall, the ground at the bottom). A muted
// night palette, so that Clawd's orange is the one warm thing in it.
const SH = HEIGHT_PX / IMAGE.scale // 36
const GROUND_TOP = SH - IMAGE.pad / IMAGE.scale // 33

const COLORS = {
  skyTop: 0x090d19,
  skyMid: 0x0f1526,
  skyLow: 0x172038,
  skyGlow: 0x202c4a,
  farMountain: 0x1b2339,
  farMountainDark: 0x151b2d,
  flower: 0x9a8b52,
  star: 0x59617a,
  moon: 0xe4dba6,
  moonShade: 0xc2b985,
  cloud: 0x46536a,
  cloudTop: 0x5d6e8a,
  cloudBottom: 0x38445a,
  mountainLit: 0x28324a,
  mountainDark: 0x1c2438,
  snow: 0x4a5a7c,
  hill: 0x2c3a4c,
  hillRim: 0x3d5068,
  pine: 0x1f3d2e,
  pineLit: 0x2b5240,
  trunk: 0x44332a,
  grass: 0x4a6d4d,
  soil: 0x2a342d,
  soilDot: 0x38453b,
} as const

/** Paints the landscape into `grid` (palette index per sprite pixel, `sw` wide). */
function paintScene(grid: Uint8Array, sw: number): void {
  const put = (x: number, y: number, color: number) => {
    if (x >= 0 && x < sw && y >= 0 && y < SH) grid[y * sw + x] = indexOfColor(color)
  }

  // sky: a night gradient in four dithered bands, stars, a moon now and then, clouds
  const bands = [COLORS.skyTop, COLORS.skyMid, COLORS.skyLow, COLORS.skyGlow]
  for (let y = 0; y < GROUND_TOP; y++) {
    const at = (y / GROUND_TOP) * (bands.length - 1)
    const lower = Math.floor(at)
    const mix = at - lower
    for (let x = 0; x < sw; x++) {
      // dither between two bands so the steps are soft
      const useUpper = mix > 0.5 ? (x + y) % 2 === 0 || mix > 0.8 : (x + y) % 2 === 0 && mix > 0.25
      put(x, y, bands[useUpper ? Math.min(bands.length - 1, lower + 1) : lower] as number)
    }
  }
  for (let x = 0; x < sw; x++) {
    for (let y = 0; y < 13; y++) {
      const h = hash(x * 31 + y * 7919)
      if (h % 173 === 0) put(x, y, COLORS.star)
    }
  }
  for (let slot = 0; slot * 400 < sw + 400; slot++) {
    const h = hash(slot * 11 + 5)
    if (h % 2 === 0) continue
    const cx = slot * 400 + 40 + ((h >>> 3) % 250)
    for (let y = -5; y <= 5; y++) {
      for (let x = -5; x <= 5; x++) {
        const d = x * x + y * y
        if (d <= 12) put(cx + x, 7 + y, x + y * 0.6 > 1.2 ? COLORS.moonShade : COLORS.moon)
      }
    }
  }
  for (let slot = 0; slot * 72 < sw + 72; slot++) {
    const h = hash(slot * 7 + 3)
    if (h % 10 >= 6) continue
    const cx = slot * 72 + 18 + ((h >>> 5) % 34)
    const cy = 5 + ((h >>> 11) % 5)
    const rx = 9 + ((h >>> 13) % 7)
    const puffs = [
      [cx, cy, rx, 2.6],
      [cx - rx * 0.55, cy + 0.6, rx * 0.5, 2.0],
      [cx + rx * 0.5, cy + 0.9, rx * 0.55, 2.2],
    ] as const
    for (const [px, py, prx, pry] of puffs) {
      for (let y = Math.floor(py - pry); y <= Math.ceil(py + pry); y++) {
        for (let x = Math.floor(px - prx); x <= Math.ceil(px + prx); x++) {
          if (((x - px) / prx) ** 2 + ((y - py) / pry) ** 2 > 1) continue
          if (y > cy + 2) continue // a flat bottom
          put(x, y, y <= cy - 2 ? COLORS.cloudTop : y >= cy + 2 ? COLORS.cloudBottom : COLORS.cloud)
        }
      }
    }
  }

  // a far range, paler and taller, so the sky has depth
  const far = (x: number) => Math.round(11 + 9 * (1 - Math.abs(Math.sin(x * 0.012 + 2))) ** 1.4)
  for (let x = 0; x < sw; x++) {
    const top = GROUND_TOP - far(x)
    const lit = far(x + 4) >= far(x - 4)
    for (let y = top; y < GROUND_TOP; y++) put(x, y, lit ? COLORS.farMountain : COLORS.farMountainDark)
  }

  // mountains: sharp peaks, a lit slope and a shaded one, snow on the tall ones
  const peak = (x: number) =>
    Math.round(
      6 + 11 * (1 - Math.abs(Math.sin(x * 0.019 + 0.5))) ** 1.3 + 3 * (1 - Math.abs(Math.sin(x * 0.057 + 1.9))),
    )
  for (let x = 0; x < sw; x++) {
    const height = peak(x)
    // judged over a few pixels either side, so a flat top does not flicker between the two
    const lit = peak(x + 3) >= peak(x - 3)
    const top = GROUND_TOP - height
    for (let y = top; y < GROUND_TOP; y++) {
      put(x, y, height > 14 && y < top + 3 ? COLORS.snow : lit ? COLORS.mountainLit : COLORS.mountainDark)
    }
  }

  // near hills: slow rolling curves with a lighter rim
  const roll = (x: number) => Math.round(4 + 2.2 * Math.sin(x * 0.045 + 1) + 1.3 * Math.sin(x * 0.13))
  for (let x = 0; x < sw; x++) {
    const top = GROUND_TOP - roll(x)
    for (let y = top; y < GROUND_TOP; y++) put(x, y, y === top ? COLORS.hillRim : COLORS.hill)
  }

  // pines, in front of the hills
  const SLOT = 17
  for (let slot = 0; slot * SLOT < sw + SLOT; slot++) {
    const h = hash(slot * 13 + 1)
    if (h % 20 >= 14) continue
    const cx = slot * SLOT + 4 + ((h >>> 9) % 9)
    const height = 11 + ((h >>> 14) % 6)
    const top = GROUND_TOP - height
    for (let dy = 0; dy < height - 2; dy++) {
      const half = Math.min(5, Math.floor(dy * 0.45) + (dy % 3 === 2 ? 1 : 0))
      for (let x = cx - half; x <= cx + half; x++) put(x, top + dy, x <= cx - 1 ? COLORS.pineLit : COLORS.pine)
    }
    for (let dy = height - 2; dy < height; dy++) {
      put(cx, top + dy, COLORS.trunk)
      put(cx + 1, top + dy, COLORS.trunk)
    }
  }

  // the ground: a grass line over dark soil
  for (let x = 0; x < sw; x++) {
    put(x, GROUND_TOP, hash(x * 5 + 2) % 29 === 0 ? COLORS.flower : COLORS.grass)
    for (let y = GROUND_TOP + 1; y < SH; y++) put(x, y, (x + y) % 4 === 0 ? COLORS.soilDot : COLORS.soil)
  }
}

// ---------------------------------------------------------------------------
// The dotted landscape, after the Clawd game on claude.dev: round dots on a
// fixed grid, brighter and bigger where a shape is dense, on the page's dark
// backing. Everything is fixed: hills, trees, clouds, a crescent moon and the
// ground. The dots are big (a terminal shows the picture at about
// 0.7 of its size, and fine dots turn into grey noise).

const PITCH = 9 // picture pixels between dots; Clawd is 8 dots wide
const LATTICE_ROWS = HEIGHT_PX / PITCH // 16
const GROUND_ROW = LATTICE_ROWS - 2 // the first of two ground rows
const BACKING = 0x141414 // the claude.dev page's own dark grey
// A bit under full strength, so the scenery stays behind Clawd.
const SCENERY_OPACITY = 0.78
const DOT_GREYS = [
  ...[0, 0x303030, 0x414141, 0x585858, 0x727272, 0x8e8e8e, 0xa9a9a9, 0xc8c8c8].map(g => {
    const v = Math.round((g & 255) * SCENERY_OPACITY + 0x14 * (1 - SCENERY_OPACITY)) // blended toward the backing
    return g === 0 ? 0 : (v << 16) | (v << 8) | v
  }),
  0xb87a3e, // level 8: a warm dot, for the moon when a limit is close
]
const WARM = 8
const FULL = 8 // the brightest dot

// round dots of 4 to 7 pixels, as offsets inside their box
const DISCS: Record<number, [number, number][]> = {}
for (const d of [4, 5, 6, 7]) {
  const cells: [number, number][] = []
  const c = (d - 1) / 2
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) if (Math.hypot(x - c, y - c) <= d / 2 - 0.15) cells.push([x, y])
  }
  DISCS[d] = cells
}
const diameterOf = (v: number): number => (v <= 1 ? 4 : v <= 3 ? 5 : v <= 5 ? 6 : 7)

const rnd = (x: number, y: number, salt: number): number => hash(((((x % 97) + 97) % 97) * 7919 + y * 104729 + salt * 15485863) | 0)

function drawDot(pixels: Uint8Array, width: number, cell: number, row: number, v: number): void {
  const d = diameterOf(v)
  const index = indexOfColor(DOT_GREYS[Math.min(FULL, Math.max(1, v))] as number)
  const x0 = cell * PITCH + Math.floor((PITCH - d) / 2)
  const y0 = row * PITCH + Math.floor((PITCH - d) / 2)
  for (const [dx, dy] of DISCS[d] as [number, number][]) {
    const x = x0 + dx
    if (x >= 0 && x < width) pixels[(y0 + dy) * width + x] = index
  }
}

const sharp = (x: number, scale: number, shift: number): number => 1 - Math.abs(Math.sin(x * scale + shift))

const mountainRaw = (x: number): number =>
  Math.max(3, Math.min(10, Math.round(3 + 6 * sharp(x, 0.052, 0.9) ** 1.15 + 2 * sharp(x, 0.15, 2.1) ** 1.5)))

/** Rows of mountain above the ground at dot column `x`: sharp peaks (3 to 10), with no one-column dips between them. */
const mountain = (x: number): number => Math.max(mountainRaw(x), Math.min(mountainRaw(x - 1), mountainRaw(x + 1)))

/** For tests: how many dot cells lie under the mountains, how many of them are empty, and the dimmest dot among them. */
export function mountainFill(lw: number): { cells: number; empty: number; faintest: number } {
  const lattice = new Uint8Array(lw * LATTICE_ROWS)
  paintDots(lattice, lw)
  let cells = 0
  let empty = 0
  let faintest = FULL
  for (let x = 0; x < lw; x++) {
    for (let y = GROUND_ROW - mountain(x); y < GROUND_ROW; y++) {
      cells += 1
      const v = lattice[y * lw + x] as number
      if (v === 0) empty += 1
      else faintest = Math.min(faintest, v)
    }
  }

  return { cells, empty, faintest }
}

/** Rows of rolling hill above the ground at dot column `x` (1 to 3). */
const hill = (x: number): number =>
  Math.max(1, Math.min(3, Math.round(2 + 1.3 * Math.sin(x * 0.05 + 1.3) + 0.8 * Math.sin(x * 0.13))))

/**
 * What the sky shows: the moon at night or the sun by day (and low at dusk and dawn, with stars),
 * sinking as the context fills, and warm when a limit is close.
 */
export type Sky = { moonRow: number; warm: boolean; body: 'moon' | 'sun'; stars: boolean }
export const DEFAULT_SKY: Sky = { moonRow: 3, warm: false, body: 'moon', stars: true }

/** The git village: a house for each staged and each changed file. */
export type Village = { staged: number; changed: number }
const MAX_HOUSES = 24

const TREE_SLOT = 46
const HOUSE_WIDTH = 7
const HOUSE_SLOT = 22

/** The dot columns trees stand in, for a band `lw` dots wide. */
function treeColumns(lw: number): number[] {
  const trees: number[] = []
  for (let slot = 0; slot * TREE_SLOT < lw + TREE_SLOT; slot++) {
    const h = hash(slot * 13 + 1)
    if (h % 100 < 72) trees.push(slot * TREE_SLOT + 9 + ((h >>> 8) % 28))
  }

  return trees
}

/**
 * Where the moon hangs: the spot on the left with the lowest mountains and hills
 * and no tree near, so there is clear sky and open space under it.
 */
export function moonColumn(lw: number): number {
  const trees = treeColumns(lw)
  let best = Infinity
  let found = 16
  for (let x = 14; x < Math.min(lw - 8, 150); x++) {
    let tallest = 0
    for (let k = -6; k <= 6; k++) tallest = Math.max(tallest, mountain(x + k) + hill(x + k))
    const score = tallest + (trees.some(t => Math.abs(t - x) < 9) ? 20 : 0)
    if (score < best) {
      best = score
      found = x
    }
  }

  return found
}

/** Rows of mountain and hill at a dot column, for tests. */
export const terrainAt = (x: number): { mountain: number; hill: number } => ({ mountain: mountain(x), hill: hill(x) })

/**
 * Where the houses stand, as dot columns. Spread out in slots that dodge the trees and the moon; when
 * that leaves fewer places than files (many files, or a narrow band), they stand closer, trees or not.
 */
function houseColumns(lw: number, count: number, moon: number): number[] {
  const trees = treeColumns(lw)
  const place = (gap: number, isCrowded: boolean): number[] => {
    const xs: number[] = []
    let lastEnd = -99
    for (let slot = 0; xs.length < count && 16 + slot * gap + HOUSE_WIDTH < lw - 4; slot++) {
      let x = 16 + slot * gap
      if (!isCrowded) {
        for (let tries = 0; tries < 3 && trees.some(t => Math.abs(t - (x + 3)) < 7); tries++) x += 8
        if (Math.abs(x + 3 - moon) < 9 || trees.some(t => Math.abs(t - (x + 3)) < 7)) continue
      }
      if (x < lastEnd + (isCrowded ? 2 : 4)) continue
      lastEnd = x + HOUSE_WIDTH
      xs.push(x)
    }

    return xs
  }
  const spread = place(HOUSE_SLOT, false)
  if (spread.length >= count) return spread
  // closer: as wide a gap as lets them all in, never closer than two dots apart
  const room = lw - 4 - 16 - HOUSE_WIDTH
  const gap = Math.max(HOUSE_WIDTH + 2, Math.min(HOUSE_SLOT, Math.floor(room / Math.max(1, count - 1))))
  const close = place(gap, true)

  return close.length > spread.length ? close : spread
}

/** The whole fixed scenery as a lattice of dot brightnesses (0 is no dot). Each layer is solid and a step brighter than the one behind. */
function paintDots(lattice: Uint8Array, lw: number, sky: Sky = DEFAULT_SKY, village?: Village): void {
  const at = (x: number, y: number, v: number) => {
    if (x >= 0 && x < lw && y >= 0 && y < LATTICE_ROWS) lattice[y * lw + x] = v
  }
  const filled = (x: number, y: number) => x >= 0 && x < lw && y >= 0 && y < LATTICE_ROWS && (lattice[y * lw + x] as number) !== 0

  const moon = lw > 80 ? moonColumn(lw) : -999

  // stars, not by day
  for (let x = 0; sky.stars && x < lw; x++) {
    for (let y = 0; y < 7; y++) if (rnd(x, y, 1) % 47 === 0 && Math.abs(x - moon) > 6) at(x, y, 2)
  }

  // clouds: soft solid shapes, with a brighter middle
  const CLOUD = 26
  for (let slot = 0; slot * CLOUD < lw + CLOUD; slot++) {
    const h = hash(slot * 17 + 9)
    if (h % 100 >= 70) continue
    const rx = 5 + ((h >>> 5) % 4)
    const cy = 1.7 + ((h >>> 11) % 3) * 0.8
    const ry = 1.3 + ((h >>> 17) % 2) * 0.3
    const cx = slot * CLOUD + 6 + ((h >>> 21) % 12)
    // keep the sky around the moon clear
    if (Math.abs(cx - moon) < rx + 8) continue
    const puffs = [
      [cx, cy, rx, ry],
      [cx - rx * 0.5, cy + 0.5, rx * 0.5, ry * 0.8],
      [cx + rx * 0.45, cy + 0.5, rx * 0.55, ry * 0.85],
    ] as const
    for (let y = 0; y < 6; y++) {
      for (let x = Math.floor(cx - rx * 1.1); x <= Math.ceil(cx + rx * 1.1); x++) {
        let m = 9
        for (const [px, py, prx, pry] of puffs) m = Math.min(m, ((x - px) / prx) ** 2 + ((y - py) / pry) ** 2)
        if (m > 1 || y > cy + ry + 0.6) continue
        at(x, y, m < 0.45 ? 4 : 3)
      }
    }
  }

  // the crescent moon at night or a round sun by day, once, over open ground; the cells it takes are
  // kept, because the mountains and hills in front of it cover it as it sinks
  const bodyCells = new Set<number>()
  if (lw > 80) {
    const mx = moon
    const my = sky.moonRow
    for (let y = my - 4; y <= my + 4; y++) {
      for (let x = mx - 5; x <= mx + 5; x++) {
        if (sky.body === 'sun') {
          if (Math.hypot(x - mx, y - my) <= 3.3) {
            at(x, y, WARM)
            bodyCells.add(y * lw + x)
          }
          continue
        }
        const outer = Math.hypot(x - mx, y - my) <= 3.45
        const inner = Math.hypot(x - (mx + 1.9), y - (my - 0.5)) <= 3.0
        if (outer && !inner) {
          at(x, y, sky.warm ? WARM : 7)
          bodyCells.add(y * lw + x)
        }
      }
    }
  }

  // mountains: solid silhouettes with a lit side and a shaded side, brighter along the ridge
  for (let x = 0; x < lw; x++) {
    const height = mountain(x)
    const lit = mountain(x + 2) >= mountain(x - 2)
    const top = GROUND_ROW - height
    for (let y = top; y < GROUND_ROW; y++) {
      const depth = y - top
      // brighter along the ridge, and never fainter than level 2: the faintest dots all but
      // vanish against the backing, which reads as a hole in the mountain
      const level = depth === 0 ? (lit ? 4 : 3) : depth === 1 ? 3 : depth <= 3 ? (lit ? 3 : 2) : 2
      // a mountain is in front of the moon or sun, so it covers them as they sink
      if (!filled(x, y) || bodyCells.has(y * lw + x)) at(x, y, level)
    }
  }

  // rolling hills in front: brighter, with a bright ridge
  for (let x = 0; x < lw; x++) {
    const top = GROUND_ROW - hill(x)
    for (let y = top; y < GROUND_ROW; y++) at(x, y, y === top ? 5 : 3)
  }

  // trees, brighter again, in a steady order: two pines, then a round tree, and so on
  treeColumns(lw).forEach((cx, index) => {
    if (index % 3 !== 2) {
      // a pine: a triangle of dots on a two-dot trunk
      const top = 4 + (hash(cx) % 3)
      for (let y = top; y < 12; y++) {
        const half = Math.floor((y - top) * 0.55)
        for (let x = cx - half; x <= cx + half; x++) at(x, y, x === cx - half ? 6 : 5)
      }
    } else {
      // a round tree
      const cy = 8.2
      for (let y = 5; y <= 11; y++) {
        for (let x = cx - 5; x <= cx + 5; x++) {
          const m = ((x - cx) / 4.8) ** 2 + ((y - cy) / 3.1) ** 2
          if (m <= 1) at(x, y, m > 0.62 ? 5 : 6)
        }
      }
    }
    for (let y = 12; y < GROUND_ROW; y++) {
      at(cx - 1, y, 4)
      at(cx, y, 4)
    }
  })

  // low bushes
  const BUSH = 23
  for (let slot = 0; slot * BUSH < lw + BUSH; slot++) {
    const h = hash(slot * 29 + 7)
    if (h % 100 >= 40) continue
    const cx = slot * BUSH + 4 + ((h >>> 8) % 14)
    for (let x = cx - 2; x <= cx + 2; x++) at(x, GROUND_ROW - 1, 4)
    for (let x = cx - 1; x <= cx + 1; x++) at(x, GROUND_ROW - 2, 5)
  }

  // the ground: two full rows of a steady lattice, no bright specks
  for (let x = 0; x < lw; x++) {
    at(x, GROUND_ROW, 3)
    at(x, GROUND_ROW + 1, 4)
  }

  // close any single empty dot with a dot to its left, right and below (a notch where two layers
  // meet), outside the moon's own sky
  for (let pass = 0; pass < 2; pass++) {
    for (let x = 1; x < lw - 1; x++) {
      for (let y = 4; y < GROUND_ROW; y++) {
        if (Math.abs(x - moon) <= 6 && y <= sky.moonRow + 5) continue
        if (filled(x, y) || !filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y + 1)) continue
        const levels = [lattice[y * lw + x - 1], lattice[y * lw + x + 1], lattice[(y + 1) * lw + x]] as number[]
        at(x, y, Math.max(2, Math.min(...levels)))
      }
    }
  }

  // the village: a small house for each changed file, warm when staged, painted last so
  // its doorway stays open
  const houses = Math.min(MAX_HOUSES, Math.max(0, (village?.staged ?? 0) + (village?.changed ?? 0)))
  if (houses > 0 && lw > 80) {
    const xs = houseColumns(lw, houses, moon)
    for (let placed = 0; placed < xs.length; placed++) {
      const x = xs[placed] as number
      // brighter than all the terrain behind: white for a changed file, warm for a staged one
      const isStaged = placed < (village?.staged ?? 0)
      const wall = isStaged ? WARM : 6
      const roof = 7
      const top = GROUND_ROW - 5
      const rows = ['...R...', '..RRR..', '.RRRRR.', 'WWWWWWW', 'WWW.WWW']
      rows.forEach((row, dy) => {
        for (let dx = 0; dx < HOUSE_WIDTH; dx++) {
          const ch = row[dx]
          if (ch === 'R') at(x + dx, top + dy, roof)
          else if (ch === 'W') at(x + dx, top + dy, wall)
          else if (dy === 4 && ch === '.' && dx === 3) at(x + dx, top + dy, 0)
        }
      })
    }
  }
}

/** The lattice of dots to a picture of palette indices, over the page's dark backing. */
function rasterize(lattice: Uint8Array, lw: number, width: number, into: Uint8Array): void {
  into.fill(indexOfColor(BACKING))
  for (let row = 0; row < LATTICE_ROWS; row++) {
    for (let cell = 0; cell < lw; cell++) {
      const v = lattice[row * lw + cell] as number
      if (v !== 0) drawDot(into, width, cell, row, v)
    }
  }
}

const dotLayers = new Map<string, Uint8Array>()

const layers = new Map<number, Uint8Array>()

/** The solid pixel landscape for a band `columns` wide, as palette indices, one per picture pixel. */
function sceneLayer(columns: number): Uint8Array {
  const width = WIDTH_PX(columns)
  let layer = layers.get(width)
  if (layer) return layer
  layers.clear() // one width at a time; a resize drops the old one
  const sw = Math.ceil(width / IMAGE.scale)
  const grid = new Uint8Array(sw * SH)
  paintScene(grid, sw)
  layer = new Uint8Array(width * HEIGHT_PX)
  for (let y = 0; y < HEIGHT_PX; y++) {
    const gy = Math.floor(y / IMAGE.scale)
    for (let x = 0; x < width; x++) layer[y * width + x] = grid[gy * sw + Math.floor(x / IMAGE.scale)] as number
  }
  layers.set(width, layer)

  return layer
}

export type ImageFrame = {
  key: string
  source: { png: string }
}

/** The dotted landscape, cached for one width and sky at a time. */
function dotsBase(columns: number, sky: Sky, village?: Village): Uint8Array {
  const width = WIDTH_PX(columns)
  const key = `${width}:${skyKey(sky)}:${villageKey(village)}`
  let base = dotLayers.get(key)
  if (!base) {
    dotLayers.clear()
    const lw = Math.ceil(width / PITCH)
    const lattice = new Uint8Array(lw * LATTICE_ROWS)
    paintDots(lattice, lw, sky, village)
    base = new Uint8Array(width * HEIGHT_PX)
    rasterize(lattice, lw, width, base)
    dotLayers.set(key, base)
  }

  return base
}

export type BubbleTone = 'plain' | 'ask' | 'warn'

/** What the picture shows besides Clawd and the fixed scenery. */
export type Extras = {
  /** subagents running: a small Clawd at its own desk for each, up to four */
  friends?: number
  /** seconds, for the friends' typing */
  time?: number
  /** how full the context window is, 0 to 1 */
  context?: number
  /** a rate limit is close */
  warn?: boolean
  /** the local time of day in hours, 0 to 24; unset is night */
  hour?: number
  /** a house for each changed file in the repo */
  village?: Village
  /** a few words above Clawd */
  bubble?: { text: string; tone?: BubbleTone }
}

const MAX_FRIENDS = 64
const DESK_START = 14 // sprite pixels from the left to the first desk
const DESK_GAP = 36 // between desks, when there is room
const DESK_MIN_GAP = 22 // the closest they stand: a little overlapped, still a row of desks

/**
 * How the subagents' desks are laid out along the left of a picture `spriteWidth` sprite pixels wide.
 * They take up to just over half of it, standing 36 apart when they can and as close as 22 when they
 * must; any beyond that are counted in a "+N" label instead.
 */
export function deskLayout(spriteWidth: number, count: number): { gap: number; drawn: number; hidden: number } {
  const n = Math.max(0, Math.floor(count))
  const span = Math.max(0, Math.floor(spriteWidth * 0.55) - DESK_START)
  const fits = Math.max(1, Math.floor(span / DESK_MIN_GAP) + 1)
  const drawn = Math.min(n, fits, MAX_FRIENDS)
  const gap = drawn <= 1 ? DESK_GAP : Math.max(DESK_MIN_GAP, Math.min(DESK_GAP, Math.floor(span / (drawn - 1))))

  return { gap, drawn, hidden: n - drawn }
}

/** Night, or day (sun, no stars), or dusk and dawn (a low sun with stars). */
export function phaseOf(hour: number | undefined): 'night' | 'day' | 'dusk' {
  if (hour === undefined) return 'night'
  if (hour >= 7 && hour < 17) return 'day'
  if ((hour >= 17 && hour < 19.5) || (hour >= 5 && hour < 7)) return 'dusk'

  return 'night'
}

export const skyOf = (extras: Extras): Sky => {
  const phase = phaseOf(extras.hour)
  const sunk = Math.round(Math.min(1, Math.max(0, extras.context ?? 0)) * 10)

  return {
    moonRow: Math.min(13, DEFAULT_SKY.moonRow + sunk + (phase === 'dusk' ? 3 : 0)),
    warm: extras.warn === true,
    body: phase === 'night' ? 'moon' : 'sun',
    stars: phase !== 'day',
  }
}

const skyKey = (sky: Sky): string => `${sky.moonRow}${sky.warm ? 'w' : ''}${sky.body === 'sun' ? 's' : ''}${sky.stars ? '' : 'x'}`

const villageOf = (village: Village | undefined): Village | undefined => {
  const houses = (village?.staged ?? 0) + (village?.changed ?? 0)
  if (!village || houses <= 0) return undefined
  const staged = Math.min(MAX_HOUSES, Math.max(0, village.staged))

  return { staged, changed: Math.min(MAX_HOUSES - staged, Math.max(0, village.changed)) }
}

const villageKey = (village: Village | undefined): string => {
  const v = villageOf(village)

  return v ? `${v.staged}.${v.changed}` : ''
}

/** The part of a frame key that the extras decide. */
export function extrasKey(extras: Extras): string {
  const friends = Math.min(MAX_FRIENDS * 2, Math.max(0, Math.floor(extras.friends ?? 0)))
  const bubble = extras.bubble ? `${extras.bubble.tone ?? 'plain'}|${extras.bubble.text}` : ''

  return `${friends}:${friends > 0 ? Math.floor((extras.time ?? 0) * 12) : 0}:${skyKey(skyOf(extras))}:${villageKey(extras.village)}:${bubble}`
}

const BUBBLE_COLORS: Record<BubbleTone, { border: number; fill: number; text: number }> = {
  plain: { border: 0xb0b0b0, fill: 0x262626, text: 0xf0f0f0 },
  ask: { border: 0xd97757, fill: 0x2a1d17, text: 0xffd9c9 },
  warn: { border: 0xc9a14e, fill: 0x2a2410, text: 0xf3e2a8 },
}

/** Stamps a speech bubble with its tail's tip at (`tipX`, `tipY`) in picture pixels; skipped when it would not fit. */
function stampBubble(
  pixels: Uint8Array,
  width: number,
  height: number,
  tipX: number,
  tipY: number,
  bubble: { text: string; tone?: BubbleTone },
): void {
  const b = renderBubble(bubble.text)
  const k = IMAGE.scale
  const top = tipY - b.height * k
  if (top < 0 || tipY > height) return
  const colors = BUBBLE_COLORS[bubble.tone ?? 'plain']
  const palette = [0, indexOfColor(colors.border), indexOfColor(colors.fill), indexOfColor(colors.text)]
  const left = Math.max(0, Math.min(width - b.width * k, tipX - b.tailX * k - 1))
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const v = b.pixels[y * b.width + x] as number
      if (v === 0) continue
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) pixels[(top + y * k + dy) * width + left + x * k + dx] = palette[v] as number
      }
    }
  }
}

/** Stamps one frame of a sprite, its feet at `anchor` (sprite pixels from the left). */
/** Subagents are drawn a hair smaller than the main Clawd. */
export const SUBAGENT_SCALE = 0.89

/**
 * Stamps one frame of a sprite, its feet at `anchor` (sprite pixels from the left). `scale` is picture
 * pixels to a sprite pixel (the main scale by default; a fraction rounds each pixel's edges).
 */
function stamp(
  pixels: Uint8Array,
  width: number,
  height: number,
  pad: number,
  name: string,
  frame: number,
  anchor: number,
  facing: number,
  look: { scale?: number } = {},
): void {
  const s = sprite(name)
  const k = look.scale ?? IMAGE.scale
  const sprites = s.frames[Math.max(0, Math.min(s.frames.length - 1, frame))] as Uint8Array
  const at = anchor * IMAGE.scale
  for (let i = 0; i < sprites.length; i++) {
    const v = sprites[i] as number
    if (v === 255) continue
    const sx = i % s.w
    const sy = (i / s.w) | 0
    const dx = facing > 0 ? sx - s.ax : -(sx - s.ax) - 1
    const x0 = Math.round(at + dx * k)
    const x1 = Math.round(at + (dx + 1) * k)
    const y0 = Math.round(height - pad - (s.ay - sy) * k)
    const y1 = Math.round(height - pad - (s.ay - sy - 1) * k)
    const index = indexOfColor(s.palette[v] as number)
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) pixels[y * width + x] = index
    }
  }
}

/** One frame: the landscape with Clawd (and its friends) on it, as palette indices. */
export function imagePixels(
  c: Companion,
  columns: number,
  style: SceneStyle = 'dots',
  extras: Extras = {},
): { pixels: Uint8Array; width: number; height: number; palette: Uint8Array } {
  const { name, frame } = c.current()
  const width = WIDTH_PX(columns)
  const height = HEIGHT_PX
  const pad = padOf(style)
  const pixels = (style === 'dots' ? dotsBase(columns, skyOf(extras), villageOf(extras.village)) : sceneLayer(columns)).slice()

  // one small Clawd at its own desk for each running subagent, along the left
  const desks = deskLayout(width / IMAGE.scale, extras.friends ?? 0)
  for (let i = 0; i < desks.drawn; i++) {
    const laptop = i % 2 === 0
    const frames = laptop ? 17 : 61
    const base = laptop ? 17 : 15
    const phase = Math.floor((extras.time ?? 0) * 12 + i * 5)
    stamp(pixels, width, height, pad, laptop ? 'Laptop' : 'Desktop', base + (phase % frames), DESK_START + i * desks.gap, 1, {
      scale: IMAGE.scale * SUBAGENT_SCALE,
    })
  }
  // the ones that did not fit are counted above the last desk
  if (desks.hidden > 0) {
    const deskTop = Math.round((sprite('Laptop').ay * SUBAGENT_SCALE + 3) * IMAGE.scale)
    stampBubble(pixels, width, height, (DESK_START + (desks.drawn - 1) * desks.gap) * IMAGE.scale, height - pad - deskTop, {
      text: `+${desks.hidden}`,
    })
  }

  stamp(pixels, width, height, pad, name, frame, Math.round(c.x), c.facing)

  // a few words above Clawd, the tail's tip just over its head
  if (extras.bubble && extras.bubble.text.trim() !== '') {
    const tipY = height - pad - (c.aboveNeeded() + 2) * IMAGE.scale
    stampBubble(pixels, width, height, Math.round(c.x) * IMAGE.scale, tipY, extras.bubble)
  }

  const palette = new Uint8Array(paletteColors.length * 3)
  paletteColors.forEach((rgb, n) => palette.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255], n * 3))

  return { pixels, width, height, palette }
}

export function imageFrame(c: Companion, columns: number, style: SceneStyle = 'dots', extras: Extras = {}): ImageFrame {
  const { name, frame } = c.current()
  const key = `${style}:${name}:${frame}:${c.facing}:${Math.round(c.x)}:${imageColumns(columns)}:${extrasKey(extras)}`
  const { pixels, width, height, palette } = imagePixels(c, columns, style, extras)

  return { key, source: { png: base64(encodeIndexedPng(pixels, width, height, palette)) } }
}

// ---------------------------------------------------------------------------
// Blocks, for every other terminal: half-block cells in a Raster, two sprite
// pixels to a sub-pixel along each axis, on a band of fixed height. The
// landscape is the picture's, sampled once per sub-pixel.

const DEFAULT_COLOR = 0x01000000
const SPACE = 0x20

export const BLOCKS = {
  scale: 2,
  /** sprite pixels in a column, and in a row of two sub-pixels */
  pxPerCol: 2,
  pxPerRow: 4,
  rows: 6,
} as const

export const BLOCKS_ROOM = BLOCKS.rows * BLOCKS.pxPerRow

// The art is drawn on a 2x2 grid whose origin differs per sprite; folding along
// that grid keeps the shapes clean, folding against it smears them.
const phases = new Map<string, [number, number]>()

function phase(name: string): [number, number] {
  let p = phases.get(name)
  if (p) return p
  const s = sprite(name)
  let best = Infinity
  p = [0, 0]
  for (const ox of [0, 1]) {
    for (const oy of [0, 1]) {
      let bad = 0
      for (const f of s.frames) {
        for (let y = oy; y < s.h - 1; y += 2) {
          for (let x = ox; x < s.w - 1; x += 2) {
            const a = f[y * s.w + x]
            if (f[y * s.w + x + 1] !== a || f[(y + 1) * s.w + x] !== a || f[(y + 1) * s.w + x + 1] !== a) bad++
          }
        }
      }
      if (bad < best) {
        best = bad
        p = [ox, oy]
      }
    }
  }
  phases.set(name, p)
  return p
}

type Folded = { w: number; h: number; pix: Uint8Array; ac: number; fr: number }
const folded = new Map<string, Folded>()

function fold(name: string, frame: number): Folded {
  const key = `${name}:${frame}`
  let g = folded.get(key)
  if (g) return g
  const s = sprite(name)
  const k = BLOCKS.scale
  const [ox, oy] = phase(name)
  const w = Math.ceil((s.w + k) / k) + 1
  const h = Math.ceil((s.h + k) / k) + 1
  const n = s.palette.length
  const counts = new Uint8Array(w * h * n)
  const pixels = s.frames[frame] as Uint8Array
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i] as number
    if (v === 255) continue
    const sx = Math.floor(((i % s.w) - ox + k) / k)
    const sy = Math.floor((((i / s.w) | 0) - oy + k) / k)
    const at = (sy * w + sx) * n + v
    counts[at] = (counts[at] as number) + 1
  }
  const pix = new Uint8Array(w * h).fill(255)
  for (let c = 0; c < w * h; c++) {
    let total = 0
    let top = 0
    let pick = 255
    for (let v = 0; v < n; v++) {
      const count = counts[c * n + v] as number
      total += count
      if (count > top) {
        top = count
        pick = v
      }
    }
    if (total >= (k * k) / 2) pix[c] = pick
  }
  g = { w, h, pix, ac: Math.floor((s.ax - ox + k) / k), fr: Math.floor((s.ay - 1 - oy + k) / k) }
  folded.set(key, g)
  return g
}

/** The band as a Raster `cells` string, `BLOCKS.rows` rows. */
export function blockCells(c: Companion, cols: number): string {
  const rows = BLOCKS.rows
  const { name, frame } = c.current()
  const s = sprite(name)
  const g = fold(name, frame)
  const sub = new Int32Array(cols * rows * 2).fill(-1)
  const px = Math.round(c.x / BLOCKS.scale)

  // the landscape, a sample per sub-pixel across the whole band
  const scene = sceneLayer(cols)
  const width = WIDTH_PX(cols)
  for (let sr = 0; sr < rows * 2; sr++) {
    for (let x = 0; x < Math.min(cols, imageColumns(cols)); x++) {
      const index = scene[Math.floor((sr + 0.5) * (HEIGHT_PX / (rows * 2))) * width + Math.floor((x + 0.5) * IMAGE.cellWidth * fit)] as number
      if (index !== 0) sub[sr * cols + x] = paletteColors[index] as number
    }
  }

  for (let i = 0; i < g.pix.length; i++) {
    const v = g.pix[i] as number
    if (v === 255) continue
    const sx = i % g.w
    const sy = (i / g.w) | 0
    const col = c.facing > 0 ? px + (sx - g.ac) : px - (sx - g.ac) - 1
    const row = rows * 2 - 1 + (sy - g.fr)
    if (row < 0 || row >= rows * 2 || col < 0 || col >= cols) continue
    sub[row * cols + col] = s.palette[v] as number
  }

  const words = new Uint32Array(cols * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < cols; x++) {
      const t = sub[r * 2 * cols + x] as number
      const b = sub[(r * 2 + 1) * cols + x] as number
      let glyph = SPACE
      let fg = DEFAULT_COLOR
      let bg = DEFAULT_COLOR
      if (t >= 0 && b >= 0) {
        glyph = 0x2580
        fg = t
        bg = b
      } else if (t >= 0) {
        glyph = 0x2580
        fg = t
      } else if (b >= 0) {
        glyph = 0x2584
        fg = b
      }
      const at = (r * cols + x) * 3
      words[at] = glyph
      words[at + 1] = fg
      words[at + 2] = bg
    }
  }

  const bytes = new Uint8Array(words.length * 4)
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as number
    bytes[i * 4] = w & 255
    bytes[i * 4 + 1] = (w >> 8) & 255
    bytes[i * 4 + 2] = (w >> 16) & 255
    bytes[i * 4 + 3] = (w >>> 24) & 255
  }

  return base64(bytes)
}
