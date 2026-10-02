// A tiny 3 x 5 pixel font and a speech-bubble maker. Pure functions on pixel grids;
// render.ts stamps the bubble into the picture.

export const GLYPH_WIDTH = 3
export const GLYPH_HEIGHT = 5

// Each glyph is five rows of three characters, '#' for a lit pixel.
const SHAPES: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '###', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  ' ': ['...', '...', '...', '...', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  ';': ['...', '.#.', '...', '.#.', '#..'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  "'": ['.#.', '.#.', '...', '...', '...'],
  '"': ['#.#', '#.#', '...', '...', '...'],
  '(': ['.##', '#..', '#..', '#..', '.##'],
  ')': ['##.', '..#', '..#', '..#', '##.'],
  '=': ['...', '###', '...', '###', '...'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '*': ['...', '#.#', '.#.', '#.#', '...'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  _: ['...', '...', '...', '...', '###'],
  '~': ['...', '.##', '##.', '...', '...'],
}

// A shape's five rows as five 3-bit numbers.
function rowsOf(shape: readonly string[]): number[] {
  return shape.map(row => {
    let bits = 0
    for (let c = 0; c < GLYPH_WIDTH; c++) bits = (bits << 1) | (row[c] === '#' ? 1 : 0)

    return bits
  })
}

const GLYPHS = new Map<string, readonly number[]>()
for (const [ch, shape] of Object.entries(SHAPES)) GLYPHS.set(ch, rowsOf(shape))

/** The 5 rows of a glyph, each a 3-bit number (bit 2 is the left pixel). Anything unknown is drawn as `?`. */
export function glyphRows(ch: string): readonly number[] {
  return GLYPHS.get(ch.toUpperCase()) ?? (GLYPHS.get('?') as readonly number[])
}

/** Width in pixels of `text` in this font: 3 a glyph and 1 between glyphs. */
export function textWidth(text: string): number {
  const n = [...text].length

  return n === 0 ? 0 : n * GLYPH_WIDTH + (n - 1)
}

export type Bubble = {
  width: number
  height: number
  /** width * height cells, row-major: 0 empty, 1 border, 2 fill, 3 text */
  pixels: Uint8Array
  /** the column of the tail's tip */
  tailX: number
}

const TAIL = 2

/** A speech bubble holding `text`, uppercased and cut to `maxChars` (default 22) with ".." when longer. */
export function renderBubble(text: string, maxChars = 22): Bubble {
  let line = [...text.toUpperCase()].slice(0, Math.max(0, maxChars + 2)).join('')
  if ([...text].length > maxChars) line = [...text.toUpperCase()].slice(0, Math.max(0, maxChars - 2)).join('') + '..'
  const bodyHeight = GLYPH_HEIGHT + 4
  const width = Math.max(5, textWidth(line) + 4)
  const height = bodyHeight + TAIL
  const pixels = new Uint8Array(width * height)
  const set = (x: number, y: number, v: number) => {
    pixels[y * width + x] = v
  }

  // the rounded box: a border, a fill, the four corners left empty
  for (let y = 0; y < bodyHeight; y++) {
    for (let x = 0; x < width; x++) {
      const isCorner = (x === 0 || x === width - 1) && (y === 0 || y === bodyHeight - 1)
      if (isCorner) continue
      const isBorder = x === 0 || x === width - 1 || y === 0 || y === bodyHeight - 1
      set(x, y, isBorder ? 1 : 2)
    }
  }

  // the text, one pixel inside the padding
  let x0 = 2
  for (const ch of line) {
    glyphRows(ch).forEach((bits, r) => {
      for (let c = 0; c < GLYPH_WIDTH; c++) if (bits & (1 << (GLYPH_WIDTH - 1 - c))) set(x0 + c, 2 + r, 3)
    })
    x0 += GLYPH_WIDTH + 1
  }

  // the tail: it opens the bottom border, then narrows to a point
  const tailX = Math.floor(width / 2)
  set(tailX, bodyHeight - 1, 2)
  set(tailX - 1, bodyHeight, 1)
  set(tailX, bodyHeight, 2)
  set(tailX + 1, bodyHeight, 1)
  set(tailX, bodyHeight + 1, 1)

  return { width, height, pixels, tailX }
}
