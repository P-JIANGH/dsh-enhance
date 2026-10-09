/**
 * Producer provenance for the user-role context this bundle injects.
 *
 * `@deepseek-ai/dsh-llm` states the contract in its own words: `MessageSourceMap`
 * is a "merge-extensible sum type — each producer declares its own `kind` in its
 * own module; there is no shared catch-all `plugin` kind. Model and tool sources
 * answer their role messages; **user messages carry any producer's kind**, and
 * consumers fall through unknown kinds."
 *
 * So `{ kind: 'user' }` is not the default for an injection — it is a *specific*
 * claim ("the human typed this"). Text stamped that way is indistinguishable from
 * human input for every consumer that switches on `kind`, which is exactly how a
 * plugin-made message once drove a session into deep work by itself. Declaring our
 * own kind keeps every injection attributable in the durable log and inside the
 * harness's own vocabulary.
 *
 * @module dsh-enhance/shared/provenance
 */

import type {} from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  /**
   * The documented extension point for a producer's own kind. A third-party
   * producer maps to `plugin:<name>` (`@deepseek-ai/dsh-session-format-v3-to-v4`),
   * and the retired generic `{ kind: 'plugin', plugin }` wrapper is refused at
   * admission — "format v4 message requires a producer-owned source kind".
   */
  interface MessageSourceMap {
    'plugin:dsh-enhance': { kind: 'plugin:dsh-enhance' }
  }
}

/** Source kind stamped on every user-role message this bundle injects. */
export const CONTEXT_SOURCE_KIND = 'plugin:dsh-enhance'
