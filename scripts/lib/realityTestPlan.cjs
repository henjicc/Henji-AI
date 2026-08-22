const path = require('node:path')

const SUITES = Object.freeze(['unit', 'integration', 'ui', 'ui-audit', 'live'])

function readValue(argv, index, option) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} 缺少参数值`)
  return value
}

function parseRealityTestArgs(argv) {
  const options = {
    allowPaid: false,
    allowWrites: false,
    help: false,
    only: [],
    outDir: null,
    profile: 'temporary',
    probe: false,
    sizes: [],
    skipGeneration: false,
    suites: [],
    tests: [],
    visible: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help' || token === '-h') options.help = true
    else if (token === '--allow-paid') options.allowPaid = true
    else if (token === '--allow-writes') options.allowWrites = true
    else if (token === '--probe') options.probe = true
    else if (token === '--skip-generation') options.skipGeneration = true
    else if (token === '--visible') options.visible = true
    else if (token === '--real-data') options.profile = 'real'
    else if (token === '--suite') { options.suites.push(readValue(argv, index, token)); index += 1 }
    else if (token === '--test') { options.tests.push(readValue(argv, index, token)); index += 1 }
    else if (token === '--only') { options.only.push(readValue(argv, index, token)); index += 1 }
    else if (token === '--size') { options.sizes.push(readValue(argv, index, token)); index += 1 }
    else if (token === '--out') { options.outDir = readValue(argv, index, token); index += 1 }
    else if (token === '--profile') { options.profile = readValue(argv, index, token); index += 1 }
    else throw new Error(`未知参数：${token}`)
  }
  options.suites = [...new Set(options.suites.flatMap((value) => value.split(',')).filter(Boolean))]
  options.only = options.only.flatMap((value) => value.split(',')).filter(Boolean)
  if (options.profile !== 'temporary' && options.profile !== 'real') {
    throw new Error('--profile 仅支持 temporary 或 real')
  }
  const unknown = options.suites.filter((suite) => !SUITES.includes(suite))
  if (unknown.length > 0) throw new Error(`未知测试层：${unknown.join('、')}`)
  if (options.suites.includes('unit') && options.tests.length === 0) {
    throw new Error('unit 层必须用 --test 指定一个或多个精确测试文件')
  }
  if (options.suites.includes('live')) {
    if (options.profile !== 'real') throw new Error('live 层必须显式传入 --profile real')
    if (!options.allowPaid) throw new Error('live 层会产生真实 API 请求，必须显式传入 --allow-paid')
    if (!options.allowWrites) throw new Error('live 层会写入真实业务数据，必须显式传入 --allow-writes')
  }
  return options
}

function uiArgs(options) {
  const args = ['--profile', options.profile]
  if (options.allowWrites) args.push('--allow-writes')
  for (const value of options.only) args.push('--only', value)
  for (const value of options.sizes) args.push('--size', value)
  if (options.outDir) args.push('--out', options.outDir)
  return args
}

function buildRealityTestPlan(options, root) {
  const plans = []
  for (const suite of options.suites) {
    if (suite === 'unit') {
      plans.push({ label: '精确单元测试', command: process.execPath, args: [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...options.tests] })
    } else if (suite === 'integration') {
      plans.push({ label: '真实助手运行时集成测试', command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'test:assistant-harness'] })
    } else if (suite === 'ui' || suite === 'ui-audit') {
      plans.push({
        label: suite === 'ui' ? '真实 Electron 界面巡检' : '真实 Electron DOM 规则审计',
        command: process.execPath,
        args: [path.join(root, 'scripts', suite === 'ui' ? 'ui-tour.cjs' : 'ui-visual-audit.cjs'), ...uiArgs(options)],
      })
    } else if (suite === 'live') {
      const args = [path.join(root, 'scripts/run-assistant-live-suite.cjs')]
      for (const value of options.only) args.push('--only', value)
      if (options.probe) args.push('--probe')
      if (options.skipGeneration) args.push('--skip-generation')
      if (options.visible) args.push('--visible')
      plans.push({ label: '真实模型与 API 验收', command: process.execPath, args })
    }
  }
  return plans
}

module.exports = { SUITES, buildRealityTestPlan, parseRealityTestArgs }
