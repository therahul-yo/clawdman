// What `/clawdman <words>` means. Only a bare `/clawdman`, `on` or `off` ever switches Clawd on or off;
// anything it does not know is answered with a hint, never with a surprise.

export type Command =
  | { kind: 'toggle' }
  | { kind: 'enable'; on: boolean }
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'style'; value: 'dots' | 'pixels' | 'toggle' }
  | { kind: 'village'; value: 'on' | 'off' | 'toggle' }
  | { kind: 'break'; minutes: number | undefined }
  | { kind: 'fit'; value: number | undefined }
  | { kind: 'renderer'; value: 'image' | 'blocks' | 'auto' | undefined }
  | { kind: 'invalid'; command: string; usage: string; got: string }
  | { kind: 'unknown'; word: string; suggestion: string | undefined }

export const WORDS = ['on', 'off', 'dots', 'pixels', 'style', 'village', 'break', 'fit', 'renderer', 'status', 'help'] as const

export const HELP = [
  '/clawdman              turn Clawdman on or off',
  '/clawdman on | off     show or hide him',
  '/clawdman dots | pixels   the dotted or the solid pixel scenery',
  '/clawdman village on | off   a house for every changed file',
  '/clawdman break 50 | off   minutes of Claude working before a stretch',
  '/clawdman renderer image | blocks | auto   pictures, blocks, or let the terminal decide',
  '/clawdman fit 1.035    line the scenery up with the prompt box edges',
  '/clawdman status       what Clawdman sees right now',
  '/clawdman help         this list',
].join('\n')

const USAGE = {
  village: '/clawdman village on | off',
  break: '/clawdman break 50 (minutes) | off',
  fit: '/clawdman fit 1.035 (a number between 0.9 and 1.2)',
  renderer: '/clawdman renderer image | blocks | auto',
  style: '/clawdman dots | pixels',
} as const

/** How many single-letter edits turn `a` into `b`. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] as number
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] as number
      row[j] = Math.min(above + 1, (row[j - 1] as number) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }

  return row[b.length] as number
}

/** The command that `word` was probably meant to be, if any is close. */
export function suggest(word: string): string | undefined {
  let best: string | undefined
  let bestDistance = 3
  for (const known of WORDS) {
    const d = distance(word, known)
    if (d < bestDistance) {
      bestDistance = d
      best = known
    }
  }

  return best
}

const NUMBER = /^\d+(\.\d+)?$/

export function parseCommand(args: string): Command {
  const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const word = parts[0] ?? ''
  const rest = parts.slice(1).join(' ')

  if (word === '') return { kind: 'toggle' }
  if (word === 'on' || word === 'off') return { kind: 'enable', on: word === 'on' }
  if (word === 'help' || word === '-h' || word === '--help' || word === '?') return { kind: 'help' }
  if (word === 'status') return { kind: 'status' }
  if (word === 'dots' || word === 'pixels') return { kind: 'style', value: word }
  if (word === 'style') return { kind: 'style', value: 'toggle' }

  if (word === 'village') {
    if (rest === '') return { kind: 'village', value: 'toggle' }
    if (rest === 'on' || rest === 'off') return { kind: 'village', value: rest }

    return { kind: 'invalid', command: word, usage: USAGE.village, got: rest }
  }
  if (word === 'break') {
    if (rest === '') return { kind: 'break', minutes: undefined }
    if (rest === 'off') return { kind: 'break', minutes: 0 }
    if (NUMBER.test(rest)) return { kind: 'break', minutes: Number.parseFloat(rest) }

    return { kind: 'invalid', command: word, usage: USAGE.break, got: rest }
  }
  if (word === 'fit') {
    if (rest === '') return { kind: 'fit', value: undefined }
    if (NUMBER.test(rest)) return { kind: 'fit', value: Number.parseFloat(rest) }

    return { kind: 'invalid', command: word, usage: USAGE.fit, got: rest }
  }
  if (word === 'renderer') {
    if (rest === '') return { kind: 'renderer', value: undefined }
    if (rest === 'image' || rest === 'blocks' || rest === 'auto') return { kind: 'renderer', value: rest }

    return { kind: 'invalid', command: word, usage: USAGE.renderer, got: rest }
  }

  return { kind: 'unknown', word, suggestion: suggest(word) }
}
