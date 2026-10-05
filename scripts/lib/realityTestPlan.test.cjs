const assert = require('node:assert/strict')
const test = require('node:test')
const { buildRealityTestPlan, parseRealityTestArgs, parseRestartCheckArgs, resolveRestartTarget } = require('./realityTestPlan.cjs')

test('默认不暗中选择昂贵测试层', () => {
  const options = parseRealityTestArgs([])
  assert.deepEqual(options.suites, [])
  assert.equal(options.profile, 'temporary')
})

test('拒绝已经移除的旧运行时验收入口', () => {
  assert.throws(() => parseRealityTestArgs(['--suite', 'live']), /未知测试层/)
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

test('界面巡检与审计都透传主题预设，交给执行器统一校验与分目录', () => {
  const options = parseRealityTestArgs([
    '--suite', 'ui', '--suite', 'ui-audit', '--theme-preset', 'paper', '--theme-preset', 'all', '--only', '设置',
  ])
  for (const step of buildRealityTestPlan(options, '/workspace')) {
    assert.deepEqual(step.args.slice(-4), ['--theme-preset', 'paper', '--theme-preset', 'all'])
  }
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

test('默认退出重启与真实客户端两层都要真实 Electron 产物，且不暗中开启付费', () => {
  const options = parseRealityTestArgs(['--build', '--suite', 'restart', '--suite', 'clients'])
  const plan = buildRealityTestPlan(options, '/workspace')
  assert.equal(plan[0].label, '生成最新 Electron 运行产物')
  assert.equal(plan.filter((step) => step.label === '生成最新 Electron 运行产物').length, 1)
  assert.ok(plan[1].args.some((value) => String(value).includes('mcp-restart-check.cjs')))
  assert.ok(plan[2].args.some((value) => String(value).includes('mcp-external-client-check.cjs')))
  assert.equal(plan[1].args.includes('--only'), false, '没有 only 时保持既有 MCP 重启语义')
  assert.equal(options.allowPaid, false)
  assert.equal(options.profile, 'temporary')
})

test('客户端 only 仍精确转发客户端名称', () => {
  const options = parseRealityTestArgs(['--suite', 'clients', '--only', 'claude'])
  const [step] = buildRealityTestPlan(options, '/workspace')
  assert.deepEqual(step.args.slice(-2), ['--client', 'claude'])
})

test('剪辑冷重启目标只路由到既有两次启动执行器', () => {
  const options = parseRealityTestArgs(['--suite', 'restart', '--only', 'video-edit-layout', '--out', 'layout-evidence'])
  const [step] = buildRealityTestPlan(options, '/workspace')
  assert.equal(step.label, '剪辑布局完整退出重启恢复验收')
  assert.match(step.args[0], /mcp-restart-check\.cjs$/)
  assert.deepEqual(step.args.slice(1), ['--only', 'video-edit-layout', '--out', 'layout-evidence'])
  assert.equal(options.allowPaid, false)
  assert.equal(options.profile, 'temporary')
})

test('镜头参考文档目标（3.2）复用同一两次启动执行器', () => {
  const options = parseRealityTestArgs(['--suite', 'restart', '--only', 'camera-stage-documents', '--out', 'stage-evidence'])
  const [step] = buildRealityTestPlan(options, '/workspace')
  assert.match(step.label, /镜头参考文档/)
  assert.match(step.args[0], /mcp-restart-check\.cjs$/)
  assert.deepEqual(step.args.slice(1), ['--only', 'camera-stage-documents', '--out', 'stage-evidence'])
})

test('restart 不允许忽略未知目标或同时跑不同目标', () => {
  assert.equal(resolveRestartTarget(), 'mcp')
  assert.equal(resolveRestartTarget(['video-edit-layout', 'video-edit-layout']), 'video-edit-layout')
  assert.throws(() => resolveRestartTarget(['mcp,video-edit-layout']), /每次只能选择一个/)
  assert.throws(() => buildRealityTestPlan(parseRealityTestArgs(['--suite', 'restart', '--only', 'claude']), '/workspace'), /未知退出重启验收目标/)
})

test('直接 restart CLI 与 Reality 计划使用相同目标规则，拒绝缺值', () => {
  assert.deepEqual(parseRestartCheckArgs([]), { outDir: '.mcp-restart', target: 'mcp' })
  assert.deepEqual(parseRestartCheckArgs(['--only=video-edit-layout', '--out=layout-evidence']), { outDir: 'layout-evidence', target: 'video-edit-layout' })
  assert.deepEqual(parseRestartCheckArgs(['--only', 'mcp', '--out', 'mcp-evidence']), { outDir: 'mcp-evidence', target: 'mcp' })
  for (const argv of [['--only'], ['--only='], ['--out'], ['--out=']]) {
    assert.throws(() => parseRestartCheckArgs(argv), /缺少参数值/)
  }
  assert.throws(() => parseRestartCheckArgs(['--only', 'unknown']), /未知退出重启验收目标/)
})
