/**
 * Worktree naming conventions (architecture §5.6 `naming.ts`): directory names
 * are `<work-id>-<slug>`, branches are `dsh/<work-id>`. Pure functions.
 *
 * @module oh-my-dsh/features/worktree/naming
 */

/**
 * Build a safe directory name from a work id and optional slug.
 * Slug is normalized to `[a-z0-9-]`; empty slug yields just the work id.
 * @param workId - the boulder work id.
 * @param slug - optional human-readable slug.
 * @returns a filesystem-safe directory name.
 */
export function worktreeDirName(workId: string, slug?: string): string {
  const base = workId.replace(/[^a-zA-Z0-9-_]/g, '-')
  if (!slug) return base
  const normalized = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized ? `${base}-${normalized}` : base
}

/**
 * Branch name for a work: `dsh/<work-id>` (sanitized).
 * @param workId - the boulder work id.
 * @returns branch name.
 */
export function worktreeBranch(workId: string): string {
  return `dsh/${workId.replace(/[^a-zA-Z0-9-_]/g, '-')}`
}

/** Guess a slug from a plan name or work id for human readability. */
export function slugFrom(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
