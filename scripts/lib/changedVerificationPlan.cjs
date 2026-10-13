const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { testSuiteForFile } = require('./testSuites.cjs')
const { createImportResolver, readResolvedImports } = require('./resolvedImports.cjs')

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
  const options = { dryRun: false, help: false, level: 'L1', files: [], directTests: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') continue
    if (token === '--help' || token === '-h') options.help = true
    else if (token === '--dry-run') options.dryRun = true
    else if (token === '--test') {
      const file = argv[++index]
      if (!file || !TEST_PATTERN.test(file)) throw new Error('--test 需要直接消费者测试文件')
      options.directTests.push(normalizeFile(root, file))
    }
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
    ? [`${stem}.test.ts`, `${stem}.test.tsx`, `${stem}.native.test.ts`, `${stem}.storage.test.ts`]
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

function changedContent(root, file) {
  try {
    const diff = execFileSync('git', ['diff', 'HEAD', '--', file], { cwd: root, encoding: 'utf8', windowsHide: true })
    if (diff) {
      const ts = require('typescript')
      const imports = (text) => {
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
        const values = []
        const visit = (node) => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
            || ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) values.push(node.getText(source).replace(/\s+/g, ' '))
          ts.forEachChild(node, visit)
        }
        visit(source)
        return JSON.stringify(values.sort())
      }
      let before = ''
      try { before = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }) } catch { /* 新文件没有 HEAD。 */ }
      const after = fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : ''
      const lines = diff.split(/\r?\n/).filter((line) => /^[+-](?![+-])/.test(line)).map((line) => line.slice(1)).join('\n')
      return imports(before) === imports(after) ? lines : `import './changed-import'\n${lines}`
    }
    execFileSync('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root, stdio: 'ignore', windowsHide: true })
    return ''
  } catch { return fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : '' }
}

function persistenceSources(root) {
  const resolver = createImportResolver(root), seen = new Set(), pending = ['src/core/persistence/formats.ts']
  while (pending.length) {
    const file = pending.pop()
    if (seen.has(file) || !fs.existsSync(path.join(root, file))) continue
    seen.add(file)
    for (const edge of readResolvedImports(path.join(root, file), root, resolver)) {
      if (edge.to.startsWith('src/core/') && !seen.has(edge.to)) pending.push(edge.to)
    }
  }
  return seen
}

function validateChangedVerificationOptions(options) {
  const infrastructure = options.files.filter(requiresL3)
  if (infrastructure.length > 0) {
    throw new Error(`构建、测试或 CI 基础设施不支持降级为局部验证：${infrastructure.join('、')}`)
  }
  if (options.level === 'L0') {
    const runtime = options.files.filter(isRuntimeFile)
    if (runtime.length > 0) {
      throw new Error(`L0 不能包含运行时代码或构建配置：${runtime.join('、')}`)
    }
  }
}

function buildChangedVerificationPlan(options, root, exists = fs.existsSync, resolvedTests, readChanges = changedContent) {
  validateChangedVerificationOptions(options)
  const plans = []
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const gate = (label, name, args = []) => plans.push(step(label, npmCommand, ['run', name, ...args]))
  if (options.files.some(file => /^\.(?:claude|codex)\/skills\//.test(file))) gate('项目 skill 同步', 'check:skill-sync')
  if (options.level === 'L0') return plans
  const suppliedTests = options.files.filter((file) => TEST_PATTERN.test(file))
  const sources = options.files.filter((file) => CODE_PATTERN.test(file) && !TEST_PATTERN.test(file))
  const discoveredTests = sources.flatMap((file) => siblingTests(root, file, exists))
  const changes = new Map(sources.map(file => [file, readChanges(root, file)]))
  let registeredFormats
  const registered = () => registeredFormats ??= persistenceSources(root)
  const formats = sources.some(file => /^src\/core\/persistence\/|^src\/core\/.*(?:persistence|serializer|codec)|^electron\/main\/services\/db-migrations/.test(file))
    || sources.some(file => changes.get(file) && file.startsWith('src/core/') && registered().has(file)
      && /\bz\.|Schema\b|\bVERSION\b/.test(fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : changes.get(file)))
  const golden = 'src/core/persistence/persistence.test.ts'
  const allTests = [...new Set(resolvedTests ?? [...suppliedTests, ...discoveredTests, ...(options.directTests ?? [])])]
  if (formats && exists(path.join(root, golden)) && !allTests.includes(golden)) allTests.push(golden)
  if ((sources.length || suppliedTests.length) && !allTests.length) throw new Error('缺覆盖：没有匹配测试；请补测试或 --test 指定直接消费者')
  const nodeTests = allTests.filter((file) => /\.(?:test|spec)\.[cm]js$/.test(file))
  const nativeTests = allTests.filter((file) => testSuiteForFile(file) === 'native')
  const vitestTests = allTests.filter((file) => !nodeTests.includes(file) && !nativeTests.includes(file))

  if (nodeTests.length > 0) {
    plans.push(step('精确 Node 测试', process.execPath, ['--test', ...nodeTests]))
  }
  if (vitestTests.length > 0) {
    plans.push(step('精确 Vitest（合并去重）', process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...vitestTests, '--silent']))
  }
  if (nativeTests.length) {
    plans.push(step('精确原生 SQLite（验收文件/断言/跳过）', process.execPath,
      ['scripts/test-assistant-persistence.cjs', ...nativeTests]))
  }

  const rendererLint = options.files.filter((file) => file.startsWith('src/') && /\.[jt]sx?$/.test(file))
  const electronLint = options.files.filter((file) => file.startsWith('electron/') && /\.ts$/.test(file))
  const lintFiles = [...rendererLint, ...electronLint]
  if (lintFiles.length > 0) {
    plans.push(step('改动文件 ESLint', process.execPath, [localNodeBin(root, 'eslint'),
      ...lintFiles,
      '--cache', '--cache-location', '.tmp/eslint-changed',
      '--report-unused-disable-directives', '--max-warnings', '0',
    ]))
  }

  if (options.level === 'L2' || sources.some((file) => file.startsWith('src/core/'))) {
    if (options.files.some((file) => file.startsWith('src/'))) {
      plans.push(step('渲染层增量类型检查', process.execPath, [
        localNodeBin(root, 'tsc'), '-p', 'tsconfig.json', '--noEmit', '--tsBuildInfoFile', '.tmp/tsc-renderer.tsbuildinfo',
      ]))
    }
    if (options.files.some((file) => file.startsWith('electron/') || file.startsWith('src/core/'))) {
      plans.push(step('Electron 增量类型检查', process.execPath, [
        localNodeBin(root, 'tsc'), '-p', 'tsconfig.electron.json', '--noEmit', '--tsBuildInfoFile', '.tmp/tsc-electron.tsbuildinfo',
      ]))
    }
    if (options.files.some((file) => file.startsWith('packages/ai-sdk/'))) {
      const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      plans.push(step('SDK 增量构建与类型检查', npmCommand, ['run', 'build:sdk']))
    }
  }

  // 颜色/图标与共享表面执行全仓严格模式；residue 可以按本次 src 文件严格扫描，
  // 不给纯逻辑及测试替身增加扫描成本。4.3 定稿后的间距门禁在这里接入。
  const uiChanged = options.files.some(file => !TEST_PATTERN.test(file) && (
    /^src\/.*\.(?:tsx|css)$/.test(file)
    || /^src\/components\/ui\/styleTokens\.ts$/.test(file)
    || /^src\/core\/theme\/(?:colorTokens|icons|themeEngine|themeCssVars|runtimeTheme)\.ts$/.test(file)
    || file === 'tailwind.config.js'
  ))
  if (uiChanged) {
    gate('界面表面（严格）', 'check:surface:strict')
    gate('界面颜色令牌', 'check:colors')
    gate('界面图标（严格）', 'check:icons:strict')
    const uiFiles = options.files.filter(file => file.startsWith('src/') && !TEST_PATTERN.test(file) && /\.(?:tsx?|css)$/.test(file) && exists(path.join(root, file)))
    const globalUi = options.files.includes('tailwind.config.js')
    gate('界面残留（严格）', 'check:ui-residue', !globalUi && uiFiles.length ? ['--', '--strict-local', '--files', uiFiles.join(','), '--no-report'] : [])
    gate('间距与动效令牌（严格）', 'check:ui-design', !globalUi && uiFiles.length ? ['--', '--files', ...uiFiles] : [])
  }
  const applicationSources = sources.filter(file => /^(src|electron|packages)\//.test(file))
  const importsChanged = applicationSources.some((file) => /\b(?:import|export)\b[^\n]*(?:from\s|import\s*\(|['"]\.)|\b(?:import\s*['"]|require\s*\()/.test(changes.get(file)))
  const assemblyChanged = applicationSources.some(file => changes.get(file) && /(?:registry|registration|bootstrap|composition|applicationModelProfile)\.[jt]sx?$/.test(file))
  if (importsChanged || assemblyChanged) { gate('导入/装配依赖图', 'check:dependency-graph'); gate('主进程传递导入', 'check:main-imports') }
  if (sources.some((file) => /^electron\/(?:main\/ipc\/|preload\/)|^src\/platform\/|^src\/core\/ipc\//.test(file) || /\b(?:ipcMain|ipcRenderer|registerIpcHandler|nativeInvoke|subscribeChannel|contextBridge|IPC_CHANNELS)\b/.test(changes.get(file)))) gate('IPC 通道对账', 'check:ipc-contract')
  if (formats) gate('登记格式与黄金样本基线', 'persistence:baseline')

  return plans
}

module.exports = {
  LEVELS,
  CODE_PATTERN, TEST_PATTERN, siblingTests,
  buildChangedVerificationPlan,
  parseChangedVerificationArgs,
  validateChangedVerificationOptions,
}
