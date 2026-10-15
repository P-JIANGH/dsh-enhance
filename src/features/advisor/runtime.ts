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
import { CONTEXT_SOURCE_KIND } from '../../shared/provenance.js'
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
 * One standalone review call's outcome: the assembled text, and — when the
 * call itself failed — the transport message. The failure is returned rather
 * than swallowed so the runtime can record *why* the advisor went quiet: a
 * silent `null` was indistinguishable from "the model had nothing to say", and
 * a provider rejecting the call (e.g. OpenCode Go answering
 * `400 … missing x-opencode-session` for a request with no `sessionId`) is
 * exactly the kind of failure that must be visible.
 */
export interface ReviewCallResult {
  /** Assembled advisor text, or null when the call produced no text. */
  text: string | null
  /** Failure message when the stream threw, else null. */
  error: string | null
}

/** How one advisor review attempt ended. */
export type AdvisorOutcome =
  /** A suggestion reached the main agent. */
  | 'delivered'
  /** A suggestion was produced but the agent no longer accepted it. */
  | 'dropped'
  /** The emission guard suppressed a repeat inside the cooldown window. */
  | 'guarded'
  /** The review answered, but carried no actionable `ADVISOR:` envelope. */
  | 'no-emission'
  /** There was nothing to review, or the agent was already gone. */
  | 'skipped'
  /** The review call itself failed (transport/provider/model error). */
  | 'failed'

/**
 * The advisor runtime's live state. Consumed by the diagnostic surface
 * (`dsh_enhance_doctor`, `/doctor`) so "the advisor did nothing" is legible
 * instead of silent — the runtime's own traces only reach stderr.
 */
export interface AdvisorStatus {
  /** Master switch as resolved at wiring time. */
  enabled: boolean
  /** Review calls that reached the model since this runtime was wired. */
  reviews: number
  /** Outcome of the most recent attempt, or null before the first one. */
  outcome: AdvisorOutcome | null
  /** Free-text reason for that outcome (failure message, skip reason, severity). */
  detail: string | null
  /** `provider/model` the last attempt routed on, when it got that far. */
  route: string | null
  /** ISO timestamp of the last attempt, or null before the first one. */
  lastReviewAt: string | null
}

/**
 * Registration handle: the exact disposer plus a live status reader. The status
 * is served through a function (not a snapshot) because the doctor tool and the
 * `/doctor` command read it at call time, long after wiring.
 */
export interface AdvisorHandle {
  /** Unregister the runtime and stop reviewing. */
  dispose(): void
  /** Current status; a fresh copy each call. */
  status(): AdvisorStatus
}

/** A status for a runtime that was never wired (switch off, or no `llm`). */
export function inactiveAdvisorStatus(enabled: boolean): AdvisorStatus {
  return { enabled, reviews: 0, outcome: null, detail: null, route: null, lastReviewAt: null }
}

/**
 * Run one independent advisor review through `ctx.llm.stream()` and assemble
 * the assistant's text output. Pure enough to test with a fake LLM runtime.
 * @param llm - the LLM service (`ctx.llm`); exposes `stream(GenerateOptions)`.
 * @param request - provider/model/messages/system for the review call.
 * @returns the assembled advisor text and, on failure, the transport message.
 */
export async function runReviewCall(
  llm: { stream(options: GenerateOptions): AsyncIterable<StreamChunk> },
  request: GenerateOptions,
): Promise<ReviewCallResult> {
  const assembler = new BlockAssembler()
  try {
    for await (const chunk of llm.stream(request)) {
      assembler.push(chunk)
    }
    const blocks = assembler.blocks().filter(b => b.type === 'text')
    const text = blocks.map(b => 'text' in b ? b.text as string : '').join('\n').trim()
    return { text: text || null, error: null }
  } catch (err) {
    const message = String((err as Error)?.message ?? err)
    trace('review stream FAILED', message)
    return { text: null, error: message }
  }
}

/**
 * Register the advisor companion runtime: on every main agent turn's stop
 * boundary, run one independent review call over the turn's incremental
 * transcript and relay any actionable review back to the main agent.
 * @param ctx - context exposing `llm` and broadcasting `agent/turn-stopping`.
 * @param options - advisor behavior.
 * @returns the disposer plus a live status reader for the diagnostic surface.
 */
export function registerAdvisorRuntime(ctx: Context, options: AdvisorOptions): AdvisorHandle {
  const llm = ctx.llm
  if (!options.enabled || !llm) {
    return { dispose: () => {}, status: () => inactiveAdvisorStatus(options.enabled) }
  }
  const prompt = options.prompt ?? ADVISOR_SYSTEM_PROMPT
  const guard = createEmissionGuard(Date.now, options.windowMs)

  /**
   * Live state for the diagnostic surface. The runtime's own traces only reach
   * stderr, which no user reads, so every decision point below records itself
   * here — that is what turns "the advisor did nothing" into a legible reason.
   */
  const status: AdvisorStatus = inactiveAdvisorStatus(true)

  /** Record the outcome of one attempt (and its route, when routing happened). */
  function record(outcome: AdvisorOutcome, detail: string, route?: string): void {
    status.outcome = outcome
    status.detail = detail
    if (route !== undefined) status.route = route
    status.lastReviewAt = new Date().toISOString()
  }

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

  /**
   * The session identity the review request must carry.
   *
   * `GenerateOptions.sessionId` is what the loop stamps for request routing, and
   * adapters map it to model-hidden transport metadata: the pi-ai adapter
   * forwards it verbatim (`streamSimple({ …, sessionId })`), and the OpenCode Go
   * wrapper adds its **required** `x-opencode-session` header only when it is
   * present (`@earendil-works/pi-ai`'s `opencode-headers.js`). A review that
   * carries no identity is unroutable there and comes back
   * `400 … Request is missing x-opencode-session` — a failed review with no
   * visible trace, which is exactly how this runtime went quiet before.
   *
   * The review belongs to the main session's conversation, so it reuses that
   * identity rather than inventing one. Read defensively: on a disposed agent
   * an accessor may throw `cannot get required service … in inactive context`.
   */
  function sessionIdFor(main: Agent): string | undefined {
    try {
      const id: unknown = main.session.header.id
      return typeof id === 'string' && id.length > 0 ? id : undefined
    } catch {
      return undefined
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
      source: { kind: CONTEXT_SOURCE_KIND },
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
  // host does not accumulate one entry per session forever. The emission guard
  // holds per-agent state too, so it is cleared on the same signal — otherwise a
  // long-lived host keeps one guard entry per session it has ever reviewed.
  const offDisposed = ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => {
    if (typeof agent?.id !== 'string') return
    cursors.delete(agent.id)
    guard.clear(agent.id)
    if (gone.size >= GONE_CAP) gone.clear()
    gone.add(agent.id)
  })

  async function kickReview(main: Agent, id: string): Promise<void> {
    if (isGone(id)) { record('skipped', '主 agent 已销毁'); return }
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
        const message = String((err as Error)?.message ?? err)
        trace('skip: transcript unavailable for', id, message)
        record('skipped', `读不到会话记录：${message}`)
        return
      }
      if (!increment) { trace('skip: empty increment for', id); record('skipped', '本轮没有可审的增量'); return }
      stage = 'route'
      const { provider, model } = routeFor(main)
      const route = `${provider}/${model}`
      const sessionId = sessionIdFor(main)
      const start = Date.now()
      const request: GenerateOptions = {
        provider,
        model,
        messages: [createUserMessage({
          content: [{ type: 'text', text: reviewPrompt(id, increment) }],
          // One rule for everything this bundle produces: the review prompt is our
          // text, not the human's, even though it is only ever a request payload.
          source: { kind: CONTEXT_SOURCE_KIND },
        })],
        system: prompt,
        // Routing identity (see sessionIdFor): without it a provider that
        // requires per-conversation affinity rejects the call.
        ...sessionId === undefined ? {} : { sessionId: sessionId as GenerateOptions['sessionId'] },
      }
      stage = 'stream'
      status.reviews += 1
      const { text: raw, error } = await runReviewCall(llm, request)
      // The call is already counted; record why it goes no further, so the
      // diagnostic surface never pairs a fresh count with a stale outcome.
      if (isGone(id)) { record('skipped', '复核期间主 agent 已销毁', route); return }
      trace('review for', id, 'route=', provider, model, 'incrementChars=', increment.length,
        'tookMs=', Date.now() - start, 'answerLen=', raw?.length ?? 0, 'raw=', JSON.stringify(raw))
      if (raw === null) {
        record(error === null ? 'skipped' : 'failed', error ?? '模型没有返回任何文本', route)
        return
      }
      stage = 'parse'
      const emission = parseAdvisorEmission(raw)
      if (!emission) {
        trace('advisor produced no emission for', id, 'answerLen=', raw.length)
        record('no-emission', `模型未给出 ADVISOR 信封（回答 ${raw.length} 字）`, route)
        return
      }
      if (!guard.gate(id, emission.body)) {
        trace('guarded emission', emission.severity, 'for', id)
        record('guarded', `节流/去重抑制了 ${emission.severity} 建议`, route)
        return
      }
      stage = 'deliver'
      if (!deliver(main, emission)) {
        trace('skip: agent no longer accepts messages, dropped', emission.severity, 'for', id)
        record('dropped', `建议已算出（${emission.severity}），但主 agent 已不再接收消息`, route)
        return
      }
      trace('delivered', emission.severity, 'to', id)
      record('delivered', `已回注 ${emission.severity} 建议`, route)
    } catch (err) {
      const message = String((err as Error)?.message ?? err)
      trace('review FAILED at stage', stage, 'for', id, message)
      record('failed', `${stage} 阶段异常：${message}`)
    }
  }

  return {
    dispose () {
      disposed = true
      offMain?.()
      offDisposed?.()
      cursors.clear()
      gone.clear()
    },
    status: () => ({ ...status }),
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
