// A small PNG writer for pixel art: indexed color (a palette, one byte per pixel,
// index 0 transparent) and one fixed-Huffman deflate block whose matches copy
// from anywhere in the last 32 KB. Pixel art is runs and
// repeats, so a frame that is 276 KB raw comes out at a few KB, which is what
// keeps the terminal and the typing responsive.

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }

  return table
})()

const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = (crcTable[(c ^ (bytes[i] as number)) & 255] as number) ^ (c >>> 8)

  return (c ^ 0xffffffff) >>> 0
}

const adler32 = (bytes: Uint8Array): number => {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + (bytes[i] as number)) % 65521
    b = (b + a) % 65521
  }

  return ((b << 16) | a) >>> 0
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

class Bits {
  bytes: number[] = []
  private acc = 0
  private count = 0

  /** value's low `n` bits, least significant first */
  put(value: number, n: number): void {
    this.acc |= value << this.count
    this.count += n
    while (this.count >= 8) {
      this.bytes.push(this.acc & 255)
      this.acc >>>= 8
      this.count -= 8
    }
  }

  /** a Huffman code, most significant bit first */
  code(value: number, n: number): void {
    let reversed = 0
    for (let i = 0; i < n; i++) reversed |= ((value >> i) & 1) << (n - 1 - i)
    this.put(reversed, n)
  }

  literal(v: number): void {
    if (v < 144) this.code(0x30 + v, 8)
    else if (v < 256) this.code(0x190 + (v - 144), 9)
    else if (v < 280) this.code(v - 256, 7)
    else this.code(0xc0 + (v - 280), 8)
  }

  finish(): number[] {
    if (this.count > 0) this.bytes.push(this.acc & 255)

    return this.bytes
  }
}

const WINDOW = 32768
const HASH_SIZE = 1 << 15

/** Deflate with a hash-chain LZ77: finds repeats anywhere in the last 32 KB, not just nearby. */
function deflate(raw: Uint8Array, stride: number): number[] {
  const out = new Bits()
  out.put(1, 1) // final block
  out.put(1, 2) // fixed Huffman codes

  const n = raw.length
  const head = new Int32Array(HASH_SIZE).fill(-1)
  const prev = new Int32Array(n)
  const keyAt = (i: number) => (((raw[i] as number) << 10) ^ ((raw[i + 1] as number) << 5) ^ (raw[i + 2] as number)) & (HASH_SIZE - 1)
  const insert = (i: number) => {
    if (i + 2 >= n) return
    const k = keyAt(i)
    prev[i] = head[k] as number
    head[k] = i
  }
  const matchLength = (i: number, from: number) => {
    let len = 0
    while (len < 258 && i + len < n && raw[i + len] === raw[from + len]) len++

    return len
  }

  let i = 0
  while (i < n) {
    let bestLen = 0
    let bestDist = 0
    // the previous pixel and the row above first: the cheap, common repeats
    for (const dist of [1, stride]) {
      if (i < dist || dist > WINDOW) continue
      const len = matchLength(i, i - dist)
      if (len > bestLen) {
        bestLen = len
        bestDist = dist
      }
    }
    if (bestLen < 258 && i + 2 < n) {
      let cand = head[keyAt(i)] as number
      let chain = 10
      while (cand >= 0 && i - cand <= WINDOW && chain-- > 0) {
        const len = matchLength(i, cand)
        if (len > bestLen) {
          bestLen = len
          bestDist = i - cand
          if (len >= 258) break
        }
        cand = prev[cand] as number
      }
    }

    if (bestLen < 4) {
      out.literal(raw[i] as number)
      insert(i)
      i++
      continue
    }

    let lc = LENGTH_BASE.length - 1
    while ((LENGTH_BASE[lc] as number) > bestLen) lc--
    out.literal(257 + lc)
    out.put(bestLen - (LENGTH_BASE[lc] as number), LENGTH_EXTRA[lc] as number)

    let dc = DIST_BASE.length - 1
    while ((DIST_BASE[dc] as number) > bestDist) dc--
    out.code(dc, 5)
    out.put(bestDist - (DIST_BASE[dc] as number), DIST_EXTRA[dc] as number)
    // index the start of the match, and then every few positions of a long one
    for (let k = 0; k < bestLen; k += bestLen > 32 ? 8 : 1) insert(i + k)
    i += bestLen
  }

  out.literal(256) // end of block

  return out.finish()
}

/**
 * @param pixels `width * height` palette indices
 * @param palette RGB triples, entry 0 the transparent one
 */
export function encodeIndexedPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array,
): Uint8Array {
  const stride = 1 + width
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * width, (y + 1) * width), y * stride + 1)

  const body = deflate(raw, stride)
  const adler = adler32(raw)
  const idat = new Uint8Array(2 + body.length + 4)
  idat[0] = 0x78
  idat[1] = 0x01
  idat.set(body, 2)
  idat.set([(adler >>> 24) & 255, (adler >>> 16) & 255, (adler >>> 8) & 255, adler & 255], 2 + body.length)

  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const bytes = new Uint8Array(12 + data.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, data.length)
    for (let k = 0; k < 4; k++) bytes[4 + k] = type.charCodeAt(k)
    bytes.set(data, 8)
    view.setUint32(8 + data.length, crc32(bytes, 4, 8 + data.length))

    return bytes
  }

  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 3, 0, 0, 0], 8) // 8-bit palette, no interlace
  const alpha = new Uint8Array(1) // entry 0 transparent, the rest opaque (the default)

  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', header),
    chunk('PLTE', palette),
    chunk('tRNS', alpha),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]
  const png = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    png.set(part, at)
    at += part.length
  }

  return png
}
