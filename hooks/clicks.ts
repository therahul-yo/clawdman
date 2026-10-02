import type { PokeKind } from './engine'

const DOUBLE_MS = 450
const PESTER_WINDOW_MS = 2200
const PESTER_CLICKS = 4

/**
 * What a click on Clawd means, from when the person clicked before: four clicks within
 * a couple of seconds is pestering, two in quick succession is a double click.
 * `times` holds the earlier clicks, oldest first, and gets this one added.
 */
export function clickKind(times: number[], now: number): PokeKind {
  const last = times[times.length - 1]
  times.push(now)
  while (times.length > 6) times.shift()
  if (times.filter(t => now - t < PESTER_WINDOW_MS).length >= PESTER_CLICKS) return 'annoyed'

  return last !== undefined && now - last < DOUBLE_MS ? 'big' : 'normal'
}
