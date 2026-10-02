// The git village: one house for each file `git status` lists.

export type Changes = { staged: number; changed: number }

/**
 * Counts the files in `git status --porcelain` output. A file with a change in the index is
 * staged (even if it also has changes after), any other listed file (modified, deleted, new,
 * untracked and conflicted) is changed; ignored files are not counted.
 */
export function countChanges(porcelain: string): Changes {
  let staged = 0
  let changed = 0
  for (const line of porcelain.split('\n')) {
    if (line.length < 4 || line.startsWith('!!')) continue
    const index = line[0] as string
    const work = line[1] as string
    // a conflict (both sides changed it) is still to be sorted out, so it is not a staged file
    const isConflict = index === 'U' || work === 'U' || line.startsWith('AA') || line.startsWith('DD')
    if (index !== ' ' && index !== '?' && !isConflict) staged += 1
    else changed += 1
  }

  return { staged, changed }
}

/** How long a duration reads in a bubble: `42s`, `2m 5s`, `1h 3m`. */
export function shortDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
