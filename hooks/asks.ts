// Who is waiting for the person. Each pending permission request is its own entry, keyed by the
// agent, the tool and the tool's input, so Clawd keeps asking for as long as any request is open,
// whichever agent it belongs to, and stops when the last one is answered. A call that finishes
// answers only its own request: another call of the same tool, with other input, does not.

/** The same text for the same value however its keys are ordered. */
export function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const record = value as Record<string, unknown>

  return `{${Object.keys(record)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stable(record[k])}`)
    .join(',')}}`
}

export class Asks {
  private open = new Set<string>()

  private call(agent: string | undefined, tool: string, input: unknown): string {
    return `call|${agent ?? ''}|${tool}|${stable(input)}`
  }

  private notice(agent: string | undefined): string {
    return `notice|${agent ?? ''}`
  }

  /** Whether anything is waiting for the person. */
  get isOpen(): boolean {
    return this.open.size > 0
  }

  /** A permission request for `tool` with `input`, from the main agent (`agent` undefined) or a subagent. */
  request(agent: string | undefined, tool: string, input?: unknown): void {
    this.open.add(this.call(agent, tool, input))
  }

  /** A notification that says an agent needs the person, with no tool named. */
  notify(agent?: string): void {
    this.open.add(this.notice(agent))
  }

  /** The person refused the tool: its request is answered, and so is that agent's notification. */
  denied(agent: string | undefined, tool: string, input?: unknown): void {
    this.open.delete(this.call(agent, tool, input))
    this.open.delete(this.notice(agent))
  }

  /**
   * A tool call finished, so its own request (if it had one) is answered, and so is the agent's
   * notification, which names no call. Other calls' requests stay open.
   */
  finished(agent: string | undefined, tool: string, input?: unknown): void {
    this.open.delete(this.call(agent, tool, input))
    this.open.delete(this.notice(agent))
  }

  /** An agent's turn ended: nothing of its is waiting any more. */
  clearAgent(agent: string | undefined): void {
    const mark = `|${agent ?? ''}|`
    for (const key of [...this.open]) {
      if (key.startsWith(`call${mark}`) || key === this.notice(agent)) this.open.delete(key)
    }
  }

  /** A new prompt: nothing is waiting any more. */
  clear(): void {
    this.open.clear()
  }
}
