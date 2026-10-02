// When to give up on pictures. A terminal that has shown one picture can show them: refusals after
// that are the band being covered (a permission dialog, a menu), which passes. Only a terminal that
// has never accepted one, and refuses again and again, is drawn with blocks instead.

export const REFUSALS_BEFORE_BLOCKS = 6

/** How long to wait after a refusal before sending another picture. */
export const REFUSED_BACKOFF_MS = 1000

export const shouldUseBlocks = (accepted: number, streak: number): boolean =>
  accepted === 0 && streak >= REFUSALS_BEFORE_BLOCKS
