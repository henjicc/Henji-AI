const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { normalizeReport, compareBaseline, checkExportEntries, check } = require('./check-dead-code.cjs')

test('新增文件、依赖、未使用导出、类型与重复导出均失败，已登记且写明理由的可通过', () => {
  const current = normalizeReport({ issues: [{
    file: 'package.json',
    dependencies: [{ name: 'unused-dependency' }],
    exports: [{ name: 'exportOnly' }],
    types: [{ name: 'TypeOnly' }],
    duplicates: [[{ name: 'second' }, { name: 'first' }]],
    files: [{ name: 'unused.ts' }],
  }] })
  assert.deepEqual(current.exports, ['package.json:TypeOnly', 'package.json:exportOnly', 'package.json:first=second'])
  const empty = { files: [], dependencies: [], exports: [] }
  assert.deepEqual(compareBaseline(current, empty), [
    '新增未使用 files: unused.ts',
    '新增未使用 dependencies: package.json:unused-dependency',
    '新增未使用导出/类型/重复导出: package.json:TypeOnly',
    '新增未使用导出/类型/重复导出: package.json:exportOnly',
    '新增未使用导出/类型/重复导出: package.json:first=second',
  ])
  const registered = { files: current.files, dependencies: current.dependencies, exports: current.exports.map(item => ({ file: 'package.json', name: item.slice('package.json:'.length), reason: '测试登记' })) }
  assert.deepEqual(compareBaseline(current, registered), [])
  assert.deepEqual(checkExportEntries(current, registered), { errors: [], stale: [] })
  assert.deepEqual(compareBaseline({ files: [], dependencies: [], exports: [] }, registered), [])
  assert.throws(() => normalizeReport({}), /有效 issues/)
})
test('导出基线条目必须写明理由，且已消失的条目视为过期', () => {
  const current = { exports: ['a.ts:kept'] }
  const result = checkExportEntries(current, { exports: [{ file: 'a.ts', name: 'kept', reason: '' }, { file: 'a.ts', name: 'gone', reason: '已不存在' }] })
  assert.deepEqual(result.errors, ['导出基线条目缺少理由: a.ts:kept'])
  assert.deepEqual(result.stale.map(item => item.name), ['gone'])
})
test('真实 Knip 检测孤立文件/依赖/未使用导出；写回拒绝新增且保持基线不变，写回时清掉过期条目', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-dead-code-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dead-code-fixture', private: true, dependencies: { 'unused-fixture-dependency': '1.0.0' } }))
  fs.writeFileSync(path.join(root, 'knip.json'), JSON.stringify({ entry: ['entry.ts'], project: ['*.ts'] }))
  fs.writeFileSync(path.join(root, 'entry.ts'), "import { shared } from './lib'\nexport const used = shared\n")
  fs.writeFileSync(path.join(root, 'lib.ts'), 'export const shared = true\nexport const unusedExport = true\n')
  fs.writeFileSync(path.join(root, 'orphan.ts'), "export const orphan = true\n")
  const baseline = path.join(root, 'baseline.json')
  const empty = { version: 1, files: [], dependencies: [] }
  fs.writeFileSync(baseline, JSON.stringify(empty))
  const before = fs.readFileSync(baseline, 'utf8')
  const result = check(root, baseline, true)
  assert.ok(result.errors.includes('新增未使用 files: orphan.ts'))
  assert.ok(result.errors.includes('新增未使用 dependencies: package.json:unused-fixture-dependency'))
  assert.ok(result.errors.includes('新增未使用导出/类型/重复导出: lib.ts:unusedExport'))
  assert.equal(fs.readFileSync(baseline, 'utf8'), before)
  fs.writeFileSync(baseline, JSON.stringify({ ...empty, files: result.files, dependencies: result.dependencies, exports: [{ file: 'lib.ts', name: 'unusedExport', reason: '测试登记' }] }))
  assert.deepEqual(check(root, baseline, false).errors, [])
  fs.unlinkSync(path.join(root, 'orphan.ts'))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dead-code-fixture', private: true }))
  fs.writeFileSync(path.join(root, 'lib.ts'), 'export const shared = true\n')
  assert.deepEqual(check(root, baseline, false).errors, ['过期导出基线条目，须删除: lib.ts:unusedExport'])
  assert.deepEqual(check(root, baseline, true).errors, [])
  const written = JSON.parse(fs.readFileSync(baseline, 'utf8'))
  assert.deepEqual([written.files, written.dependencies, written.exports], [[], [], []])
})
