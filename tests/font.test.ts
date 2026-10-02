import { expect, test } from 'claude-code/testing'

import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphRows, renderBubble, textWidth } from '../hooks/font'

const SUPPORTED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?-+/%'\"()=><*#_~"

test('every supported character is a 3 x 5 glyph', () => {
  for (const ch of SUPPORTED) {
    const rows = glyphRows(ch)
    expect(`${ch}:${rows.length}`).toBe(`${ch}:${GLYPH_HEIGHT}`)
    for (const bits of rows) expect(bits >= 0 && bits < 1 << GLYPH_WIDTH).toBe(true)
  }
  // letters are not blank, space is
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') expect(glyphRows(ch).some(b => b !== 0)).toBe(true)
  expect(glyphRows(' ').every(b => b === 0)).toBe(true)
})

test('look-alikes differ, case does not matter, unknown characters are question marks', () => {
  const same = (a: string, b: string) => glyphRows(a).join() === glyphRows(b).join()
  expect(same('0', 'O')).toBe(false)
  expect(same('1', 'I')).toBe(false)
  expect(same('8', 'B')).toBe(false)
  expect(same('a', 'A')).toBe(true)
  expect(same('é', '?')).toBe(true)
  // all letters and digits are different from each other except 5 and S, which share a shape on purpose... check the rest
  const seen = new Map<string, string>()
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    const key = glyphRows(ch).join()
    const other = seen.get(key)
    expect(other === undefined || (other === 'S' && ch === '5')).toBe(true)
    seen.set(key, ch)
  }
})

test('text width is 3 a glyph and 1 between', () => {
  expect(textWidth('')).toBe(0)
  expect(textWidth('A')).toBe(3)
  expect(textWidth('AB')).toBe(7)
  expect(textWidth('HELLO')).toBe(19)
})

test('a bubble is a rounded box with a border, a fill, the text and a downward tail', () => {
  const b = renderBubble('done')
  const at = (x: number, y: number) => b.pixels[y * b.width + x] as number

  // 4 letters: 15 wide of text, plus padding and border; 5 rows of text plus padding and border, plus a tail
  expect(b.width).toBe(textWidth('DONE') + 4)
  expect(b.height).toBe(GLYPH_HEIGHT + 4 + 2)
  expect(b.pixels.length).toBe(b.width * b.height)

  // the four corners of the box are empty, the rest of the border is whole
  const bottom = GLYPH_HEIGHT + 3
  for (const [x, y] of [[0, 0], [b.width - 1, 0], [0, bottom], [b.width - 1, bottom]] as const) expect(at(x, y)).toBe(0)
  for (let x = 1; x < b.width - 1; x++) expect(at(x, 0)).toBe(1)
  for (let y = 1; y < bottom; y++) {
    expect(at(0, y)).toBe(1)
    expect(at(b.width - 1, y)).toBe(1)
  }
  // text pixels exist and sit inside the fill
  let text = 0
  for (let y = 1; y < bottom; y++) for (let x = 1; x < b.width - 1; x++) if (at(x, y) === 3) text++
  expect(text > 10).toBe(true)

  // the tail opens the bottom border and points down, symmetric around its tip
  expect(at(b.tailX, bottom)).toBe(2)
  expect(at(b.tailX - 1, bottom + 1)).toBe(1)
  expect(at(b.tailX + 1, bottom + 1)).toBe(1)
  expect(at(b.tailX, b.height - 1)).toBe(1)
  expect(at(b.tailX - 1, b.height - 1)).toBe(0)
  expect(at(b.tailX + 1, b.height - 1)).toBe(0)
})

test('long text is cut to the limit and ends in two dots; an empty bubble still works', () => {
  const long = renderBubble('this sentence is far too long for any bubble to hold'.toUpperCase())
  expect(long.width).toBe(textWidth('X'.repeat(22)) + 4)
  const short = renderBubble('0123456789ABCDEFGHIJKLMNOP', 12)
  expect(short.width).toBe(textWidth('X'.repeat(12)) + 4)
  expect(renderBubble('').width >= 5).toBe(true)
  expect(renderBubble('').pixels.length).toBe(renderBubble('').width * renderBubble('').height)
})
