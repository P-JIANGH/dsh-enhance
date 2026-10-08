/**
 * Producer provenance for the user-role context this plugin injects.
 *
 * A v4 session admits only **producer-owned** source kinds: the retired generic
 * `{ kind: 'plugin', plugin }` wrapper is refused at admission
 * (`@deepseek-ai/dsh-session-format-v3-to-v4` — "format v4 message requires a
 * producer-owned source kind"), and that same package maps a third-party
 * producer to `plugin:<name>`. Stamping exactly that kind keeps our injections
 * admissible, and keeps them distinguishable from what the human actually
 * typed — which is the only thing `skill-trigger` may read (a `user`-labelled
 * injection once made every new session enter deep-work mode by itself).
 *
 * @module dsh-enhance/shared/provenance
 */

import type {} from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  /**
   * The installed `dsh-llm` types still describe the retired V3 wrapper
   * (`kind: 'plugin'`, which the shipped V4 session format refuses at
   * admission); declaring our own kind is that package's documented extension
   * point ("merge-extensible sum type — plugins add their own `kind`s").
   */
  interface MessageSourceMap {
    'plugin:dsh-enhance': { kind: 'plugin:dsh-enhance' }
  }
}

/** Source kind stamped on every user-role message dsh-enhance injects. */
export const CONTEXT_SOURCE_KIND = 'plugin:dsh-enhance'
