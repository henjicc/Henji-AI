const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const {
  buildChangedVerificationPlan,
  parseChangedVerificationArgs,
} = require('./changedVerificationPlan.cjs')

test('局部验证必须显式传文件，禁止扫描整个脏工作区', () => {
  assert.throws(() => parseChangedVerificationArgs([], '/workspace'), /必须显式传入/)
})

test('L0 拒绝运行时代码但接受规则文件', () => {
  const docs = parseChangedVerificationArgs(['--level', 'L0', 'docs/rules/testing.md'], '/workspace')
  assert.deepEqual(buildChangedVerificationPlan(docs, '/workspace'), [])
  const source = parseChangedVerificationArgs(['--level', 'L0', 'src/example.ts'], '/workspace')
  assert.throws(() => buildChangedVerificationPlan(source, '/workspace'), /L0 不能包含/)
})

test('界面与令牌改动才追加四项严格门禁，同次计划只执行一次', () => {
  const names = ['check:surface:strict', 'check:colors', 'check:icons:strict', 'check:ui-residue']
  for (const file of ['src/example.tsx', 'src/example.css', 'src/components/ui/styleTokens.ts', 'src/core/theme/colorTokens.ts', 'src/core/theme/icons.ts', 'tailwind.config.js']) {
    const options = { level: 'L1', files: [file], directTests: [] }
    const plan = buildChangedVerificationPlan(options, '/workspace', () => false, ['src/example.test.ts'], () => '')
    for (const name of names) assert.equal(plan.filter(item => item.args.includes(name)).length, 1, name)
  }
  const combined = buildChangedVerificationPlan({ level: 'L1', files: ['src/example.tsx', 'src/example.css', 'src/other.tsx'] }, '/workspace', () => false, ['src/example.test.ts'], () => '')
  for (const name of names) assert.equal(combined.filter(item => item.args.includes(name)).length, 1)
  for (const file of ['src/logic.ts', 'electron/main/logic.ts', 'src/example.test.tsx']) {
    const plan = buildChangedVerificationPlan({ level: 'L2', files: [file] }, '/workspace', () => false, ['src/example.test.ts'], () => '')
    assert.ok(plan.every(item => !names.some(name => item.args.includes(name))), file)
  }
})

test('只改 skill 文档在 L0 与 L1 均执行同步门禁', () => {
  for (const level of ['L0', 'L1']) {
    const options = { level, files: ['.claude/skills/henji-ui-surface/SKILL.md', '.codex/skills/henji-ui-surface/references/review.md'] }
    const plan = buildChangedVerificationPlan(options, '/workspace', () => false, [], () => '')
    assert.deepEqual(plan.map(item => item.args), [['run', 'check:skill-sync']])
  }
})

test('构建与 CI 基础设施不能伪装成 L1/L2 局部验证', () => {
  const options = parseChangedVerificationArgs(['--level', 'L2', 'package.json'], '/workspace')
  assert.throws(() => buildChangedVerificationPlan(options, '/workspace'), /不支持降级为局部验证/)
})

test('L1 优先跑同名精确测试并只 lint 改动文件', () => {
  const options = parseChangedVerificationArgs(['src/example.ts'], '/workspace')
  const exists = (file) => file === path.join('/workspace', 'src/example.test.ts')
  const plan = buildChangedVerificationPlan(options, '/workspace', exists)
  assert.deepEqual(plan.map((item) => item.label), ['精确 Vitest（合并去重）', '改动文件 ESLint'])
  assert.equal(plan[0].args.includes('src/example.test.ts'), true)
  assert.equal(plan.some((item) => item.label.includes('相关')), false)
})

test('L2 只追加改动所属工程的增量类型检查', () => {
  const renderer = parseChangedVerificationArgs(['--level', 'L2', 'src/example.ts'], '/workspace')
  const rendererPlan = buildChangedVerificationPlan(renderer, '/workspace', () => false, ['src/example.test.ts'], () => '')
  assert.equal(rendererPlan.some((item) => item.label === '渲染层增量类型检查'), true)
  assert.equal(rendererPlan.some((item) => item.label === 'Electron 增量类型检查'), false)

  const electron = parseChangedVerificationArgs(['--level', 'L2', 'electron/main/example.ts'], '/workspace')
  const electronPlan = buildChangedVerificationPlan(electron, '/workspace', () => false, ['electron/main/example.test.ts'], () => '')
  assert.equal(electronPlan.some((item) => item.label === 'Electron 增量类型检查'), true)
  assert.equal(electronPlan.some((item) => item.label === '渲染层增量类型检查'), false)
})

// 一条回归覆盖计划的去重、原生路由、缺覆盖及共享边界门禁。
test('统一测试集合去重并按原生/共享core/导入/格式/IPC风险选门禁', async () => {
  const options = { level: 'L2', files: ['src/core/persistence/formats.ts', 'electron/preload/index.ts'], directTests: [] }
  const tests = ['src/core/persistence/persistence.test.ts', 'electron/main/services/db-migrations.native.test.ts', 'src/core/persistence/persistence.test.ts']
  const plan = buildChangedVerificationPlan(options, '/workspace', () => true, tests, () => "import { x } from './other'")
  assert.equal(plan.filter(step => step.args.includes(tests[0])).length, 1)
  assert.equal(plan.find(step => step.args.includes(tests[1])).args[0], 'scripts/test-assistant-persistence.cjs')
  for (const name of ['tsconfig.json', 'tsconfig.electron.json', 'check:dependency-graph', 'check:main-imports', 'check:ipc-contract', 'persistence:baseline']) assert.ok(plan.some(step => step.args.includes(name)), name)
  assert.throws(() => buildChangedVerificationPlan(options, '/workspace', () => false, [], () => ''), /缺覆盖/)
  assert.ok(plan.every(step => !step.args.includes('--passWithNoTests') && !step.args.includes('related')))
  for (const content of ["import 'reflect-metadata'", "const worker = require('./worker')"]) {
    const imported = buildChangedVerificationPlan({ level: 'L1', files: ['electron/main/new.ts'] }, '/workspace', () => false, ['electron/main/new.test.ts'], () => content)
    for (const name of ['check:dependency-graph', 'check:main-imports']) assert.ok(imported.some(step => step.args.includes(name)))
  }
  const { collectRelatedTests } = require('./resolveChangedTests.cjs')
  const root = path.resolve('/workspace')
  const source = path.join(root, 'src/source.ts')
  const ctx = {
    globTestFiles: async () => Array.from({ length: 21 }, (_, index) => [null, path.join(root, `src/${index}.test.ts`)]),
    getTestDependencies: async () => new Set([source]),
  }
  await assert.rejects(collectRelatedTests(ctx, ['src/source.ts'], root), /集合过大/)
  ctx.globTestFiles = async () => [[null, path.join(root, 'src/one.test.ts')]]
  assert.deepEqual(await collectRelatedTests(ctx, ['src/source.ts'], root), ['src/one.test.ts'])
  await assert.rejects(collectRelatedTests(ctx, ['src/source.ts', 'src/uncovered.ts'], root), /缺覆盖.*uncovered/)
  await assert.rejects(collectRelatedTests(ctx, ['src/uncovered.ts'], root), /缺覆盖/)
})
