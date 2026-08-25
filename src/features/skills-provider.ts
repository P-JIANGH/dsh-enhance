/**
 * Packaged-skill provider for oh-my-dsh: exposes the `skills/` SKILL.md bundles
 * shipped inside this package as read-only candidates. A dedicated provider is
 * the documented way deployments supply packaged skills, so the skills work in
 * any profile without a filesystem root pointing at the package.
 * @module oh-my-dsh/skills-provider
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

/** Prompt-visible source label carried by packaged candidates. */
export const SOURCE = 'bundled'

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
 * @param text - full SKILL.md text.
 * @returns parsed skill, with empty `name`/`description` when the block is missing or malformed.
 */
export function parseSkillBody(text: string): ParsedSkill {
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

/** Absolute path of one skill bundle directory inside this package. */
function skillDir(name: string): string {
  return path.join(SKILLS_ROOT, name)
}

/**
 * Create the packaged-skill provider. Discovery reads every `skills/<name>/SKILL.md`
 * directory; loading rereads the winning body for the caller.
 * @param _control - registration-scoped abort/invalidate control (unused: packaged skills are static).
 * @returns the provider handed to `ctx.skills.registerProvider()`.
 */
export function createSkillsProvider(_control: SkillProviderControl): SkillProvider {
  return {
    name: 'oh-my-dsh',
    async list() {
      const entries = await readdir(SKILLS_ROOT, { withFileTypes: true })
      const candidates: SkillCandidate[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const dir = path.join(SKILLS_ROOT, entry.name)
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
          provider: 'oh-my-dsh',
          rank: BUNDLED_RANK,
          path: skillPath,
          locator: entry.name,
          resourceBase: { kind: 'directory', path: dir },
        })
      }
      return candidates
    },
    async get(candidate) {
      const skillPath = path.join(skillDir(String(candidate.locator)), 'SKILL.md')
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
