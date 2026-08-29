const assert = require('node:assert/strict')
const test = require('node:test')
const { buildRealityTestPlan, parseRealityTestArgs } = require('./realityTestPlan.cjs')

test('默认不暗中选择昂贵测试层', () => {
  const options = parseRealityTestArgs([])
  assert.deepEqual(options.suites, [])
  assert.equal(options.profile, 'temporary')
})

test('live 层要求真实资料、付费和写入三道显式开关', () => {
  assert.throws(() => parseRealityTestArgs(['--suite', 'live']), /profile real/)
  assert.throws(() => parseRealityTestArgs(['--suite', 'live', '--profile', 'real']), /allow-paid/)
  assert.throws(() => parseRealityTestArgs(['--suite', 'live', '--profile', 'real', '--allow-paid']), /allow-writes/)
  const options = parseRealityTestArgs([
    '--suite', 'live', '--profile', 'real', '--allow-paid', '--allow-writes', '--only', 'camera',
  ])
  assert.deepEqual(options.only, ['camera'])
})

test('UI 计划把资料模式与写入授权传给既有真实 Electron 执行器', () => {
  const options = parseRealityTestArgs([
    '--suite', 'ui', '--profile', 'real', '--allow-writes', '--only', '3D', '--size', '1440x900',
  ])
  const [step] = buildRealityTestPlan(options, '/workspace')
  assert.equal(step.label, '真实 Electron 界面巡检')
  assert.deepEqual(step.args.slice(1), [
    '--profile', 'real', '--allow-writes', '--only', '3D', '--size', '1440x900',
  ])
})

test('--build 只为需要 Electron 产物的层追加一次轻量构建', () => {
  const options = parseRealityTestArgs([
    '--build', '--suite', 'ui', '--suite', 'ui-audit', '--only', '设置',
  ])
  const plan = buildRealityTestPlan(options, '/workspace')
  assert.equal(plan[0].label, '生成最新 Electron 运行产物')
  assert.deepEqual(plan[0].args, ['run', 'electron:bundle'])
  assert.equal(plan.filter((step) => step.label === '生成最新 Electron 运行产物').length, 1)

  const unit = parseRealityTestArgs(['--build', '--suite', 'unit', '--test', 'src/example.test.ts'])
  assert.equal(buildRealityTestPlan(unit, '/workspace').some((step) => step.label.includes('Electron 运行产物')), false)
})

test('unit 层拒绝无目标的全量测试', () => {
  assert.throws(() => parseRealityTestArgs(['--suite', 'unit']), /必须用 --test/)
})
