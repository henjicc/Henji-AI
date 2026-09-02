const fs = require('node:fs')
const path = require('node:path')

const LEVELS = Object.freeze(['L0', 'L1', 'L2'])
const CODE_PATTERN = /\.(?:c|m)?[jt]sx?$/
const TEST_PATTERN = /\.(?:test|spec)\.(?:c|m)?[jt]sx?$/

function normalizeFile(root, file) {
  const absolute = path.resolve(root, file)
  const relative = path.relative(root, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`文件不在仓库内：${file}`)
  }
  return relative.split(path.sep).join('/')
}

function parseChangedVerificationArgs(argv, root) {
  const options = { dryRun: false, help: false, level: 'L1', files: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') continue
    if (token === '--help' || token === '-h') options.help = true
    else if (token === '--dry-run') options.dryRun = true
    else if (token === '--level') {
      const value = argv[index + 1]
      if (!value) throw new Error('--level 缺少参数值')
      options.level = value.toUpperCase()
      index += 1
    } else if (token.startsWith('--')) throw new Error(`未知参数：${token}`)
    else options.files.push(normalizeFile(root, token))
  }
  if (!LEVELS.includes(options.level)) throw new Error(`--level 仅支持 ${LEVELS.join('、')}`)
  options.files = [...new Set(options.files)]
  if (!options.help && options.files.length === 0) {
    throw new Error('必须显式传入本次改动文件；禁止默认扫描整个脏工作区')
  }
  return options
}

function isRuntimeFile(file) {
  return CODE_PATTERN.test(file)
    || file === 'package.json'
    || file === 'package-lock.json'
    || file.startsWith('.github/workflows/')
    || file.startsWith('tsconfig')
    || file.startsWith('electron.vite.config.')
    || file.startsWith('vite.config.')
}

function requiresL3(file) {
  return file === 'package.json'
    || file === 'package-lock.json'
    || file.startsWith('.github/workflows/')
    || file.startsWith('tsconfig')
    || file.startsWith('electron.vite.config.')
    || file.startsWith('vite.config.')
    || file.startsWith('vitest.config.')
}

function siblingTests(root, file, exists = fs.existsSync) {
  if (!CODE_PATTERN.test(file) || TEST_PATTERN.test(file)) return []
  const extension = path.posix.extname(file)
  const stem = file.slice(0, -extension.length)
  const candidates = extension === '.ts' || extension === '.tsx'
    ? [`${stem}.test.ts`, `${stem}.test.tsx`]
    : [`${stem}.test${extension}`]
  return candidates.filter((candidate) => exists(path.join(root, candidate)))
}

function step(label, command, args) {
  return { label, command, args }
}

function localNodeBin(root, name) {
  if (name === 'eslint') return path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js')
  if (name === 'tsc') return path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  throw new Error(`未知 Node CLI：${name}`)
}

function buildChangedVerificationPlan(options, root, exists = fs.existsSync) {
  const infrastructure = options.files.filter(requiresL3)
  if (infrastructure.length > 0) {
    throw new Error(`构建、测试或 CI 基础设施不支持降级为局部验证：${infrastructure.join('、')}`)
  }
  if (options.level === 'L0') {
    const runtime = options.files.filter(isRuntimeFile)
    if (runtime.length > 0) {
      throw new Error(`L0 不能包含运行时代码或构建配置：${runtime.join('、')}`)
    }
    return []
  }

  const plans = []
  const suppliedTests = options.files.filter((file) => TEST_PATTERN.test(file))
  const sources = options.files.filter((file) => CODE_PATTERN.test(file) && !TEST_PATTERN.test(file))
  const discoveredTests = sources.flatMap((file) => siblingTests(root, file, exists))
  const allTests = [...new Set([...suppliedTests, ...discoveredTests])]
  const nodeTests = allTests.filter((file) => file.endsWith('.test.cjs') || file.endsWith('.test.mjs'))
  const vitestTests = allTests.filter((file) => !nodeTests.includes(file))

  if (nodeTests.length > 0) {
    plans.push(step('精确 Node 测试', process.execPath, ['--test', ...nodeTests]))
  }
  if (vitestTests.length > 0) {
    plans.push(step('精确 Vitest', process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...vitestTests]))
  }

  const coveredSources = new Set(sources.filter((file) => siblingTests(root, file, exists).length > 0))
  const relatedSources = sources.filter((file) => (
    !coveredSources.has(file)
    && (file.startsWith('src/') || file.startsWith('electron/') || file.startsWith('packages/'))
    && /\.[jt]sx?$/.test(file)
  ))
  if (relatedSources.length > 0) {
    plans.push(step('受改动源文件影响的测试', process.execPath, [
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      'related', '--run', ...relatedSources, '--passWithNoTests',
    ]))
  }

  const rendererLint = options.files.filter((file) => file.startsWith('src/') && /\.[jt]sx?$/.test(file))
  const electronLint = options.files.filter((file) => file.startsWith('electron/') && /\.ts$/.test(file))
  const lintFiles = [...rendererLint, ...electronLint]
  if (lintFiles.length > 0) {
    plans.push(step('改动文件 ESLint', process.execPath, [localNodeBin(root, 'eslint'),
      ...lintFiles,
      '--cache', '--cache-location', 'node_modules/.eslintcache',
      '--report-unused-disable-directives', '--max-warnings', '0',
    ]))
  }

  if (options.level === 'L2') {
    if (options.files.some((file) => file.startsWith('src/'))) {
      plans.push(step('渲染层增量类型检查', process.execPath, [
        localNodeBin(root, 'tsc'), '-p', 'tsconfig.json', '--noEmit',
      ]))
    }
    if (options.files.some((file) => file.startsWith('electron/'))) {
      plans.push(step('Electron 增量类型检查', process.execPath, [
        localNodeBin(root, 'tsc'), '-p', 'tsconfig.electron.json', '--noEmit',
      ]))
    }
    if (options.files.some((file) => file.startsWith('packages/ai-sdk/'))) {
      const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      plans.push(step('SDK 增量构建与类型检查', npmCommand, ['run', 'build:sdk']))
    }
  }

  return plans
}

module.exports = {
  LEVELS,
  buildChangedVerificationPlan,
  parseChangedVerificationArgs,
}
