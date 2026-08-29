const assert = require('node:assert/strict')
const test = require('node:test')
const {
  buildAssistantProductionTestPlan,
  extractVitestTargets,
} = require('./assistantProductionTestPlan.cjs')

test('生产助手测试把重复 Vitest 文件合并为一次执行', () => {
  const packageJson = {
    scripts: {
      'test:assistant-model-compat': 'vitest run a.test.ts shared.test.ts',
      'test:assistant-eval': 'vitest run shared.test.ts b.test.ts',
      'test:assistant-settlement': 'vitest run c.test.ts',
    },
  }
  const plan = buildAssistantProductionTestPlan(packageJson, '/workspace')
  assert.deepEqual(plan[0].args.slice(2), ['a.test.ts', 'shared.test.ts', 'b.test.ts', 'c.test.ts'])
  assert.equal(plan[0].label, '助手生产 Vitest（去重后 4 文件）')
})

test('聚合器拒绝悄悄混入非测试参数', () => {
  assert.throws(
    () => extractVitestTargets('example', 'vitest run --coverage a.test.ts'),
    /非测试文件参数/,
  )
})
