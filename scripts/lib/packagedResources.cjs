/**
 * 打包产物核对（任务 3.3）：electron-builder afterPack 钩子（scripts/electron-builder-after-pack.cjs）在生成
 * NSIS/MSI/DMG 之前对解包目录调用，任何一项不符即中止打包。CI 与本机 electron:dist 共用。
 *
 * Windows 核对：
 *   - resources/resources/video-decoder/ 恰好是原生服务 + FFmpeg 运行时文件（DLL、ffmpeg.exe、ffprobe.exe），
 *     且逐个与构建来源（native/video-decoder/target/release、BtbN 包 bin）字节一致，不混入 pdb 等开发产物；
 *   - resources/resources/licenses/ 含全部随包许可文件、不含构建专用文件，BUILD-INFO 记录的哈希与随包 FFmpeg 一致；
 *   - Windows 不再打包 ffmpeg-ffprobe-static（app.asar 与 app.asar.unpacked 均无，重要记录 014）；
 *   - 安装目录有 Electron 附带的 LICENSES.chromium.html（THIRD-PARTY-NOTICES 引用）。
 * 其他平台只核对许可文件（原生解码服务只在 Windows，重要记录 005）。
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const {
  BUILD_ONLY_LICENSE_FILES,
  DISTRIBUTED_LICENSE_FILES,
  expectedLicenseFiles,
} = require('./distributionNotices.cjs')
const { dynamicMsvcRuntimeOf } = require('./nativeCrt.cjs')

const VIDEO_DECODER_EXECUTABLE = 'henji-video-decoder.exe'
/** app.asar 顶层只应有 electron-builder.yml `files` 的包含项与生产依赖；出现其他目录说明匹配规则退化成了整个仓库。 */
const ASAR_TOP_LEVEL = new Set(['out', 'package.json', 'node_modules'])
/** 其他平台的可选二进制包（如 @esbuild/linux-x64、@mariozechner/clipboard-darwin-arm64、@esbuild/win32-arm64）。 */
const FOREIGN_PLATFORM_PACKAGE = /node_modules\/((?:@[^/]+\/)?(?:[^/]*-)?(?:darwin|linux|android|freebsd|openbsd|netbsd|sunos|aix|openharmony|win32-(?:arm64|ia32))(?:-[^/]*)?)\//
const EXCLUDED_WINDOWS_PACKAGE = 'ffmpeg-ffprobe-static'

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function listFilesRecursive(dir, prefix = '') {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? listFilesRecursive(path.join(dir, entry.name), relative) : [relative]
  })
}

/** electron-builder 解包目录里的 Resources 目录（process.resourcesPath）。 */
function resourcesDirOf({ appOutDir, platform, productFilename }) {
  return platform === 'darwin'
    ? path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources')
}

/**
 * @param {object} input
 * @param {string} input.appOutDir
 * @param {NodeJS.Platform} input.platform
 * @param {string} [input.productFilename]
 * @param {{ name: string, source: string }[]} [input.videoDecoderSources] Windows：应随包的原生服务与 FFmpeg 文件及其构建来源
 * @param {string} [input.ffmpegVersion] Windows：BUILD-INFO 应记录的 FFmpeg 版本
 * @param {(asarPath: string) => string[]} [input.listAsar] 列出 app.asar 内路径
 * @returns {string[]} 不符项；空数组表示通过
 */
function verifyPackagedResources({ appOutDir, platform, productFilename, videoDecoderSources = [], ffmpegVersion, listAsar }) {
  const problems = []
  const resourcesDir = resourcesDirOf({ appOutDir, platform, productFilename })
  const bundledDir = path.join(resourcesDir, 'resources')

  const licensesDir = path.join(bundledDir, 'licenses')
  const licenseFiles = new Set(listFilesRecursive(licensesDir))
  for (const file of expectedLicenseFiles(platform)) {
    if (!licenseFiles.has(file)) problems.push(`缺少许可文件 licenses/${file}`)
  }
  for (const file of BUILD_ONLY_LICENSE_FILES) {
    if (licenseFiles.has(file)) problems.push(`构建专用文件不应随包：licenses/${file}`)
  }
  const unexpectedLicenses = [...licenseFiles].filter((file) => !Object.values(DISTRIBUTED_LICENSE_FILES).includes(file) && !BUILD_ONLY_LICENSE_FILES.includes(file))
  if (unexpectedLicenses.length) problems.push(`licenses 下有未登记的文件：${unexpectedLicenses.join(', ')}`)

  const asarPath = path.join(resourcesDir, 'app.asar')
  const asarEntries = listAsar && fs.existsSync(asarPath) ? listAsar(asarPath) : []
  const topLevel = [...new Set(asarEntries.map((entry) => entry.split(/[\\/]/).find(Boolean)).filter(Boolean))]
  const strayTopLevel = topLevel.filter((name) => !ASAR_TOP_LEVEL.has(name))
  if (strayTopLevel.length) {
    problems.push(`app.asar 混入了 files 包含项之外的内容（文件匹配规则退化成整个仓库？）：${strayTopLevel.slice(0, 12).join(', ')}${strayTopLevel.length > 12 ? ' …' : ''}`)
  }
  if (platform !== 'win32') return problems

  // 原生服务与 FFmpeg：文件集合恰好一致、逐个字节一致。
  const decoderDir = path.join(bundledDir, 'video-decoder')
  const packaged = new Set(listFilesRecursive(decoderDir))
  const expectedNames = new Set(videoDecoderSources.map((item) => item.name))
  if (!expectedNames.has(VIDEO_DECODER_EXECUTABLE)) problems.push(`核对清单缺少 ${VIDEO_DECODER_EXECUTABLE}`)
  for (const name of expectedNames) if (!packaged.has(name)) problems.push(`缺少 video-decoder/${name}`)
  for (const name of packaged) if (!expectedNames.has(name)) problems.push(`video-decoder 下有不应随包的文件：${name}`)
  const buildInfoPath = path.join(licensesDir, DISTRIBUTED_LICENSE_FILES.ffmpegBuildInfo)
  const buildInfo = fs.existsSync(buildInfoPath) ? fs.readFileSync(buildInfoPath, 'utf8') : ''
  if (ffmpegVersion && buildInfo && !buildInfo.includes(ffmpegVersion)) problems.push(`BUILD-INFO 未记录当前 FFmpeg 版本 ${ffmpegVersion}（许可文件过期）`)
  for (const { name, source } of videoDecoderSources) {
    const target = path.join(decoderDir, name)
    if (!packaged.has(name)) continue
    if (!fs.existsSync(source)) {
      problems.push(`找不到构建来源 ${source}`)
      continue
    }
    const digest = sha256(target)
    if (digest !== sha256(source)) problems.push(`video-decoder/${name} 与构建来源不一致（${source}）`)
    if (name !== VIDEO_DECODER_EXECUTABLE && buildInfo && !buildInfo.includes(digest)) problems.push(`BUILD-INFO 未记录随包 ${name} 的 SHA256（许可文件与随包 FFmpeg 不一致）`)
  }

  const audioWorker = path.join(bundledDir, 'henji-audio-worker.exe')
  if (!fs.existsSync(audioWorker)) problems.push('缺少 henji-audio-worker.exe')
  // 自有原生程序必须静态链接 VC 运行时（干净机器没有 VCRUNTIME140.dll，scripts/lib/nativeCrt.cjs）。
  for (const program of [path.join(decoderDir, VIDEO_DECODER_EXECUTABLE), audioWorker]) {
    if (!fs.existsSync(program)) continue
    const runtime = dynamicMsvcRuntimeOf(fs.readFileSync(program))
    if (runtime) problems.push(`${path.basename(program)} 动态依赖 ${runtime}（干净机器缺 VC++ 运行库会无法启动，应静态链接 CRT）`)
  }
  if (!fs.existsSync(path.join(appOutDir, 'LICENSES.chromium.html'))) problems.push('安装目录缺少 LICENSES.chromium.html（THIRD-PARTY-NOTICES 引用）')

  const unpacked = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', EXCLUDED_WINDOWS_PACKAGE)
  if (fs.existsSync(unpacked)) problems.push(`Windows 不应打包 ${EXCLUDED_WINDOWS_PACKAGE}（app.asar.unpacked 中存在）`)
  const excluded = new RegExp(`[\\\\/]node_modules[\\\\/]${EXCLUDED_WINDOWS_PACKAGE}([\\\\/]|$)`)
  if (asarEntries.some((entry) => excluded.test(entry))) problems.push(`Windows 不应打包 ${EXCLUDED_WINDOWS_PACKAGE}（app.asar 中存在）`)
  const foreign = [...new Set(asarEntries.map((entry) => entry.split('\\').join('/').match(FOREIGN_PLATFORM_PACKAGE)?.[1]).filter(Boolean))]
  if (foreign.length) {
    problems.push(`Windows x64 安装包混入了其他平台的二进制包（在 electron-builder.yml win.files 排除）：${foreign.slice(0, 8).join(', ')}${foreign.length > 8 ? ` 等 ${foreign.length} 个` : ''}`)
  }
  return problems
}

module.exports = { VIDEO_DECODER_EXECUTABLE, resourcesDirOf, verifyPackagedResources }
