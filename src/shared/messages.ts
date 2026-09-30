/**
 * Message-text extraction shared by the hooks that need to read what the model
 * actually said — the advisor's transcript increments (features/advisor) and the
 * delivery gate's completion-claim detection (hooks/delivery-gate).
 *
 * Kept in one place on purpose: two implementations of "get the text out of a
 * message" would drift, and the claim detector's sensitivity depends on exactly
 * which bytes it sees.
 *
 * @module dsh-enhance/shared/messages
 */

import type { Message } from '@deepseek-ai/dsh-llm'

/** LLM message content block carrying a `text` field (best-effort extraction). */
interface TextBlock { type?: string; text?: string }

/**
 * Best-effort plain text of one message: the `text` fields of its content blocks
 * joined by newlines. Returns `''` for non-text content (tool calls, images).
 * @param m - an LLM message.
 * @returns the concatenated text, or `''`.
 */
export function messageText(m: Message): string {
  if (!Array.isArray(m.content)) return ''
  return m.content
    .map(block => (block && typeof block === 'object' && 'text' in (block as object)
      ? ((block as TextBlock).text ?? '')
      : ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * Text of the newest assistant message, or `''` when the session has none yet.
 * This is the surface a completion claim is read from.
 * @param msgs - derived session messages, oldest first.
 * @returns the last non-empty assistant text.
 */
export function lastAssistantText(msgs: readonly Message[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m?.role === 'assistant') {
      const text = messageText(m)
      if (text) return text
    }
  }
  return ''
}
