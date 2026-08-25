/**
 * Atomic file persistence + process lock, shared by boulder/goal storage.
 * Mirrors architecture §5.5 write protocol: write-tmp-then-rename for atomic
 * replacement, and an mkdir-created lock file with stale detection.
 * @module oh-my-dsh/shared/atomic-write
 */

import {
  mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, statSync, rmSync,
} from 'node:fs'
import path from 'node:path'

/** Default maximum lock age in ms before a holder is treated as stale. */
export const DEFAULT_LOCK_STALE_MS = 30_000

/**
 * Atomically replace `target` with `serialized`: write a sibling temp file then
 * rename over the target (same directory ⇒ same volume, so rename is atomic).
 * @param target - destination file path.
 * @param serialized - full content to write.
 * @returns nothing.
 */
export function atomicWriteFile(target: string, serialized: string): void {
  const dir = path.dirname(target)
  mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`)
  try {
    writeFileSync(tmp, serialized, 'utf8')
    renameSync(tmp, target)
  } finally {
    // Best-effort cleanup of the temp file if rename failed or was interrupted.
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * Read a JSON file, returning `null` on any read/parse failure (bad file must
 * not crash the session — architecture §5.5.6).
 * @param file - path.
 * @returns parsed JSON, or null when missing/unreadable/malformed.
 */
export function readJsonOrNull<T>(file: string): T | null {
  try {
    const raw = readFileSync(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Result of a lock acquisition attempt. */
export type LockResult =
  | { ok: true; released: () => void }
  | { ok: false; reason: string }

/**
 * Acquire a directory-based process lock via atomic mkdir. Stale detection:
 * if the lock dir already exists but is older than `staleMs`, steal it.
 * @param lockPath - lock directory path.
 * @param staleMs - staleness threshold.
 * @returns an ok result with a release function, or a failure reason.
 */
export function acquireLock(lockPath: string, staleMs = DEFAULT_LOCK_STALE_MS): LockResult {
  const holder = lockPath + '.holder'
  try {
    // Atomic mkdir: succeeds only if the directory did not exist.
    mkdirSync(lockPath)
    writeFileSync(holder, `${process.pid}\n${Date.now()}\n`, 'utf8')
    let done = false
    return {
      ok: true,
      released: () => {
        if (done) return
        done = true
        try { rmSync(holder, { force: true }) } catch { /* ignore */ }
        try { rmSync(lockPath, { recursive: true, force: true }) } catch { /* ignore */ }
      },
    }
  } catch {
    // Directory exists: check staleness.
    try {
      const st = statSync(lockPath)
      if (Date.now() - st.mtimeMs > staleMs) {
        try { rmSync(lockPath, { recursive: true, force: true }) } catch { /* ignore */ }
        // Retry once after stealing.
        try {
          mkdirSync(lockPath)
          writeFileSync(holder, `${process.pid}\n${Date.now()}\n`, 'utf8')
          let done = false
          return {
            ok: true,
            released: () => {
              if (done) return
              done = true
              try { rmSync(holder, { force: true }) } catch { /* ignore */ }
              try { rmSync(lockPath, { recursive: true, force: true }) } catch { /* ignore */ }
            },
          }
        } catch {
          return { ok: false, reason: 'lock contested after stale takeover' }
        }
      }
      return { ok: false, reason: 'lock held by a live process' }
    } catch {
      return { ok: false, reason: 'cannot stat lock' }
    }
  }
}

/** Remove a lock directory unconditionally (used in tests/cleanup). */
export function forceReleaseLock(lockPath: string): void {
  try { rmSync(lockPath, { recursive: true, force: true }) } catch { /* ignore */ }
}
