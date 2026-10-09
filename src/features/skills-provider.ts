/**
 * Packaged-skill provider for dsh-enhance: exposes the `skills/` SKILL.md bundles
 * shipped inside this package as read-only candidates. A dedicated provider is
 * the documented way deployments supply packaged skills, so the skills work in
 * any profile without a filesystem root pointing at the package.
 * @module dsh-enhance/skills-provider
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SkillCandidate,
  SkillInvocationPolicy,
  SkillProvider,
  SkillProviderControl,
} from '@deepseek-ai/dsh-skill'

/** Rank of packaged candidates: bundled skills rank below every user root. */
export const BUNDLED_RANK = 600

/**
 * Prompt-visible source label carried by packaged candidates.
 *
 * NOT an ownership signal: every provider that ships skills on disk labels them
 * `bundled`, so a profile can show several unrelated `bundled` skills (the
 * desktop profile ships `office-*` and others). Use {@link PROVIDER} to tell
 * which skills *this* bundle contributes.
 */
export const SOURCE = 'bundled'

/** Provider name this bundle registers; the accurate "is it ours" signal. */
export const PROVIDER = 'dsh-enhance'

/** Absolute path of the packaged skill bundles directory. */
export const SKILLS_ROOT = fileURLToPath(new URL('../../skills/', import.meta.url))

/** A parsed SKILL.md body: frontmatter metadata plus the instruction body. */
export interface ParsedSkill {
  /** Kebab-case skill name from frontmatter. */
  name: string
  /** Routing description from frontmatter. */
  description: string
  /** Markdown instruction body after the frontmatter block. */
  content: string
  /** Resolved model/user invocation controls. */
  invocation: SkillInvocationPolicy
}

/**
 * Parse the `---`-fenced frontmatter block off a SKILL.md body. Recognized
 * keys: `name`, `description`, `disable-model-invocation`, `user-invocable`
 * (the exact keys the filesystem provider reads). Unknown keys are ignored.
 *
 * Line endings are normalised to `\n` first, and that is not cosmetic: a Windows
 * checkout (git's `core.autocrlf=true` default, and what CI's Windows runner
 * produces) hands us CRLF, the old `\n`-anchored fence then never matched, and
 * `list()` silently skipped **every** packaged skill. The bundle looked healthy —
 * the directory existed, the plugin row activated — while contributing zero
 * skills. A `github:` install on Windows is exactly that path.
 *
 * @param text - full SKILL.md text, LF or CRLF.
 * @returns parsed skill, with empty `name`/`description` when the block is missing or malformed.
 */
export function parseSkillBody(raw: string): ParsedSkill {
  const text = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match?.[1] || !match[2]) {
    return { name: '', description: '', content: text, invocation: { modelInvocable: true, userInvocable: true } }
  }
  const frontmatter: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return {
    name: frontmatter['name'] ?? '',
    description: frontmatter['description'] ?? '',
    content: match[2],
    invocation: {
      modelInvocable: frontmatter['disable-model-invocation'] !== 'true',
      userInvocable: frontmatter['user-invocable'] !== 'false',
    },
  }
}

/** Absolute path of one skill bundle directory inside a skills root. */
function skillDir(name: string, root: string = SKILLS_ROOT): string {
  return path.join(root, name)
}

/**
 * Create the packaged-skill provider. Discovery reads every `skills/<name>/SKILL.md`
 * directory; loading rereads the winning body for the caller.
 * @param _control - registration-scoped abort/invalidate control (unused: packaged skills are static).
 * @param root - skills root to read; defaults to this package's own `skills/`.
 *   Injectable so a test can exercise CRLF files end to end without touching the
 *   repository's own tree (tests must not write to the working tree).
 * @returns the provider handed to `ctx.skills.registerProvider()`.
 */
export function createSkillsProvider(_control: SkillProviderControl, root: string = SKILLS_ROOT): SkillProvider {
  return {
    name: 'dsh-enhance',
    async list() {
      const entries = await readdir(root, { withFileTypes: true })
      const candidates: SkillCandidate[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dir = path.join(root, entry.name)
        const skillPath = path.join(dir, 'SKILL.md')
        let parsed: ParsedSkill
        try {
          parsed = parseSkillBody(await readFile(skillPath, 'utf8'))
        } catch {
          continue
        }
        if (!parsed.name || !parsed.description) continue
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          invocation: parsed.invocation,
          source: SOURCE,
          provider: PROVIDER,
          rank: BUNDLED_RANK,
          path: skillPath,
          locator: entry.name,
          resourceBase: { kind: 'directory', path: dir },
        })
      }
      return candidates
    },
    async get(candidate) {
      const skillPath = path.join(skillDir(String(candidate.locator), root), 'SKILL.md')
      const parsed = parseSkillBody(await readFile(skillPath, 'utf8'))
      if (parsed.name !== candidate.name) return undefined
      return { ...candidate, content: parsed.content }
    },
  }
}

/**
 * Register the packaged-skill provider into the calling context's layer.
 * @param ctx - context with the `skills` service.
 * @returns the exact disposer that unregisters the provider.
 */
export function registerSkillsProvider(ctx: Context): () => void {
  return ctx.skills.registerProvider(createSkillsProvider)
}
