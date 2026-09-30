// 预设安装脚本单测：幂等、先备份后覆盖、改名残留可清理、--check 判定。
//
// 触发原因：实机上插件装好了，但用户家目录的 `.agent-presets/` 里一个本包预设都
// 没有——只有 6 个 composition 指向旧包名 `oh-my-dsh` 的残留（该包已改名，
// 不可解析 → 选中即挂载失败）。README 的手工 `cp` 步骤从来没有被执行过。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SOURCE_ROOT,
  backupRootFor,
  dirsEqual,
  discoverPresetIds,
  findRenamedPresets,
  installPresets,
  parseArgs,
} from '../scripts/install-presets.mjs'

/** 造一个源预设根：`ids` 各带 composition + preset.yml。 */
function makeSource(root, ids) {
  for (const id of ids) {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, 'agent.cordis.yml'), `- id: dsh-enhance\n  name: '@dsh-enhance/dsh-enhance'\n`)
    writeFileSync(join(root, id, 'preset.yml'), `name: ${id}\ndescription: test preset\n`)
  }
  return root
}

/** 带清理的临时目录脚手架。 */
function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-install-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('[install-presets] 仓库自带的预设目录恰好是 6 个，含主编排预设', () => {
  assert.deepEqual(
    discoverPresetIds(SOURCE_ROOT),
    ['dsh-enhance', 'librarian', 'planner', 'reviewer', 'scout', 'task'],
  )
})

test('[install-presets] 只认带 composition 的非隐藏目录', () => {
  withTemp((dir) => {
    makeSource(dir, ['alpha'])
    mkdirSync(join(dir, '.hidden'), { recursive: true })
    writeFileSync(join(dir, '.hidden', 'agent.cordis.yml'), '[]\n')
    mkdirSync(join(dir, 'no-composition'), { recursive: true })
    writeFileSync(join(dir, 'no-composition', 'preset.yml'), 'name: x\n')
    writeFileSync(join(dir, 'stray.txt'), 'not a preset\n')
    assert.deepEqual(discoverPresetIds(dir), ['alpha'])
  })
})

test('[install-presets] 空目标根：全量安装并可复判为最新', () => {
  withTemp((dir) => {
    const source = makeSource(join(dir, 'src'), ['alpha', 'beta'])
    const target = join(dir, 'target')
    const result = installPresets({ sourceRoot: source, targetRoot: target })
    assert.equal(result.summary.installed, 2)
    assert.equal(result.summary.replaced, 0)
    assert.equal(result.checkOk, true)
    assert.equal(existsSync(join(target, 'alpha', 'agent.cordis.yml')), true)
    assert.equal(dirsEqual(join(source, 'alpha'), join(target, 'alpha')), true)
    // 装完再判一次：应当已是最新，且不再产生备份。
    const again = installPresets({ sourceRoot: source, targetRoot: target })
    assert.equal(again.summary.installed, 0)
    assert.equal(again.summary.unchanged, 2)
    assert.equal(again.backupRoot, null, '无改动就不该产生备份目录')
  })
})

test('[install-presets] 目标内容不同：先备份旧副本再覆盖', () => {
  withTemp((dir) => {
    const source = makeSource(join(dir, 'src'), ['alpha'])
    const target = join(dir, 'target')
    installPresets({ sourceRoot: source, targetRoot: target })
    writeFileSync(join(target, 'alpha', 'preset.yml'), 'name: 手工改过的旧副本\n')

    const result = installPresets({ sourceRoot: source, targetRoot: target })
    assert.equal(result.summary.replaced, 1)
    assert.ok(result.backupRoot, '覆盖前必须备份')
    // 备份里是旧内容，目标里是新内容。
    assert.match(readFileSync(join(result.backupRoot, 'alpha', 'preset.yml'), 'utf8'), /手工改过的旧副本/)
    assert.equal(dirsEqual(join(source, 'alpha'), join(target, 'alpha')), true)
    // 备份是目标根的同级目录，不会被预设扫描当成名册条目。
    assert.equal(result.backupRoot.startsWith(target), false)
  })
})

test('[install-presets] --prune-renamed 备份后清理指向旧包名的残留', () => {
  withTemp((dir) => {
    const source = makeSource(join(dir, 'src'), ['alpha'])
    const target = join(dir, 'target')
    mkdirSync(join(target, 'omd'), { recursive: true })
    writeFileSync(join(target, 'omd', 'agent.cordis.yml'), "- id: oh-my-dsh\n  name: oh-my-dsh\n")
    writeFileSync(join(target, 'omd', 'preset.yml'), 'name: oh-my-dsh\n')

    assert.deepEqual(findRenamedPresets(target).map(p => p.id), ['omd'])
    // 不带开关：不碰用户目录。
    installPresets({ sourceRoot: source, targetRoot: target })
    assert.equal(existsSync(join(target, 'omd')), true, '未要求清理时不得删除残留')

    const result = installPresets({ sourceRoot: source, targetRoot: target, pruneRenamed: true })
    assert.equal(result.summary.pruned, 1)
    assert.equal(existsSync(join(target, 'omd')), false)
    assert.equal(existsSync(join(result.backupRoot, 'omd', 'agent.cordis.yml')), true, '删前必须备份')
  })
})

test('[install-presets] 同名旧副本先更新、只有异名残留才清理（不得先装后删）', () => {
  withTemp((dir) => {
    const source = makeSource(join(dir, 'src'), ['alpha'])
    const target = join(dir, 'target')
    // 同名 alpha 是旧包名的副本：应被「更新」为新内容，而不是当作残留删掉。
    mkdirSync(join(target, 'alpha'), { recursive: true })
    writeFileSync(join(target, 'alpha', 'agent.cordis.yml'), "- id: oh-my-dsh\n  name: oh-my-dsh\n")
    writeFileSync(join(target, 'alpha', 'preset.yml'), 'name: alpha\n')
    // 异名 omd 是纯残留：应被清理。
    mkdirSync(join(target, 'omd'), { recursive: true })
    writeFileSync(join(target, 'omd', 'agent.cordis.yml'), "- id: oh-my-dsh\n  name: oh-my-dsh\n")

    const result = installPresets({ sourceRoot: source, targetRoot: target, pruneRenamed: true })
    assert.deepEqual(result.plan.renamed.map(p => p.id), ['omd'], '同名预设不得进入残留清单')
    assert.equal(result.summary.replaced, 1)
    assert.equal(result.summary.pruned, 1)
    assert.equal(existsSync(join(target, 'omd')), false)
    assert.equal(existsSync(join(target, 'alpha', 'agent.cordis.yml')), true, '同名预设更新后必须仍然存在')
    assert.match(readFileSync(join(target, 'alpha', 'agent.cordis.yml'), 'utf8'), /@dsh-enhance\/dsh-enhance/)
  })
})

test('[install-presets] --check 只判定不写盘，缺失即失败', () => {
  withTemp((dir) => {
    const source = makeSource(join(dir, 'src'), ['alpha'])
    const target = join(dir, 'target')
    const missing = installPresets({ sourceRoot: source, targetRoot: target, check: true })
    assert.equal(missing.checkOk, false)
    assert.equal(missing.wrote, false)
    assert.equal(existsSync(target), false, '--check 不应创建目标目录')

    installPresets({ sourceRoot: source, targetRoot: target })
    const current = installPresets({ sourceRoot: source, targetRoot: target, check: true })
    assert.equal(current.checkOk, true)
  })
})

test('[install-presets] --dry-run 只报计划', () => {
  withTemp((dir) => {
    const source = makeSource(join(dir, 'src'), ['alpha'])
    const target = join(dir, 'target')
    const result = installPresets({ sourceRoot: source, targetRoot: target, dryRun: true })
    assert.equal(result.plan.entries[0].action, 'install')
    assert.equal(result.wrote, false)
    assert.equal(result.backupRoot, null)
    assert.equal(existsSync(target), false)
  })
})

test('[install-presets] 参数解析：未知参数拉响，--target 归一为绝对路径', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--prune-renamed']), {
    targetRoot: undefined,
    pruneRenamed: true,
    dryRun: true,
    check: false,
  })
  const parsed = parseArgs(['--target', '.'])
  assert.equal(parsed.targetRoot, process.cwd())
  assert.throws(() => parseArgs(['--nope']), /未知参数/)
  assert.throws(() => parseArgs(['--target']), /需要一个目录参数/)
  assert.equal(parseArgs(['--help']).help, true)
})

test('[install-presets] backupRootFor 不覆盖已存在的备份目录', () => {
  withTemp((dir) => {
    const target = join(dir, 'agent-presets')
    const when = new Date('2026-09-30T12:36:19Z')
    const first = backupRootFor(target, when)
    mkdirSync(first, { recursive: true })
    const second = backupRootFor(target, when)
    assert.notEqual(first, second)
    assert.equal(existsSync(first), true)
    assert.equal(existsSync(second), false)
  })
})
