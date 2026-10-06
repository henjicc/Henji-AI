const path = require('node:path')

/*
 * `restart` 与 `clients` 是 3.2 补的两层真实性证据，都要真实 Electron 运行产物：
 * - restart：同一份隔离资料目录跑两次完整启动，覆盖渲染层重载证明不了的启动恢复；
 * - clients：把真实外部 Agent 命令行接到真实应用上，协议测试客户端不能冒充这一层。
 * 两者都不产生付费请求，也不碰用户真实资料目录。
 */
const SUITES = Object.freeze(['unit', 'integration', 'ui', 'ui-audit', 'restart', 'clients'])
const RESTART_TARGETS = Object.freeze(['mcp', 'video-edit-layout', 'camera-stage-documents', 'image-documents', 'video-edit-documents', 'audio-edit-documents', 'canvas-documents', 'free-composition'])

function readValue(argv, index, option) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} 缺少参数值`)
  return value
}

/** A restart filter selects one complete two-launch scenario, never an ignored UI filter. */
function resolveRestartTarget(only = []) {
  const targets = [...new Set(only.flatMap(value => value.split(',')).filter(Boolean))]
  if (targets.length === 0) return 'mcp'
  const unknown = targets.filter(target => !RESTART_TARGETS.includes(target))
  if (unknown.length) throw new Error(`未知退出重启验收目标：${unknown.join('、')}`)
  if (targets.length !== 1) throw new Error('退出重启验收每次只能选择一个 --only 目标')
  return targets[0]
}

function parseRestartCheckArgs(argv) {
  const options = { outDir: '.mcp-restart', only: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--out') { options.outDir = readValue(argv, index, token); index += 1 }
    else if (token.startsWith('--out=')) options.outDir = token.slice('--out='.length)
    else if (token === '--only') { options.only.push(readValue(argv, index, token)); index += 1 }
    else if (token.startsWith('--only=')) options.only.push(token.slice('--only='.length))
    else throw new Error(`未知参数：${token}`)
  }
  if (!options.outDir) throw new Error('--out 缺少参数值')
  if (options.only.some(value => !value)) throw new Error('--only 缺少参数值')
  return { outDir: options.outDir, target: resolveRestartTarget(options.only) }
}

function parseRealityTestArgs(argv) {
  const options = {
    allowPaid: false,
    allowWrites: false,
    build: false,
    help: false,
    only: [],
    outDir: null,
    profile: 'temporary',
    probe: false,
    sizes: [],
    skipGeneration: false,
    suites: [],
    tests: [],
    themePresets: [],
    visible: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help' || token === '-h') options.help = true
    else if (token === '--allow-paid') options.allowPaid = true
    else if (token === '--allow-writes') options.allowWrites = true
    else if (token === '--build') options.build = true
    else if (token === '--probe') options.probe = true
    else if (token === '--skip-generation') options.skipGeneration = true
    else if (token === '--visible') options.visible = true
    else if (token === '--real-data') options.profile = 'real'
    else if (token === '--suite') { options.suites.push(readValue(argv, index, token)); index += 1 }
    else if (token === '--test') { options.tests.push(readValue(argv, index, token)); index += 1 }
    else if (token === '--only') { options.only.push(readValue(argv, index, token)); index += 1 }
    else if (token === '--size') { options.sizes.push(readValue(argv, index, token)); index += 1 }
    else if (token === '--out') { options.outDir = readValue(argv, index, token); index += 1 }
    else if (token === '--theme-preset') { options.themePresets.push(readValue(argv, index, token)); index += 1 }
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
  return options
}

function uiArgs(options) {
  const args = ['--profile', options.profile]
  if (options.allowWrites) args.push('--allow-writes')
  for (const value of options.only) args.push('--only', value)
  for (const value of options.sizes) args.push('--size', value)
  if (options.outDir) args.push('--out', options.outDir)
  // 预设名由 ui:tour / check:ui-visual 统一校验（含 all），这里只透传。
  for (const value of options.themePresets) args.push('--theme-preset', value)
  return args
}

function buildRealityTestPlan(options, root) {
  const plans = []
  const needsElectronArtifact = options.suites.some((suite) => ['ui', 'ui-audit', 'restart', 'clients'].includes(suite))
  if (options.build && needsElectronArtifact) {
    plans.push({
      label: '生成最新 Electron 运行产物',
      command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args: ['run', 'electron:bundle'],
    })
  }
  for (const suite of options.suites) {
    if (suite === 'unit') {
      plans.push({ label: '精确单元测试', command: process.execPath, args: [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...options.tests] })
    } else if (suite === 'integration') {
      plans.push({ label: '公共应用能力集成测试', command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'test:application-harness'] })
    } else if (suite === 'ui' || suite === 'ui-audit') {
      plans.push({
        label: suite === 'ui' ? '真实 Electron 界面巡检' : '真实 Electron DOM 规则审计',
        command: process.execPath,
        args: [path.join(root, 'scripts', suite === 'ui' ? 'ui-tour.cjs' : 'ui-visual-audit.cjs'), ...uiArgs(options)],
      })
    } else if (suite === 'restart') {
      const target = resolveRestartTarget(options.only)
      const args = [path.join(root, 'scripts/mcp-restart-check.cjs')]
      if (options.only.length) args.push('--only', target)
      if (options.outDir) args.push('--out', options.outDir)
      const labels = {
        'video-edit-layout': '剪辑布局完整退出重启恢复验收',
        'camera-stage-documents': '镜头参考文档（草稿、离开提示、重启、右键操作）真实验收',
        'video-edit-documents': '剪辑项目（草稿项目、离开提示、重启、收集素材、拷贝项目文件夹）真实验收',
        'image-documents': '图片文档（.henjiimg 草稿、保存、关闭写回、重新打开、意外退出后恢复）真实验收',
        'audio-edit-documents': '口播文档（导入即建草稿、离开提示、保存起名、重启后重新打开）真实验收',
        'canvas-documents': '画布文档（草稿三分支、生成落点、重启恢复视口与撤销、多图层随移动 / 副本 / 拷贝文件夹）真实验收',
        'free-composition': '自由组合（剪辑里新建 / 打开各类文档的嵌入模式、片段回到来源、图片文档链接自动重渲染、跨位置收集、单文件包导出导入）真实验收',
      }
      plans.push({ label: labels[target] ?? '应用完整退出重启后的外部连接事实核对', command: process.execPath, args })
    } else if (suite === 'clients') {
      const args = [path.join(root, 'scripts/mcp-external-client-check.cjs')]
      for (const value of options.only) args.push('--client', value)
      if (options.outDir) args.push('--out', options.outDir)
      plans.push({ label: '真实外部 Agent 客户端接入验收', command: process.execPath, args })

    }
  }
  return plans
}

module.exports = { SUITES, buildRealityTestPlan, parseRealityTestArgs, parseRestartCheckArgs, resolveRestartTarget }
