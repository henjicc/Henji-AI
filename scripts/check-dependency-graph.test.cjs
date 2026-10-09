const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const madge = require('madge')
const { scan, compare, forbiddenReason, writeBaseline } = require('./check-dependency-graph.cjs')
const { createImportResolver, readResolvedImports, assistantImportViolation } = require('./lib/resolvedImports.cjs')

const fixture = path.join(__dirname, '__fixtures__/dependency-graph')

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-dependency-graph-'))
  fs.cpSync(fixture, root, { recursive: true })
  fs.mkdirSync(path.join(root, 'electron'))
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('henji-dependency-graph-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  return root
}

function write(root, file, source) {
  const target = path.join(root, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source)
}

test('Madge 和 TS 识别五种导入，type-only/dynamic 不算静态值环', async (t) => {
  const root = workspace(t)
  const edges = readResolvedImports(path.join(root, 'src/entry.ts'), root)
  assert.deepEqual(edges.map((edge) => [edge.to, edge.kind]), [
    ['src/alias.ts', 'static'], ['src/relative.ts', 'static'], ['src/types.ts', 'type'],
    ['src/forwarded.ts', 'static'], ['src/type-export.ts', 'type'], ['src/dynamic.ts', 'dynamic'],
  ])
  const graph = await madge(path.join(root, 'src'), { baseDir: root, fileExtensions: ['ts'], tsConfig: path.join(root, 'tsconfig.json') })
  assert.equal(graph.obj()['src/entry.ts'].length, 6)
  write(root, 'src/types.ts', "import type { value } from './entry'; export interface Shape { name: string }")
  write(root, 'src/dynamic.ts', "import { value } from './entry'; export const dynamic = value")
  assert.equal((await scan(root)).cycles.length, 0)
})

test('新增值环显示实际回路；同 SCC 内新增边也失败；减少允许', async (t) => {
  const root = workspace(t)
  const baseline = await scan(root)
  write(root, 'src/alias.ts', "export { value as alias } from './entry'")
  const cyclic = await scan(root)
  assert.ok(compare(cyclic, baseline).some((failure) => /新增静态值环.*src\/alias.ts.*src\/entry.ts/.test(failure)))
  write(root, 'src/relative.ts', "export { alias as relative } from './alias'")
  const expanded = await scan(root)
  assert.ok(compare(expanded, cyclic).some((failure) => failure.includes('新增静态值环')))
  write(root, 'src/alias.ts', "export { value as alias } from './entry'; export { relative } from './relative'")
  const chord = await scan(root)
  assert.equal(chord.cycles.length, expanded.cycles.length)
  assert.deepEqual(chord.cycles[0].members, expanded.cycles[0].members)
  assert.ok(compare(chord, expanded).some((failure) => failure.includes('新增静态值环')))
  assert.deepEqual(compare(baseline, cyclic), [])
})

test('relative/dynamic/re-export/type-only 新增跨层边失败，DTO 不误报', async (t) => {
  const root = workspace(t)
  write(root, 'electron/main/secret.ts', 'export const secret = 1; export interface Secret {}')
  const baseline = await scan(root)
  for (const source of [
    "import { secret } from '../../electron/main/secret'",
    "export { secret } from '../../electron/main/secret'",
    "export const lazy = () => import('../../electron/main/secret')",
    "import type { Secret } from '../../electron/main/secret'",
  ]) {
    write(root, 'src/components/probe.ts', source)
    assert.ok(compare(await scan(root), baseline).some((failure) => failure.includes('新增禁止跨层边')))
  }
  assert.ok(forbiddenReason({ from: 'src/models/presentation/probe.ts', to: 'src/services/probe.ts', kind: 'type' }))
  assert.ok(forbiddenReason({ from: 'electron/main/probe.ts', to: 'src/components/probe.ts', kind: 'dynamic' }))
  assert.equal(forbiddenReason({ from: 'src/components/probe.ts', to: 'src/core/providers/base/types.ts', kind: 'type' }), null)
  assert.ok(forbiddenReason({ from: 'src/components/probe.ts', to: 'src/core/providers/base/ProviderHandler.ts', kind: 'static' }))
  write(root, 'src/core/application-control/probe.ts', "export const lazy = () => import('@/components/probe')")
  assert.ok(compare(await scan(root), baseline).some((failure) => failure.includes('Application API 必须调用方中立')))
})

test('G-01 注册器和核心检查覆盖 alias/relative/dynamic/type/reexport', (t) => {
  const root = workspace(t)
  write(root, 'src/stores/probe.ts', 'export const store = 1; export interface State {}')
  write(root, 'src/features/assistant/probe.ts', 'export const assistant = 1')
  for (const source of [
    "import { store } from '@/stores/probe'",
    "import type { State } from '../../stores/probe'",
    "export { store } from '../../stores/probe'",
    "export const lazy = () => import('../../features/assistant/probe')",
  ]) {
    write(root, 'src/core/application-control/probe.ts', source)
    const edges = readResolvedImports(path.join(root, 'src/core/application-control/probe.ts'), root)
    assert.ok(assistantImportViolation(edges[0]))
  }
  write(root, 'src/features/application-control/capabilities/registry.ts', "export const lazy = () => import('../../assistant/probe')")
  assert.ok(assistantImportViolation(readResolvedImports(path.join(root, 'src/features/application-control/capabilities/registry.ts'), root)[0]))
  assert.equal(assistantImportViolation({ from: 'src/core/application-control/probe.ts', to: 'src/core/types/workspace.ts' }), null)
})

test('矩阵逐语句计数且逐格冻结，公开 index 允许', async (t) => {
  const root = workspace(t)
  write(root, 'src/features/a/probe.ts', "export { value } from '../b/private'")
  write(root, 'src/features/b/private.ts', 'export const value = 1')
  write(root, 'src/features/b/index.ts', "export { value } from './private'")
  const baseline = await scan(root)
  assert.equal(baseline.featureMatrix['a → b'], 1)
  write(root, 'src/features/a/probe.ts', "export { value } from '../b/private'; export const lazy = () => import('../b/private')")
  const current = await scan(root)
  assert.equal(current.featureMatrix['a → b'], 2)
  assert.ok(compare(current, baseline).some((failure) => failure.includes('a → b：2 > 基线 1')))
  write(root, 'src/features/a/probe.ts', "export { value } from '../b/index'")
  assert.deepEqual(compare(await scan(root), baseline), [])
  write(root, 'src/features/b/private/index.ts', 'export const value = 1')
  write(root, 'src/features/a/probe.ts', "export { value } from '../b/private/index'")
  assert.equal((await scan(root)).featureMatrix['a → b'], 1)
})

test('缩减可写回；新增默认拒绝且不写文件，显式例外保存理由', async (t) => {
  const root = workspace(t)
  const filename = path.join(root, 'baseline.json')
  const baseline = await scan(root)
  assert.throws(() => writeBaseline(filename, baseline, null), /拒绝写入/)
  writeBaseline(filename, baseline, null, '初次冻结夹具')
  const before = fs.readFileSync(filename, 'utf8')
  write(root, 'src/alias.ts', "export { value as alias } from './entry'")
  const current = await scan(root)
  assert.throws(() => writeBaseline(filename, current, baseline), /新增静态值环/)
  assert.equal(fs.readFileSync(filename, 'utf8'), before)
  writeBaseline(filename, current, baseline, '测试新增登记')
  assert.equal(JSON.parse(fs.readFileSync(filename, 'utf8')).exceptions[0].reason, '测试新增登记')
  writeBaseline(filename, baseline, current)
  assert.equal(JSON.parse(fs.readFileSync(filename, 'utf8')).cycles.length, 0)
})

test('解析失败不能漏边后通过', (t) => {
  const root = workspace(t)
  write(root, 'src/missing.ts', "import { missing } from '@/missing-target'")
  assert.throws(() => readResolvedImports(path.join(root, 'src/missing.ts'), root, createImportResolver(root)), /无法解析本地依赖/)
  write(root, 'src/wrong-case.ts', "import { alias } from '@/Alias'")
  assert.throws(() => readResolvedImports(path.join(root, 'src/wrong-case.ts'), root), /大小写不一致|无法解析本地依赖/)
})
