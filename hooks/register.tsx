import type { Register } from 'claude-code'

import { activityOf } from './activity'
import { Asks } from './asks'
import { clickKind } from './clicks'
import { HELP, parseCommand } from './commands'
import { Companion } from './engine'
import { REFUSED_BACKOFF_MS, shouldUseBlocks } from './fallback'
import type { BubbleTone, SceneStyle } from './render'
import {
  BLOCKS,
  BLOCKS_ROOM,
  IMAGE,
  getFit,
  imageRoom,
  blockCells,
  imageColumns,
  imageFrame,
  setFit,
  walkColumns,
} from './render'
import { countChanges, shortDuration } from './village'
import type { Changes } from './village'

const TICK_MS = 40
const MIN_COLUMNS = 30
const IMAGE_TERMINALS = ['ghostty', 'kitty', 'wezterm', 'herdr']
// at most this many pictures a second: more than this is data the eye cannot use
const MIN_FRAME_MS = 90
const RIGHT_MARGIN = IMAGE.rightMargin

type EnvReader = { env: { get: (name: string) => Promise<string | undefined> } }
type Env = { program: string; isKitty: boolean; isMultiplexed: boolean; forced: string | undefined; noPointer: boolean }

async function readEnv($: EnvReader): Promise<Env> {
  const none = () => undefined

  return {
    program: ((await $.env.get('TERM_PROGRAM').catch(none)) ?? '').toLowerCase(),
    isKitty: (await $.env.get('KITTY_WINDOW_ID').catch(none)) !== undefined,
    isMultiplexed: (await $.env.get('TMUX').catch(none)) !== undefined,
    forced: await $.env.get('CLAWD_COMPANION').catch(none),
    noPointer: (await $.env.get('CLAWD_NO_POINTER').catch(none)) !== undefined,
  }
}

type AgentLister = { agent: { list: () => Promise<readonly { status: string }[]> } }
type UsageReader = {
  session: {
    usage: () => Promise<{ context: { percent?: number }; rateLimits: readonly { percentUsed: number }[] }>
  }
}

/** How many subagents are running right now. */
async function runningAgents($: AgentLister): Promise<number> {
  const list = await $.agent.list().catch(() => [] as readonly { status: string }[])

  return list.filter(a => a.status === 'running').length
}

/** How full the context window is (0 to 1) and the fullest rate-limit window (0 to 1). */
async function readUsage($: UsageReader): Promise<{ context: number; limit: number }> {
  const usage = await $.session.usage().catch(() => undefined)
  if (!usage) return { context: 0, limit: 0 }

  return {
    context: Math.min(1, Math.max(0, (usage.context.percent ?? 0) / 100)),
    limit: usage.rateLimits.reduce((fullest, l) => Math.max(fullest, l.percentUsed / 100), 0),
  }
}

type Runner = {
  process: { run: (argv: readonly string[], init?: { timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string }> }
}

/** The files `git status` lists in the session's folder: none when it is not a repository. */
async function readChanges($: Runner): Promise<Changes> {
  const out = await $.process.run(['git', 'status', '--porcelain'], { timeoutMs: 5000 }).catch(() => undefined)
  if (!out || out.exitCode !== 0) return { staged: 0, changed: 0 }

  return countChanges(out.stdout)
}

type Clock = { clock: { now: () => Promise<number> } }

/** The time; the computer's own clock when the host's cannot be read, so a hook never fails on it. */
async function clockNow($: Clock): Promise<number> {
  return $.clock.now().catch(() => Date.now())
}

/** A tool call's own input: what it was called with, without the ids the host adds. */
function inputOf(e: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const key of Object.keys(e)) {
    if (key !== 'tool' && key !== 'tool_use_id' && key !== 'agentId') input[key] = e[key]
  }

  return input
}

export const register: Register = on => {
  const clawd = new Companion()
  const band = {
    requestId: '',
    columns: 0,
    maxRows: 0,
    isShown: false,
    isEnabled: true,
    isTyping: false,
    style: 'dots' as SceneStyle,
    rows: 0,
    isWorking: false,
    // subagents running, drawn as small Clawds at their own desks
    friends: 0,
    time: 0,
    // how full the context window is and how close a rate limit is (0 to 1)
    context: 0,
    limit: 0,
    // a stretch is suggested after this long working, counted in working milliseconds
    breakMs: 50 * 60_000,
    workedMs: 0,
    lastWorkAt: 0,
    // the local time of day in hours (unset until read), for the sun and the moon
    hour: undefined as number | undefined,
    // the git village: a house for each changed file
    isVillage: true,
    // which renderer the person chose with /clawdman renderer; auto picks by the terminal
    renderer: 'auto' as 'auto' | 'image' | 'blocks',
    // pictures once worked in this terminal (remembered): trusted when the environment cannot be read
    imageWorked: undefined as boolean | undefined,
    village: { staged: 0, changed: 0 } as Changes,
    // a few words above Clawd for a while
    bubble: undefined as { text: string; tone: BubbleTone } | undefined,
    bubbleLeft: 0,
    // when the person's last prompt went in, for how long the turn took
    turnStartedAt: 0,
    // a usage warning is said once until the number drops back
    isContextWarned: false,
    isLimitWarned: false,
    // The picture gets a new name every time the mod loads or is switched back on, so
    // a terminal can never hold on to the size of an older picture under the same name.
    epoch: Math.floor(Math.random() * 1_000_000),
  }
  const seen = {
    mode: '' as '' | 'image' | 'blocks',
    noPointer: false,
    why: '',
    surface: '',
    hasSurvey: false,
    renders: 0,
    ticks: 0,
    blits: 0,
    denies: 0,
    clicks: 0,
    pokes: 0,
    walks: 0,
    streak: 0,
    // pictures the terminal has accepted, ever
    accepted: 0,
    deniedAt: 0,
    lastDeny: '',
    lastError: '',
    // the permission events heard, and what Clawd was doing while someone waited for the person
    requests: 0,
    notices: 0,
    denials: 0,
    askedFor: 0,
    askAnims: [] as string[],
    // a tool call ended and a request was still open (expected only with several calls at once)
    openAfterCall: 0,
  }
  let lastKey = ''
  // The picture's name changes with the mod's load, the style and the band's width, so a
  // terminal never holds on to the placement of an older, differently sized picture.
  const pictureKey = () => `clawd-${band.epoch}-${band.columns}`
  const polls = { agents: 0, usage: 0, hour: 0, git: 0 }
  /** Clawd says a few words for a few seconds. */
  const say = (text: string, tone: BubbleTone = 'plain', seconds = 4) => {
    band.bubble = { text, tone }
    band.bubbleLeft = seconds
  }
  /** what the picture shows besides Clawd and the fixed scenery */
  const extras = () => ({
    friends: band.friends,
    time: band.time,
    context: band.context,
    warn: band.limit >= 0.85,
    hour: band.hour,
    village: band.isVillage ? band.village : undefined,
    // while Claude waits for the person the bubble stays, then the passing ones
    bubble: clawd.isAsking ? { text: 'needs you', tone: 'ask' as const } : band.bubbleLeft > 0 ? band.bubble : undefined,
  })
  let isBusy = false
  let gitAsks = 0
  let gitApplied = 0
  let lastTick = 0
  let lastBlitAt = 0
  // after a refusal (the band is covered by a dialog, say) no pictures are made until then
  let holdUntil = 0

  // pictures where the terminal draws them, blocks everywhere else
  let lastEnv: Env | undefined
  const choose = (env: Env): 'image' | 'blocks' => {
    lastEnv = env
    // a choice made with /clawdman renderer beats the environment variable, which beats the guess
    const forced = band.renderer === 'auto' ? env.forced : band.renderer
    // an environment that reads blank (a reload, a host that hides it) is no evidence against pictures
    const isBlank = env.program === '' && !env.isKitty && !env.isMultiplexed && env.forced === undefined
    const isImage =
      forced === 'image' ||
      (forced !== 'blocks' &&
        !env.isMultiplexed &&
        (env.isKitty || IMAGE_TERMINALS.includes(env.program) || (isBlank && band.imageWorked === true)))
    seen.mode = isImage ? 'image' : 'blocks'
    seen.noPointer = env.noPointer
    seen.why = `TERM_PROGRAM=${env.program || '-'} KITTY_WINDOW_ID=${env.isKitty ? 'set' : '-'} TMUX=${
      env.isMultiplexed ? 'set' : '-'
    } CLAWD_COMPANION=${env.forced ?? '-'} renderer=${band.renderer}`

    return seen.mode
  }

  on('session.start', async ($, e, next) => {
    // a saved setting that cannot be read leaves the default; it never stops the session starting
    const none = () => undefined
    const savedRenderer = await $.store.get('renderer').catch(none)
    band.renderer = savedRenderer === 'image' || savedRenderer === 'blocks' ? savedRenderer : 'auto'
    band.imageWorked = (await $.store.get('imageWorked').catch(none)) === true
    if (!seen.mode) choose(await readEnv($))
    band.isEnabled = (await $.store.get('enabled').catch(none)) !== false
    band.style = (await $.store.get('style').catch(none)) === 'pixels' ? 'pixels' : 'dots'
    const savedFit = await $.store.get('fit').catch(none)
    if (typeof savedFit === 'number') setFit(savedFit)
    const savedBreak = await $.store.get('breakMinutes').catch(none)
    if (typeof savedBreak === 'number') band.breakMs = savedBreak * 60_000
    band.isVillage = (await $.store.get('village').catch(none)) !== false
    lastTick = await clockNow($)
    await $.command
      .register({
        name: 'clawdman',
        description: 'Turn the Clawd mascot on or off; /clawdman dots or /clawdman pixels changes the scenery; /clawdman village on or off; /clawdman renderer image, blocks or auto; /clawdman status shows what it sees',
      })
      .catch(none)

    $.clock.every(TICK_MS, async () => {
      if (isBusy) return
      isBusy = true

      try {
        const now = await clockNow($)
        const dt = (now - lastTick) / 1000
        lastTick = now
        // how long Claude has been at work (a long gap without work starts the count again)
        if (band.isWorking) {
          band.workedMs += dt * 1000
          band.lastWorkAt = now
        } else if (now - band.lastWorkAt > 10 * 60_000) {
          band.workedMs = 0
        }
        // nothing to draw, or the person is typing: leave the terminal alone
        if (!band.isShown || !band.isEnabled || band.isTyping) return

        band.time += dt
        if (band.bubbleLeft > 0) {
          band.bubbleLeft -= dt
          if (band.bubbleLeft <= 0) band.bubble = undefined
        }
        if (now - polls.hour >= 60_000) {
          polls.hour = now
          const clock = new Date(now)
          band.hour = clock.getHours() + clock.getMinutes() / 60
        }
        if (band.isVillage && now - polls.git >= 30_000) {
          // git can be slow in a big repository: ask in the background, never hold the animation
          polls.git = now
          // an answer that arrives after a newer one is stale and dropped
          const ask = ++gitAsks
          readChanges($).then(
            changes => {
              if (ask < gitApplied) return
              gitApplied = ask
              band.village = changes
            },
            () => undefined,
          )
        }
        if (now - polls.agents >= 1500) {
          polls.agents = now
          band.friends = Math.min(64, await runningAgents($))
        }
        if (now - polls.usage >= 20_000) {
          polls.usage = now
          const used = await readUsage($)
          band.context = used.context
          band.limit = used.limit
          // a warning is said once per crossing
          if (used.context >= 0.9 && !band.isContextWarned) {
            band.isContextWarned = true
            say(`context ${Math.round(used.context * 100)}%`, 'warn', 6)
          } else if (used.context < 0.8) {
            band.isContextWarned = false
          }
          if (used.limit >= 0.85 && !band.isLimitWarned) {
            band.isLimitWarned = true
            say(`limit ${Math.round(used.limit * 100)}%`, 'warn', 6)
          } else if (used.limit < 0.75) {
            band.isLimitWarned = false
          }
        }

        // the polls above awaited: the band may have been hidden, switched off or typed into meanwhile
        if (!band.isShown || !band.isEnabled || band.isTyping) return

        seen.ticks += 1
        const isImage = seen.mode === 'image'
        const m = isImage ? IMAGE : BLOCKS
        const walk = isImage ? walkColumns(band.columns) : band.columns - RIGHT_MARGIN
        clawd.step(dt, walk * m.pxPerCol, isImage ? imageRoom(band.style) : BLOCKS_ROOM, m.pxPerCol)
        if (clawd.isAsking) {
          seen.askedFor += dt
          if (clawd.animName && !seen.askAnims.includes(clawd.animName) && seen.askAnims.length < 8) seen.askAnims.push(clawd.animName)
        }

        if (isImage) {
          if (now < holdUntil) return
          const frame = imageFrame(clawd, band.columns, band.style, extras())
          if (frame.key === lastKey || now - lastBlitAt < MIN_FRAME_MS) return
          lastKey = frame.key
          lastBlitAt = now
          seen.blits += 1
          const result = await $.ui.blit({ requestId: band.requestId, key: pictureKey(), source: frame.source })
          if (!result.deny) {
            seen.streak = 0
            seen.accepted += 1
            if (band.imageWorked !== true) {
              band.imageWorked = true
              $.store.set('imageWorked', true).catch(() => undefined)
            }
            return
          }

          seen.denies += 1
          seen.streak += 1
          seen.deniedAt = seen.ticks
          seen.lastDeny = result.deny
          holdUntil = now + REFUSED_BACKOFF_MS
          if (shouldUseBlocks(seen.accepted, seen.streak)) {
            // Claude Code does not think this terminal can show pictures: draw blocks instead
            seen.mode = 'blocks'
            band.imageWorked = false
            $.store.set('imageWorked', false).catch(() => undefined)
            seen.why +=
              ' -> pictures refused, using blocks (start claude with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 for pictures)'
            lastKey = ''
            $.ui.invalidate('ui.render')
          }
          return
        }

        if (now < holdUntil) return
        const cells = blockCells(clawd, band.columns)
        if (cells !== lastKey) {
          lastKey = cells
          seen.blits += 1
          const result = await $.ui.blit({ requestId: band.requestId, key: pictureKey(), cells })
          if (result.deny) {
            seen.denies += 1
            seen.deniedAt = seen.ticks
            seen.lastDeny = result.deny
            holdUntil = now + REFUSED_BACKOFF_MS
          }
        }
      } catch (error) {
        seen.lastError = String(error instanceof Error ? error.message : error).slice(0, 300)
      } finally {
        isBusy = false
      }
    })

    return next(e)
  })

  on('command.run', { command: 'clawdman' }, async ($, e) => {
    const cmd = parseCommand(e.args)

    if (cmd.kind === 'help') return { text: HELP }

    if (cmd.kind === 'unknown') {
      return {
        text:
          `Clawdman does not know "${cmd.word}"` +
          (cmd.suggestion ? `. Did you mean /clawdman ${cmd.suggestion}?` : '.') +
          ' Nothing was changed; /clawdman help lists the commands.',
      }
    }

    if (cmd.kind === 'invalid') {
      return { text: `"${cmd.got}" is not a valid choice for /clawdman ${cmd.command}. Usage: ${cmd.usage}. Nothing was changed.` }
    }

    if (cmd.kind === 'status') {
      return {
        text: [
          `clawdman: ${band.isEnabled ? 'on' : 'off'}, renderer ${seen.mode || 'not chosen yet'} (${
            seen.why || 'no environment read yet'
          })`,
          `band: ${band.isShown ? 'shown' : 'hidden'} on surface ${seen.surface || '?'}, ${band.columns} columns, ` +
            `${band.maxRows} rows allowed, survey ${seen.hasSurvey}, typing ${band.isTyping}`,
          `Clawd: ${clawd.state}${clawd.animName ? ` (${clawd.animName})` : ''} at x ${clawd.x.toFixed(1)} px, facing ${clawd.facing}`,
          `renders ${seen.renders}, ticks ${seen.ticks}, picture updates ${seen.blits}, clicks ${seen.clicks} (${seen.pokes} on Clawd, ${seen.walks} sent it walking)`,
          `refused ${seen.denies} of ${seen.blits} picture updates` +
            (seen.denies ? `, last at tick ${seen.deniedAt}: ${seen.lastDeny}` : ''),
          `village ${band.isVillage ? 'on' : 'off'}: ${band.village.staged} staged, ${band.village.changed} changed; hour ${band.hour === undefined ? '?' : band.hour.toFixed(1)}`,
          `fit ${getFit().toFixed(3)}, style ${band.style}; subagents ${band.friends}, context ${Math.round(band.context * 100)}%, fullest limit ${Math.round(band.limit * 100)}%; worked ${Math.round(band.workedMs / 60000)} min toward a stretch`,
          `permission: ${seen.requests} requests, ${seen.notices} notices, ${seen.denials} denied; asked for ${seen.askedFor.toFixed(1)} s (poses: ${seen.askAnims.join(', ') || 'none'}); asking now ${clawd.isAsking}; requests still open after a call ended ${seen.openAfterCall}`,
          `last error: ${seen.lastError || 'none'}`,
        ].join('\n'),
      }
    }

    if (cmd.kind === 'renderer') {
      if (cmd.value !== undefined) {
        band.renderer = cmd.value
        await $.store.set('renderer', cmd.value)
        choose(lastEnv ?? (await readEnv($)))
        // start afresh: whatever made the last renderer give up no longer counts
        seen.streak = 0
        seen.accepted = 0
        band.epoch += 1
        lastKey = ''
        holdUntil = 0
        $.ui.invalidate('ui.render')
      }

      return {
        text:
          `Clawd is drawn as ${seen.mode === 'image' ? 'a picture' : 'blocks'} (renderer ${band.renderer}). ` +
          'Usage: /clawdman renderer image (pictures: needs a terminal that shows them, and CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 in some), ' +
          '/clawdman renderer blocks (works everywhere), /clawdman renderer auto (decided by the terminal).',
      }
    }

    if (cmd.kind === 'village') {
      band.isVillage = cmd.value === 'toggle' ? !band.isVillage : cmd.value === 'on'
      await $.store.set('village', band.isVillage)
      polls.git = 0
      lastKey = ''

      return {
        text: band.isVillage
          ? 'Clawd draws a house for each changed file in the repo (staged files are brighter). /clawdman village off hides them.'
          : 'The village is off. /clawdman village on brings the houses back.',
      }
    }

    if (cmd.kind === 'break') {
      if (cmd.minutes !== undefined) {
        band.breakMs = cmd.minutes * 60_000
        await $.store.set('breakMinutes', cmd.minutes)
      }

      return {
        text:
          band.breakMs > 0
            ? `Clawd will suggest a stretch after ${Math.round(band.breakMs / 60_000)} minutes of Claude working (usage: /clawdman break 50, or /clawdman break off).`
            : 'Clawd will not suggest stretches (turn them back on with /clawdman break 50).',
      }
    }

    if (cmd.kind === 'fit') {
      if (cmd.value !== undefined) {
        setFit(cmd.value)
        await $.store.set('fit', getFit())
        band.epoch += 1
        lastKey = ''
        $.ui.invalidate('ui.render')
      }

      return { text: `Clawd's scenery is stretched to ${getFit().toFixed(3)} of the cell shape (usage: /clawdman fit 1.035; wider if it stops short of the box edges, narrower if it overshoots).` }
    }

    if (cmd.kind === 'style') {
      band.style = cmd.value === 'toggle' ? (band.style === 'dots' ? 'pixels' : 'dots') : cmd.value
      await $.store.set('style', band.style)
      band.epoch += 1
      lastKey = ''
      $.ui.invalidate('ui.render')

      return { text: `Clawd's scenery is now ${band.style === 'dots' ? 'the dotted landscape' : 'the solid pixel landscape'}.` }
    }

    // a bare /clawdman, or on, or off: the only words that switch Clawd on or off
    band.isEnabled = cmd.kind === 'enable' ? cmd.on : !band.isEnabled
    await $.store.set('enabled', band.isEnabled)
    band.epoch += 1
    lastKey = ''
    $.ui.invalidate('ui.render')

    return { text: `Clawd is ${band.isEnabled ? 'on' : 'off'}. Run /clawdman again to turn it ${band.isEnabled ? 'off' : 'on'}.` }
  })

  // The invisible layer over the picture reports clicks and hovering. A click on Clawd
  // makes it react, a click on the scenery sends it walking there.
  const recentClicks: number[] = []
  on('ui.message', async ($, e, next) => {
    const d = e.data as { kind?: unknown; button?: unknown; y?: unknown; fx?: unknown } | null
    if (e.element === 'pointer' && d && typeof d.fx === 'number') {
      const isImage = seen.mode === 'image'
      const perColumn = isImage ? IMAGE.pxPerCol : BLOCKS.pxPerCol
      const anchor = clawd.x / perColumn
      if (d.kind === 'hover') {
        clawd.faceToward(d.fx * perColumn)
      } else if (d.kind === 'down' && typeof d.y === 'number') {
        seen.clicks += 1
        const isOnClawd = Math.abs(d.fx - anchor) <= 3.4 && (!isImage || d.y >= 1)
        // a click is the person's, not the keyboard's: let the reaction play
        band.isTyping = false
        if (d.button === 'right') {
          if (isOnClawd && clawd.poke('grumpy')) seen.pokes += 1
        } else if (isOnClawd) {
          const kind = clickKind(recentClicks, await clockNow($))
          if (clawd.poke(kind)) seen.pokes += 1
        } else if (clawd.walkToPx(d.fx * perColumn)) {
          seen.walks += 1
        }
      }
    }

    return next(e)
  })

  // Who is waiting for the person: one entry for each pending permission request, so Clawd asks for
  // as long as any is open, whichever agent it belongs to, and no longer.
  const asks = new Asks()
  const syncAsking = () => clawd.setAttention(asks.isOpen)
  // calls the person refused, by their id: a refusal is their choice, not a failure
  const refused = new Set<string>()

  // What Claude is doing shows in how Clawd sits and moves; a failed tool makes it facepalm.
  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    if (isMain) {
      const doing = activityOf(e.tool)
      if (doing) clawd.setActivity(doing)
    }
    const input = inputOf(e)
    let result: Awaited<ReturnType<typeof next>> | undefined
    try {
      result = await next(e)
    } finally {
      // the call has ended, however it ended, so whatever it asked for is answered
      asks.finished(e.agentId, e.tool, input)
      if (asks.isOpen) seen.openAfterCall += 1
      syncAsking()
    }
    const wasRefused = refused.delete(e.tool_use_id)
    // an error is a facepalm; a permission the person refused is not
    if (isMain && result.isError && !wasRefused) clawd.fail()

    return result
  })

  // When Claude needs the person, Clawd leaves the desk and waves and points until they answer.
  on('classic.PermissionRequest', ($, e, next) => {
    seen.requests += 1
    asks.request(e.agent_id, e.tool_name, e.tool_input)
    syncAsking()

    return next(e)
  })
  on('classic.Notification', ($, e, next) => {
    if (/permission|elicitation|approve|needs your/i.test(`${e.notification_type} ${e.message}`)) {
      seen.notices += 1
      asks.notify(e.agent_id)
      syncAsking()
    }

    return next(e)
  })
  on('classic.PermissionDenied', ($, e, next) => {
    seen.denials += 1
    if (refused.size > 200) refused.clear()
    refused.add(e.tool_use_id)
    asks.denied(e.agent_id, e.tool_name, e.tool_input)
    syncAsking()

    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    // the new prompt answers what the main agent asked; a background subagent may still be waiting
    asks.clearAgent(undefined)
    syncAsking()
    // a new turn starts clean: no bubble or gestures left from the last one
    band.bubble = undefined
    band.bubbleLeft = 0
    clawd.newTurn()
    band.turnStartedAt = await clockNow($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // a subagent's turn ending answers what it asked, and is not the person's turn
    if (e.agentId !== undefined) {
      asks.clearAgent(e.agentId)
      syncAsking()

      return next(e)
    }
    // the main agent's turn ending answers what the main agent asked; a background subagent may still wait
    asks.clearAgent(undefined)
    syncAsking()
    polls.usage = 0 // read the context and limits again at once
    polls.git = 0 // the turn probably changed some files
    if (e.reason === 'answer') {
      clawd.celebrate()
      const took = band.turnStartedAt > 0 ? (await clockNow($)) - band.turnStartedAt : 0
      if (took > 0) say(`done ${shortDuration(took)}`)
    } else if (e.reason === 'error' || e.reason === 'refusal') {
      clawd.fail()
      say('turn failed', 'warn')
    }
    // a long stretch of work: suggest a break
    if (band.breakMs > 0 && band.workedMs >= band.breakMs) {
      band.workedMs = 0
      clawd.stretch()
      say('stretch?', 'plain', 10)
    }

    return next(e)
  })

  // Typing is what matters most: while the prompt holds text, Clawd keeps still.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    band.isTyping = e.props.isDraft

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    seen.renders += 1
    seen.surface = e.surface
    seen.hasSurvey = e.props.hasSurvey
    if (band.imageWorked === undefined) band.imageWorked = (await $.store.get('imageWorked').catch(() => undefined)) === true
    const mode = seen.mode || choose(await readEnv($))
    const columns = Math.min(512, e.props.bodyColumns)
    const rows = mode === 'image' ? IMAGE.rows : BLOCKS.rows
    band.isShown =
      band.isEnabled && e.surface === 'terminal' && columns >= MIN_COLUMNS && e.props.maxRows >= rows && !e.props.hasSurvey
    // whether Claude is working is kept fresh even while the band is hidden, so no stale count of work
    band.isWorking = e.props.isWorking
    clawd.setWorking(e.props.isWorking)

    if (!band.isShown || e.surface !== 'terminal') {
      return next(e)
    }

    const m = mode === 'image' ? IMAGE : BLOCKS
    const walk = mode === 'image' ? walkColumns(columns) : columns - RIGHT_MARGIN
    clawd.step(0, walk * m.pxPerCol, mode === 'image' ? imageRoom(band.style) : BLOCKS_ROOM, m.pxPerCol)
    band.requestId = e.requestId
    band.columns = columns
    band.maxRows = e.props.maxRows

    const { Box, Client, Image, Raster } = $.ui.resolve(e)

    if (mode === 'image') {
      const frame = imageFrame(clawd, columns, band.style, extras())
      lastKey = frame.key
      const wide = imageColumns(columns)

      return (
        <Box flexDirection="column">
          <Box height={IMAGE.rows}>
            <Image key={pictureKey()} source={frame.source} columns={wide} rows={IMAGE.rows} alt=" " />
            {!seen.noPointer && (
              <Box position="absolute" top={0} left={0}>
                <Client key="pointer" module="./pointer.tsx" width={wide} height={IMAGE.rows} />
              </Box>
            )}
          </Box>
        </Box>
      )
    }

    lastKey = blockCells(clawd, columns)

    return (
      <Box flexDirection="column">
        <Raster key={pictureKey()} columns={columns} rows={BLOCKS.rows} cells={lastKey} />
        <Box position="absolute" top={0} left={0}>
          <Client key="pointer" module="./pointer.tsx" width={columns} height={BLOCKS.rows} />
        </Box>
      </Box>
    )
  })
}
