/**
 * M3 guard logic (architecture §5.2-A). Pure, testable decision functions that
 * a `ctx.tools.guard` wraps. They are deep defense on top of dsh's own fs and
 * sandbox: they add a session-readable set, path containment, an output cap.
 *
 * Defaults are conservative but the hooks are behind `config.guards` so a
 * deployment that fully trusts dsh's fs/observation policy can leave them off.
 *
 * **Which of these are actually wired (and why the rest are not):**
 * - wired: `guardPathTraversal` (on `write`, via `guard-register`), plus the
 *   read-set bookkeeping used by `bashReadPaths`.
 * - `guardWriteExisting` is deliberately **not** enforced at runtime: dsh's own
 *   `fs-observation-policy` already owns read-before-write, and a second policy
 *   would conflict with it. It stays exported (and unit-tested) as the documented
 *   decision function a deployment can opt into.
 * - `truncateText` is deliberately **not** wired as a result transformer: dsh's
 *   native `tool-result-pruner` / spill policy already caps tool output, and the
 *   shipped presets mount the pruner (thresholdChars 8192). Re-truncating on top
 *   would double-count the budget.
 * - `bashReadPaths` is best-effort: path escapes are the sandbox's job, this only
 *   feeds the "was this path observed as read" bookkeeping.
 *
 * @module dsh-enhance/tools/guards
 */

import { isContained } from '../shared/path.js'

/** Cap on paths tracked as read per session. */
export const READ_TRACK_CAP = 1024

/**
 * Extract the primary file path from a read/write tool's arguments.
 * dsh's read/write use `file_path` (snake_case). Handles unknown shapes safely.
 * @param args - parsed tool arguments.
 * @returns the path string, or undefined when the call is not a filesystem write.
 */
export function filePathOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const v = (args as Record<string, unknown>).file_path
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * A core "write-existing" guard: refuse to write-overwrite a path that has not
 * been observed as read in this session (unless the platform policy demands
 * force). `readSet` is the caller-tracked set of read paths.
 * @param args - tool arguments.
 * @param readSet - set of observed read paths (compareKey-normalized by caller).
 * @param root - session workspace root.
 * @param force - when true (e.g. create-only policy), skip the read requirement.
 * @returns a rejection reason, or undefined to allow.
 */
export function guardWriteExisting(
  args: unknown,
  readSet: ReadonlySet<string>,
  root: string,
  force = false,
): string | undefined {
  if (force) return undefined
  const p = filePathOf(args)
  if (p === undefined) return undefined // not a file write we recognize
  if (readSet.has(p)) return undefined
  // Paths inside the root but not tracked: reject unless it's a new file.
  if (!isContained(p, root)) return '路径越界：写目标在工作区根目录之外，已拒绝'
  return `写入被拒绝：路径未在本会话读过（${p}）。请先用 read 读取再写，或在 force 下新建文件`
}

/**
 * Path-traversal guard: the write target must stay inside the workspace root.
 * Pure lexical check (symlink escape is handled by dsh's fs backend/realpath).
 * @param args - tool arguments.
 * @param root - session workspace root.
 * @returns a reason when escaping, or undefined when contained.
 */
export function guardPathTraversal(args: unknown, root: string): string | undefined {
  const p = filePathOf(args)
  if (p === undefined) return undefined
  if (isContained(p, root)) return undefined
  return `路径越界：${p} 在会话工作区根目录之外，已拒绝写入`
}

/**
 * Bash-file-read guard: naive extraction of read refs from a bash command so a
 * later write of the same path can be considered observed. This is best-effort
 * deep defense; dsh's sandbox is the authoritative reader.
 * @param command - the bash command string.
 * @returns normalized paths the command appears to read, as an array.
 */
export function bashReadPaths(command: string): string[] {
  const out: string[] = []
  if (!command) return out
  // cat <path> / gcc <path> / `<path` redirections — a pragmatic start.
  const re = /(?:^|\s)(?:cat|head|tail|sed|awk|grep|less|more|cc|g\+\+|clang|gcc|node|python3?|rg|grep)\s+([^\s|;&<>]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command)) !== null) {
    const p = m[1]
    if (p && !p.startsWith('-')) out.push(p)
  }
  return out
}

/**
 * Output truncator decision: how many chars of a text result to keep.
 * @param text - the tool's rendered text.
 * @param cap - maximum characters.
 * @returns the truncated text (with an ellipsis marker appended when cut).
 */
export function truncateText(text: string, cap: number): string {
  if (text.length <= cap) return text
  return text.slice(0, cap) + '…[输出超出上限，已截断]'
}
