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
  if (!options.enabled || !ctx.llm) return () => {}
  const prompt = options.prompt ?? ADVISOR_SYSTEM_PROMPT
  const guard = createEmissionGuard(Date.now, options.windowMs)

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

  /** Incremental transcript for one main agent since the last review. */
  function extractIncrement(main: Agent): string {
    const msgs = main.session.deriveMessages()
    const from = cursors.get(main.id) ?? 0
    cursors.set(main.id, msgs.length)
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

  /** Deliver one parsed emission back to the owning main agent. */
  function deliver(main: Agent, emission: AdvisorEmission): void {
    const payload = createUserMessage({
      content: [{ type: 'text', text: `[advisor·${emission.severity}] ${emission.body}` }],
      source: { kind: 'user' },
    })
    if (emission.severity === 'nit') main.inject(payload)
    else main.steer(payload)
  }

  /** Build the review prompt handed to the advisor for one transcript increment. */
  function reviewPrompt(main: Agent, increment: string): string {
    return [
      'You are the companion reviewer attached to main-agent session "' + main.session.id + '".',
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
    void kickReview(agent).catch((err) => trace('review async FAILED for', agent.id, String((err as Error)?.message ?? err)))
  })

  async function kickReview(main: Agent): Promise<void> {
    try {
      const increment = extractIncrement(main)
      if (!increment) { trace('skip: empty increment for', main.id); return }
      const { provider, model } = routeFor(main)
      const start = Date.now()
      const request: GenerateOptions = {
        provider,
        model,
        messages: [createUserMessage({
          content: [{ type: 'text', text: reviewPrompt(main, increment) }],
          source: { kind: 'user' },
        })],
        system: prompt,
      }
      const raw = await runReviewCall(ctx.llm, request)
      trace('review for', main.id, 'route=', provider, model, 'incrementChars=', increment.length,
        'tookMs=', Date.now() - start, 'answerLen=', raw?.length ?? 0, 'raw=', JSON.stringify(raw))
      if (raw === null) return
      const emission = parseAdvisorEmission(raw)
      if (!emission) { trace('advisor produced no emission for', main.id, 'answerLen=', raw.length); return }
      if (!guard.gate(main.id, emission.body)) { trace('guarded emission', emission.severity, 'for', main.id); return }
      deliver(main, emission)
      trace('delivered', emission.severity, 'to', main.id)
    } catch (err) {
      trace('review FAILED for', main.id, String((err as Error)?.message ?? err))
    }
  }

  return () => {
    offMain?.()
    cursors.clear()
  }
}

/** LLM message content block carrying a `text` field (best-effort extraction). */
interface TextBlock { type?: string; text?: string }

function messageText(m: Message): string {
  const role = m.role === 'user' ? 'USER: ' : m.role === 'assistant' ? 'ASSISTANT: ' : 'TOOL: '
  const body = Array.isArray(m.content)
    ? m.content
        .map((block) => (block && typeof block === 'object' && 'text' in (block as object)
          ? (block as TextBlock).text : ''))
        .filter(Boolean)
        .join('\n')
    : ''
  return body ? role + body : ''
}
