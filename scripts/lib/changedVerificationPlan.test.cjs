const assert = require('node:assert/strict')
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

test('构建与 CI 基础设施不能伪装成 L1/L2 局部验证', () => {
  const options = parseChangedVerificationArgs(['--level', 'L2', 'package.json'], '/workspace')
  assert.throws(() => buildChangedVerificationPlan(options, '/workspace'), /不支持降级为局部验证/)
})

test('L1 优先跑同名精确测试并只 lint 改动文件', () => {
  const options = parseChangedVerificationArgs(['src/example.ts'], '/workspace')
  const exists = (file) => file === '/workspace/src/example.test.ts'
  const plan = buildChangedVerificationPlan(options, '/workspace', exists)
  assert.deepEqual(plan.map((item) => item.label), ['精确 Vitest', '改动文件 ESLint'])
  assert.equal(plan[0].args.includes('src/example.test.ts'), true)
  assert.equal(plan.some((item) => item.label.includes('相关')), false)
})

test('L2 只追加改动所属工程的增量类型检查', () => {
  const renderer = parseChangedVerificationArgs(['--level', 'L2', 'src/example.ts'], '/workspace')
  const rendererPlan = buildChangedVerificationPlan(renderer, '/workspace', () => false)
  assert.equal(rendererPlan.some((item) => item.label === '渲染层增量类型检查'), true)
  assert.equal(rendererPlan.some((item) => item.label === 'Electron 增量类型检查'), false)

  const electron = parseChangedVerificationArgs(['--level', 'L2', 'electron/main/example.ts'], '/workspace')
  const electronPlan = buildChangedVerificationPlan(electron, '/workspace', () => false)
  assert.equal(electronPlan.some((item) => item.label === 'Electron 增量类型检查'), true)
  assert.equal(electronPlan.some((item) => item.label === '渲染层增量类型检查'), false)
})
