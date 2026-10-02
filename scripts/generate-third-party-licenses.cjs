#!/usr/bin/env node
/**
 * 生成第三方开源组件许可清单（设置 → 关于 与安装包共用同一份产物）。
 *
 * 产物（不入 Git，构建时生成）：
 *   resources/licenses/third-party-licenses.json  结构化清单，渲染层“关于”页面读取
 *   resources/licenses/THIRD-PARTY-NOTICES.txt     同一份数据渲染的纯文本，随安装包分发（3.3 接入 extraResources）
 *
 * 选型（详见任务 3.4 执行记录）：npm 侧用 npm 自带的 `npm ls`（Arborist 依赖树），Rust 侧用 cargo 自带的
 * `cargo metadata`，不引入额外依赖；许可全文取组件自带文件。
 *
 * 用法：
 *   node scripts/generate-third-party-licenses.cjs [--strict] [--force] [--platform win32] [--arch x64]
 *     --strict  任一来源（npm、cargo、Windows 上的 FFmpeg 包）缺失即失败；构建链使用
 *     --force   忽略输入指纹，强制重新生成
 * 输入指纹（lockfile、FFmpeg 指针、项目许可、本脚本）未变化且产物存在时直接跳过。
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  NATIVE_CRATES,
  RUST_TARGETS,
  buildNotices,
  collectCargoPackages,
  collectNpmPackages,
  createTextTable,
  normalizeText,
  parseFfmpegExternalLibraries,
  readLicenseFiles,
  renderNoticesText,
  sqliteBlessingFromHeader,
  sqliteVersionFromHeader,
} = require('./lib/thirdPartyLicenses.cjs')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'resources', 'licenses')
const JSON_FILE = path.join(outputDir, 'third-party-licenses.json')
const TEXT_FILE = path.join(outputDir, 'THIRD-PARTY-NOTICES.txt')
const STAMP_FILE = path.join(outputDir, '.inputs.sha256')
const REFERENCE_DIR = path.join(__dirname, 'third-party-licenses')
const PRODUCT_NAME = '痕迹AI'

function log(message) {
  console.log(`[licenses] ${message}`)
}

function parseArgs(argv) {
  const options = { strict: false, force: false, platform: process.platform, arch: process.arch }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--strict') options.strict = true
    else if (arg === '--force') options.force = true
    else if (arg === '--platform') options.platform = argv[++index]
    else if (arg === '--arch') options.arch = argv[++index]
    else throw new Error(`未知参数：${arg}`)
  }
  return options
}

function readTextIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function inputFingerprint(options) {
  const hash = crypto.createHash('sha256')
  hash.update(`${options.platform}-${options.arch}\n`)
  const files = [
    'package.json', 'package-lock.json', 'LICENSE',
    'native/video-decoder/ffmpeg/current.json',
    'scripts/generate-third-party-licenses.cjs', 'scripts/lib/thirdPartyLicenses.cjs',
    ...NATIVE_CRATES.map((crate) => `${crate.dir}/Cargo.lock`),
  ]
  for (const file of files) hash.update(`${file}\n${readTextIfExists(path.join(root, file)) ?? ''}\n`)
  for (const name of fs.existsSync(REFERENCE_DIR) ? fs.readdirSync(REFERENCE_DIR).sort() : []) {
    hash.update(`${name}\n${readTextIfExists(path.join(REFERENCE_DIR, name)) ?? ''}\n`)
  }
  return hash.digest('hex')
}

function npmCommand(args) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath && /\.c?js$/.test(npmExecPath)) {
    return spawnSync(process.execPath, [npmExecPath, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true })
  }
  // Windows 上 npm 是 .cmd，只能经 shell 启动；参数都是本脚本内的常量，整体作为一条命令传入。
  return spawnSync(['npm', ...args].join(' '), {
    cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, shell: true,
  })
}

function loadNpmTree() {
  const result = npmCommand(['ls', '--omit=dev', '--all', '--json', '--long'])
  // npm ls 遇到 peer 依赖告警等也会以非零退出，只要输出了完整 JSON 树就可用。
  try {
    const tree = JSON.parse(result.stdout)
    if (tree && typeof tree === 'object' && tree.dependencies) return tree
  } catch {
    // 落到下面统一报错
  }
  throw new Error(`npm ls 未输出依赖树（退出码 ${result.status}）：${(result.stderr || result.error?.message || '').trim().slice(0, 400)}`)
}

function loadCargoMetadata(crateDir, triple) {
  const manifest = path.join(root, crateDir, 'Cargo.toml')
  const base = ['metadata', '--format-version', '1', '--locked', '--manifest-path', manifest]
  if (triple) base.push('--filter-platform', triple)
  // 先离线：构建链里 cargo build 已下载过源码；离线失败（全新环境）再允许联网补齐。
  for (const extra of [['--offline'], []]) {
    const result = spawnSync('cargo', [...base, ...extra], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true })
    if (result.status === 0) return JSON.parse(result.stdout)
    if (result.error) throw new Error(`无法运行 cargo：${result.error.message}`)
    if (extra.length === 0) throw new Error(`cargo metadata 失败（${crateDir}）：${(result.stderr || '').trim().slice(0, 400)}`)
  }
  return null
}

function electronRuntime(textTable) {
  const electronDir = path.join(root, 'node_modules', 'electron')
  const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'))
  let versions = {}
  try {
    // electron 包的入口返回当前平台可执行文件路径；以 Node 模式运行取 Chromium / Node 版本。
    const executable = require(electronDir)
    const result = spawnSync(executable, ['-p', 'JSON.stringify(process.versions)'], {
      encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 30_000,
    })
    if (result.status === 0) versions = JSON.parse(result.stdout)
  } catch {
    versions = {}
  }
  const electronTexts = readLicenseFiles(path.join(electronDir, 'dist'))
    .filter((text) => !/^<!DOCTYPE|^<html/i.test(text))
  const chromiumCredits = 'LICENSES.chromium.html'
  return [
    {
      id: 'runtime:electron', name: 'Electron', version: pkg.version, license: 'MIT', ecosystem: 'runtime',
      homepage: 'https://www.electronjs.org',
      textIds: electronTexts.map((text) => textTable.add(text)).filter(Boolean), textOrigin: 'package',
    },
    {
      id: 'runtime:chromium', name: 'Chromium', version: versions.chrome ?? null, license: 'BSD-3-Clause', ecosystem: 'runtime',
      homepage: 'https://www.chromium.org', licenseFileHint: chromiumCredits, textIds: [], textOrigin: 'none',
    },
    {
      id: 'runtime:node', name: 'Node.js', version: versions.node ?? null, license: 'MIT', ecosystem: 'runtime',
      homepage: 'https://nodejs.org', licenseFileHint: chromiumCredits, textIds: [], textOrigin: 'none',
    },
  ]
}

function ffmpegRuntime(options, textTable, referenceTexts) {
  if (options.platform !== 'win32') return null
  const { FFMPEG_BUILD, ffmpegDir, ffmpegBinDir, isReady } = require('./video-decoder-ffmpeg.cjs')
  if (!isReady()) return null
  const licenseText = readTextIfExists(path.join(ffmpegDir, 'LICENSE.txt'))
  if (licenseText) referenceTexts['GPL-3.0'] = normalizeText(licenseText)
  const versionResult = spawnSync(path.join(ffmpegBinDir, 'ffmpeg.exe'), ['-hide_banner', '-version'], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
  })
  const commit = FFMPEG_BUILD.version.match(/-g([0-9a-f]+)$/)?.[1]
  return {
    id: 'runtime:ffmpeg', name: 'FFmpeg', version: FFMPEG_BUILD.version.replace(/^n/, ''),
    license: 'GPL-3.0-or-later', ecosystem: 'runtime', homepage: 'https://ffmpeg.org',
    sources: [
      commit ? `https://github.com/FFmpeg/FFmpeg/tree/${commit}` : 'https://github.com/FFmpeg/FFmpeg',
      `https://github.com/BtbN/FFmpeg-Builds/tree/${FFMPEG_BUILD.releaseTag}`,
    ],
    includes: versionResult.status === 0 ? parseFfmpegExternalLibraries(versionResult.stdout) : [],
    textIds: licenseText ? [textTable.add(licenseText)] : [],
    textOrigin: licenseText ? 'package' : 'none',
  }
}

function libvipsRuntime(options, textTable, referenceTexts) {
  const platformPackage = path.join(root, 'node_modules', '@img', `sharp-${options.platform}-${options.arch}`)
  const libvipsPackage = path.join(root, 'node_modules', '@img', `sharp-libvips-${options.platform}-${options.arch}`)
  const versions = [platformPackage, libvipsPackage]
    .map((dir) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'versions.json'), 'utf8'))
      } catch {
        return null
      }
    })
    .find(Boolean)
  if (!versions?.vips) return null
  const lgpl = referenceTexts['LGPL-3.0']
  return {
    id: 'runtime:libvips', name: 'libvips', version: versions.vips, license: 'LGPL-3.0-or-later', ecosystem: 'runtime',
    homepage: 'https://www.libvips.org',
    sources: ['https://github.com/libvips/libvips', 'https://github.com/lovell/sharp-libvips'],
    includes: Object.entries(versions).filter(([name]) => name !== 'vips').map(([name, version]) => `${name} ${version}`),
    textIds: lgpl ? [textTable.add(lgpl)] : [],
    textOrigin: lgpl ? 'standard' : 'none',
  }
}

function sqliteRuntime(textTable) {
  const header = readTextIfExists(path.join(root, 'node_modules', 'better-sqlite3', 'deps', 'sqlite3', 'sqlite3.h'))
  const version = sqliteVersionFromHeader(header)
  if (!version) return null
  const blessing = sqliteBlessingFromHeader(header)
  return {
    id: 'runtime:sqlite', name: 'SQLite', version, license: 'Public Domain', ecosystem: 'runtime',
    homepage: 'https://www.sqlite.org/copyright.html',
    textIds: blessing ? [textTable.add(blessing)] : [], textOrigin: blessing ? 'package' : 'none',
  }
}

function generate(options) {
  const missing = []
  const textTable = createTextTable()
  const projectLicense = normalizeText(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'))
  const referenceTexts = { 'Apache-2.0': projectLicense }
  const lgplText = readTextIfExists(path.join(REFERENCE_DIR, 'LGPL-3.0.txt'))
  if (lgplText) referenceTexts['LGPL-3.0'] = normalizeText(lgplText)
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

  let npmPackages = []
  try {
    npmPackages = collectNpmPackages(loadNpmTree(), options)
  } catch (error) {
    missing.push(`npm：${error.message}`)
  }

  const triple = RUST_TARGETS[`${options.platform}-${options.arch}`] ?? null
  const cargoPackages = []
  for (const crate of NATIVE_CRATES) {
    if (crate.platforms && !crate.platforms.includes(options.platform)) continue
    try {
      cargoPackages.push(...collectCargoPackages(loadCargoMetadata(crate.dir, triple)))
    } catch (error) {
      missing.push(`cargo（${crate.dir}）：${error.message}`)
    }
  }

  const runtime = [...electronRuntime(textTable)]
  const ffmpeg = ffmpegRuntime(options, textTable, referenceTexts)
  if (ffmpeg) runtime.push(ffmpeg)
  else if (options.platform === 'win32') missing.push('FFmpeg：未找到已就绪的 FFmpeg 包（先运行 npm run build:video-decoder）')
  const libvips = libvipsRuntime(options, textTable, referenceTexts)
  if (libvips) runtime.push(libvips)
  const sqlite = sqliteRuntime(textTable)
  if (sqlite) runtime.push(sqlite)

  const notices = buildNotices({
    project: {
      name: PRODUCT_NAME,
      version: packageJson.version,
      license: packageJson.license,
      licenseTextId: textTable.add(projectLicense),
    },
    target: { platform: options.platform, arch: options.arch },
    runtime,
    npmPackages,
    cargoPackages,
    textTable,
    referenceTexts,
  })
  return { notices, missing }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const fingerprint = inputFingerprint(options)
  if (!options.force && fs.existsSync(JSON_FILE) && fs.existsSync(TEXT_FILE) && readTextIfExists(STAMP_FILE)?.trim() === fingerprint) {
    log('输入未变化，沿用现有清单。')
    return
  }
  const startedAt = Date.now()
  const { notices, missing } = generate(options)
  if (missing.length > 0) {
    for (const item of missing) console.warn(`[licenses] 缺少来源 ${item}`)
    if (options.strict) throw new Error('许可清单来源不完整（--strict）。')
  }
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(JSON_FILE, JSON.stringify(notices))
  fs.writeFileSync(TEXT_FILE, renderNoticesText(notices))
  // 来源不完整时不写指纹，下次运行会重新尝试补齐。
  if (missing.length === 0) fs.writeFileSync(STAMP_FILE, `${fingerprint}\n`)
  else fs.rmSync(STAMP_FILE, { force: true })
  const without = notices.components.filter((component) => component.textIds.length === 0 && !component.licenseFileHint)
  log(`已生成 ${notices.components.length} 个组件、${Object.keys(notices.texts).length} 份许可文本（${((Date.now() - startedAt) / 1000).toFixed(1)}s）；无许可全文 ${without.length} 个${without.length ? `：${without.map((item) => `${item.name}@${item.version}`).join(', ')}` : ''}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[licenses] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

module.exports = { generate, parseArgs }
