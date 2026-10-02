import type { Activity } from './engine'

const READ = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'ToolSearch'])
const WRITE = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const RUN = new Set(['Bash', 'BashOutput', 'KillShell', 'Monitor'])
const DELEGATE = new Set(['Agent', 'Task', 'TaskCreate', 'SendMessage'])
const PLAN = new Set(['TodoWrite', 'ExitPlanMode', 'EnterPlanMode'])

/** What a tool call looks like Claude is doing, or null for a tool that shows nothing. */
export function activityOf(tool: string): Activity | null {
  if (READ.has(tool)) return 'look'
  if (WRITE.has(tool)) return 'write'
  if (RUN.has(tool)) return 'run'
  if (DELEGATE.has(tool)) return 'delegate'
  if (PLAN.has(tool)) return 'think'
  if (tool.startsWith('mcp__')) {
    const name = tool.slice(tool.lastIndexOf('__') + 2).toLowerCase()
    if (/(^|_)(read|get|list|search|find|fetch|view|query|show)/.test(name)) return 'look'
    if (/(^|_)(create|update|write|send|push|merge|delete|add|edit|set|post)/.test(name)) return 'write'

    return 'run'
  }

  return null
}
