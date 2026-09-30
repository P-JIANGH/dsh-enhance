/**
 * Advisor companion-review runtime (architecture advisor). Spawns one
 * independent LLM review call per main-agent turn-stop boundary, feeds it the
 * main session's incremental transcript (user instruction + assistant work),
 * and injects/steers the main agent with any review it produces, throttled by
 * an emission guard.
 *
 * This runtime uses a direct `ctx.llm.stream()` review call rather than a
 * shadow sub-agent, because the live dsh loop drives shadow sub-agents only via
 * explicit tool-call delegation — a peer sub-agent woken with `followup()` +
 * `whenIdle()` opens a turn but never produces a model step (turn/start →
 * turn/end with no step/start, `answerLen=0`). A direct streaming call keeps
 * the advisor's review independent and always runs to a real model output.
 *
 * Boundary rules implemented here:
 * - The advisor is an independent model call (`model`/`provider`), driven from
 *   the incremental transcript the runtime extracts — it never reads the main
 *   session itself.
 * - `nit` → `agent.inject(body)`; `concern`/`blocker` → `agent.steer(body)`.
 *
 * @module dsh-enhance/features/advisor/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { messageText as bodyText } from '../../shared/messages.js'
import { ADVISOR_SYSTEM_PROMPT } from './prompt.js'
import { createEmissionGuard } from './emission-guard.js'
import { parseAdvisorEmission, type AdvisorEmission } from './severity.js'

/** Advisor sub-session id suffix (kept distinct from any user-facing id). */
export const ADVISOR_ID_SUFFIX = '__advisor'

/** Max characters of one review payload handed to the advisor (tail kept). */
export const MAX_INCREMENT_CHARS = 8000

/** Minimal server-side trace for verifying the companion review lifecycle. */
function trace(...args: unknown[]): void {
  try { console.error('[advisor]', ...args) } catch { /* ignore */ }
}

/** Advisor runtime options. */
export interface AdvisorOptions {
  /** Master switch: false installs a no-op. */
  enabled: boolean
  /** Override the advisor's independent model. Undefined → inherit the main route. */
  model?: string
  /** Advisor system prompt; defaults to the single-source module constant. */
  prompt?: string
  /** Rate-limit this many ms between two delivered suggestions. */
  windowMs?: number
}

/** A standalone review call result: the advisor's raw text, or null on error. */
export interface ReviewResult {
  /** Severity envelope + body, or null when no emission is actionable. */
  emission: AdvisorEmission | null
  /** Raw advisor output (for diagnostics). */
  raw: string
}

/**
 * Run one independent advisor review through `ctx.llm.stream()` and assemble
 * the assistant's text output. Pure enough to test with a fake LLM runtime.
 * @param llm - the LLM service (`ctx.llm`); exposes `stream(GenerateOptions)`.
 * @param request - provider/model/messages/system for the review call.
 * @returns the assembled advisor text, or `null` if the call failed.
 */
export async function runReviewCall(
  llm: { stream(options: GenerateOptions): AsyncIterable<StreamChunk> },
  request: GenerateOptions,
): Promise<string | null> {
  const assembler = new BlockAssembler()
  try {
    for await (const chunk of llm.stream(request)) {
      assembler.push(chunk)
    }
    const blocks = assembler.blocks().filter(b => b.type === 'text')
    const text = blocks.map(b => 'text' in b ? b.text as string : '').join('\n').trim()
    return text || null
  } catch (err) {
    trace('review stream FAILED', String((err as Error)?.message ?? err))
    return null
  }
}

/**
 * Register the advisor companion runtime: on every main agent turn's stop
 * boundary, run one independent review call over the turn's incremental
 * transcript and relay any actionable review back to the main agent.
 * @param ctx - context exposing `llm` and broadcasting `agent/turn-stopping`.
 * @param options - advisor behavior.
 * @returns the exact disposer.
 */
export function registerAdvisorRuntime(ctx: Context, options: AdvisorOptions): () => void {
  const llm = ctx.llm
  if (!options.enabled || !llm) return () => {}
  const prompt = options.prompt ?? ADVISOR_SYSTEM_PROMPT
  const guard = createEmissionGuard(Date.now, options.windowMs)

  /**
   * Set by the disposer. Reviews are fired from an `agent/turn-stopping` listener
   * and then run asynchronously, so one can still be in flight (or be triggered)
   * after the plugin scope went inactive — resolving `ctx.llm` lazily at that
   * point threw `cannot get required service ... in inactive context` in real
   * sessions. Capturing the service at registration plus this flag removes both
   * the inactive-context access and any post-disposal side effect.
   */
  let disposed = false

  /** Which provider/model the advisor should route on (inherit main, or override). */
  function routeFor(main: Agent): { provider: string; model: string } {
    if (options.model) return { provider: 'deepseek-official', model: options.model }
    return {
      provider: main.options?.provider ?? 'deepseek-official',
      model: main.options?.model ?? 'deepseek-v4-flash',
    }
  }

  /** Message-count cursor per main agent for incremental transcript extraction. */
  const cursors = new Map<string, number>()

  /**
   * Agents the harness has already disposed. `agent.status` is only
   * `idle | running` (disposal removes the agent from its registry rather than
   * becoming a third status), and reading a disposed agent's transcript throws
   * `cannot get required service "agents" in inactive context` — which real
   * sessions hit on the turn boundary that races shutdown. Bounded so a
   * long-lived host does not accumulate one entry per session forever; the
   * guarded extraction below is the backstop when this set is not populated.
   */
  const gone = new Set<string>()
  const GONE_CAP = 256

  /** True when this agent should no longer be reviewed. */
  function isGone(id: string): boolean {
    return disposed || gone.has(id)
  }

  /** Incremental transcript for one main agent since the last review. */
  function extractIncrement(main: Agent, id: string): string {
    const msgs = main.session.deriveMessages()
    const from = cursors.get(id) ?? 0
    cursors.set(id, msgs.length)
    // Keep only user/assistant turns, walking newest-first, and stop once we
    // have a bounded, useful review window. Tool results and system churn are
    // excluded so the advisor sees the actual conversation, not housekeeping.
    const parts: string[] = []
    let chars = 0
    for (let i = msgs.length - 1; i >= from && chars < MAX_INCREMENT_CHARS; i--) {
      const m = msgs[i]
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
      const line = messageText(m)
      if (!line) continue
      parts.unshift(line)
      chars += line.length
    }
    return parts.join('\n')
  }

  /**
   * Deliver one parsed emission back to the owning main agent.
   *
   * Best-effort by design: the review is computed asynchronously, so by the time
   * it is ready the session may already be tearing down — `agent.inject/steer`
   * then throws `cannot get required service "agents" in inactive context`.
   * Real drives pinned the failure to this exact stage, so a gone agent is a
   * dropped suggestion (reported as a skip), never a FAILED review.
   *
   * @returns true when the message was handed to the agent.
   */
  function deliver(main: Agent, emission: AdvisorEmission): boolean {
    const payload = createUserMessage({
      content: [{ type: 'text', text: `[advisor·${emission.severity}] ${emission.body}` }],
      source: { kind: 'user' },
    })
    try {
      if (emission.severity === 'nit') main.inject(payload)
      else main.steer(payload)
      return true
    } catch {
      return false
    }
  }

  /** Build the review prompt handed to the advisor for one transcript increment. */
  function reviewPrompt(mainId: string, increment: string): string {
    return [
      'You are the companion reviewer attached to main-agent session "' + mainId + '".',
      'Review the transcript increment below (user instruction plus the main agent\u2019s work).',
      'Follow your standing instructions: surface only a concrete technical risk, at most',
      'one suggestion per review, and reply with the ADVISOR: <severity> envelope.',
      '--- transcript increment ---',
      increment,
    ].join('\n')
  }

  // Single serial listener on the turn-stop boundary. Only main agents are
  // observed here; the advisor runs as a direct streaming call, never as a
  // sub-agent whose own stop could loop back into this listener.
  const offMain = ctx.on('agent/turn-stopping', ({ agent }: { agent: Agent }) => {
    const id = safeAgentId(agent)
    void kickReview(agent, id).catch((err) => trace('review async FAILED for', id, String((err as Error)?.message ?? err)))
  })

  // Cursors are per-agent; drop them when the agent goes away so a long-lived
  // host does not accumulate one entry per session forever.
  const offDisposed = ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => {
    if (typeof agent?.id !== 'string') return
    cursors.delete(agent.id)
    if (gone.size >= GONE_CAP) gone.clear()
    gone.add(agent.id)
  })

  async function kickReview(main: Agent, id: string): Promise<void> {
    if (isGone(id)) return
    // `stage` makes a failure self-describing: real sessions hit
    // `cannot get required service "agents" in inactive context` on the turn
    // boundary that races shutdown, and the stage pinpoints which access did it.
    let stage = 'extract'
    try {
      // Reading a disposed agent's transcript throws; that is a skip, not a failure.
      let increment: string
      try {
        increment = extractIncrement(main, id)
      } catch (err) {
        trace('skip: transcript unavailable for', id, String((err as Error)?.message ?? err))
        return
      }
      if (!increment) { trace('skip: empty increment for', id); return }
      stage = 'route'
      const { provider, model } = routeFor(main)
      const start = Date.now()
      const request: GenerateOptions = {
        provider,
        model,
        messages: [createUserMessage({
          content: [{ type: 'text', text: reviewPrompt(id, increment) }],
          source: { kind: 'user' },
        })],
        system: prompt,
      }
      stage = 'stream'
      const raw = await runReviewCall(llm, request)
      if (isGone(id)) return
      trace('review for', id, 'route=', provider, model, 'incrementChars=', increment.length,
        'tookMs=', Date.now() - start, 'answerLen=', raw?.length ?? 0, 'raw=', JSON.stringify(raw))
      if (raw === null) return
      stage = 'parse'
      const emission = parseAdvisorEmission(raw)
      if (!emission) { trace('advisor produced no emission for', id, 'answerLen=', raw.length); return }
      if (!guard.gate(id, emission.body)) { trace('guarded emission', emission.severity, 'for', id); return }
      stage = 'deliver'
      if (!deliver(main, emission)) {
        trace('skip: agent no longer accepts messages, dropped', emission.severity, 'for', id)
        return
      }
      trace('delivered', emission.severity, 'to', id)
    } catch (err) {
      trace('review FAILED at stage', stage, 'for', id, String((err as Error)?.message ?? err))
    }
  }

  return () => {
    disposed = true
    offMain?.()
    offDisposed?.()
    cursors.clear()
    gone.clear()
  }
}

/** Role-prefixed body of one message (the advisor reads a labelled transcript). */
function messageText(m: Message): string {
  const body = bodyText(m)
  if (!body) return ''
  const role = m.role === 'user' ? 'USER: ' : m.role === 'assistant' ? 'ASSISTANT: ' : 'TOOL: '
  return role + body
}

/**
 * Agent id that never throws. On a disposed agent some accessors raise
 * `cannot get required service … in inactive context`, and an exception thrown
 * *inside* a catch handler would escape the handler entirely — so identity is
 * resolved once, defensively, and threaded through instead of re-read.
 */
function safeAgentId(agent: Agent): string {
  try {
    const id = (agent as { id?: unknown } | undefined)?.id
    return typeof id === 'string' && id.length > 0 ? id : 'unknown'
  } catch {
    return 'unknown'
  }
}
