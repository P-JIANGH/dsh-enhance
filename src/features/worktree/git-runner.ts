/**
 * Injectable git subprocess runner for the worktree manager (architecture §5.6
 * `git-runner.ts`). Wraps `git worktree add/list/remove/prune` and
 * `rev-parse`. The command executor is injectable so unit tests can stub git
 * output without a real repository. Defaults to `child_process.execFile`.
 *
 * @module dsh-enhance/features/worktree/git-runner
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Result of a git subprocess call. */
export interface GitResult {
  stdout: string
  stderr: string
  code: number
  ok: boolean
}

/**
 * A runnable command that returns parsed output. Implementations may be the
 * real `execFile`-backed runner or a test stub.
 */
export interface GitRunner {
  /** Run `git <args>` in `cwd`, returning raw stdout/stderr + exit code. */
  run(args: string[], cwd: string): Promise<GitResult>
  /** Run one git command and require success; throws GitError on failure. */
  must(args: string[], cwd: string): Promise<string>
}

/** Error thrown when a required git command fails. */
export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly result: GitResult,
  ) {
    super(`git ${args.join(' ')} failed (${result.code}): ${result.stderr.trim()}`)
    this.name = 'GitError'
  }
}

/**
 * Create the default git runner backed by execFile.
 * @param gitBin - git executable (default `git`).
 * @returns a {@link GitRunner}.
 */
export function createGitRunner(gitBin = 'git'): GitRunner {
  return {
    async run(args, cwd) {
      try {
        const { stdout, stderr } = await execFileAsync(gitBin, args, { cwd, encoding: 'utf8' })
        return { stdout, stderr, code: 0, ok: true }
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string }
        return {
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? '',
          code: typeof e.code === 'number' ? e.code : -1,
          ok: false,
        }
      }
    },
    async must(args, cwd) {
      const res = await this.run(args, cwd)
      if (!res.ok) throw new GitError(args, res)
      return res.stdout
    },
  }
}
