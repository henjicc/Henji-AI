const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const madge = require('madge')
const { scan, compare, forbiddenReason, writeBaseline, firstScreenReachability,
  FIRST_SCREEN_HEAVY_PACKAGES, FIRST_SCREEN_HEAVY_MODULE_PREFIXES, PURE_CORE_DIRECTORIES } = require('./check-dependency-graph.cjs')
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

test('纯 core 子域禁止所有导入形式，并且基线及 accept-new 不能豁免', async (t) => {
  const root = workspace(t)
  for (const directory of ['features', 'stores', 'components']) {
    write(root, `src/${directory}/probe.ts`, 'export const value = 1; export interface State {}')
  }
  const baseline = await scan(root)
  for (const directory of PURE_CORE_DIRECTORIES) {
    for (const target of ['features', 'stores', 'components']) {
      for (const source of [
        `import { value } from '@/${target}/probe'; export { value }`,
        `import type { State } from '../../${target}/probe'; export type { State }`,
        `export { value } from '../../${target}/probe'`,
        `export const lazy = () => import('../../${target}/probe')`,
      ]) {
        const file = `src/core/${directory}/probe.ts`
        write(root, file, source)
        const edge = readResolvedImports(path.join(root, file), root)[0]
        assert.ok(forbiddenReason(edge), `${directory}/${target}: ${source}`)
      }
    }
    write(root, `src/core/${directory}/probe.ts`, "export { value } from '@/core/shared'")
  }
  write(root, 'src/core/shared.ts', 'export const value = 1')
  assert.deepEqual(compare(await scan(root), baseline), [])
  write(root, 'src/core/imageEdit/probe.ts', "export { value } from '@/features/probe'")
  const current = await scan(root)
  assert.ok(compare(current, current).some((failure) => failure.includes('纯 core 禁止跨层边')))
  assert.throws(() => writeBaseline(path.join(root, 'baseline.json'), current, current, '请求豁免'), /不得登记/)
  // 不扩大 renderer-only core 的纯层定义，已有冻结边仍可缩减。
  assert.equal(forbiddenReason({ from: 'src/core/services/probe.ts', to: 'src/components/probe.ts', kind: 'type' }), null)
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

test('首屏只沿静态值边；重包子路径和编辑/GPU 执行器均输出完整入口路径', () => {
  const edges = [
    { from: 'src/main.tsx', to: 'src/policy.ts', kind: 'static', specifier: './policy' },
    { from: 'src/policy.ts', to: 'src/editor.ts', kind: 'dynamic', specifier: './editor' },
    { from: 'src/policy.ts', to: 'src/gpu.ts', kind: 'type', specifier: './gpu' },
    { from: 'src/editor.ts', to: 'node_modules/konva/index.d.ts', kind: 'static', specifier: 'konva' },
  ]
  assert.equal(firstScreenReachability(edges).moduleCount, 2)
  assert.deepEqual(firstScreenReachability(edges).heavyModules, [])
  for (const pkg of FIRST_SCREEN_HEAVY_PACKAGES) {
    const current = firstScreenReachability([...edges, {
      from: 'src/policy.ts', to: `node_modules/${pkg}/index.d.ts`, kind: 'static', specifier: `${pkg}/lib`,
    }])
    assert.deepEqual(current.heavyModules, [{ target: pkg, route: ['src/main.tsx', 'src/policy.ts', pkg] }])
  }
  for (const prefix of FIRST_SCREEN_HEAVY_MODULE_PREFIXES) {
    const target = prefix.endsWith('/') ? `${prefix}renderer.ts` : prefix
    assert.equal(firstScreenReachability([...edges, {
      from: 'src/policy.ts', to: target, kind: 'static', specifier: '@/heavy',
    }]).heavyModules[0].target, target)
  }
})

test('首屏违规冻结后只能缩减，显式 accept-new 也不能重新放宽', async (t) => {
  const root = workspace(t)
  write(root, 'src/main.tsx', "export { value } from './entry'")
  const baseline = await scan(root)
  write(root, 'src/features/imageEdit/v3/editor/renderer.ts', 'export const renderer = 1')
  write(root, 'src/main.tsx', "export { renderer } from './features/imageEdit/v3/editor/renderer'")
  const current = await scan(root)
  assert.ok(compare(current, baseline).some((failure) => /首屏静态值依赖到重模块.*src\/main.tsx/.test(failure)))
  const filename = path.join(root, 'baseline.json')
  assert.throws(() => writeBaseline(filename, current, baseline, '仍然拒绝'), /只许缩减/)
  assert.deepEqual(compare(baseline, current), [])
  write(root, 'src/main.tsx', "import 'monaco-editor/not-installed-subpath'")
  assert.ok(compare(await scan(root), baseline).some((failure) => /首屏静态值依赖到重模块.*monaco-editor/.test(failure)))
  write(root, 'src/main.tsx', "export const lazy = () => import('monaco-editor/not-installed-subpath')")
  assert.deepEqual((await scan(root)).firstScreen.heavyModules, [])
})

test('把静态环换成动态加载不能藏环，两个动态边组成的回路也会失败', async (t) => {
  const root = workspace(t)
  write(root, 'src/alias.ts', "export { value as alias } from './entry'")
  const baseline = await scan(root)
  write(root, 'src/entry.ts', "export const value = 1; export const lazy = () => import('./alias')")
  const hidden = await scan(root)
  assert.equal(hidden.cycles.length, 0)
  assert.ok(compare(hidden, baseline).some((failure) => failure.includes('新增动态值回边')))
  write(root, 'src/alias.ts', "export const alias = () => import('./entry')")
  const double = await scan(root)
  assert.equal(double.dynamicBackEdges.length, 2)
  assert.ok(compare(double, hidden).some((failure) => failure.includes('新增动态值回边')))
  write(root, 'src/alias.ts', "export const alias = () => import('./entry'); export const twice = () => import('./entry')")
  assert.ok(compare(await scan(root), double).some((failure) => failure.includes('新增动态值回边')))
})
