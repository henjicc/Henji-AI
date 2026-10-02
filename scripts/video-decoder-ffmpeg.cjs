#!/usr/bin/env node
/**
 * 原生视频解码服务（native/video-decoder）的 FFmpeg 获取、定位与构建入口，开发与 CI 共用。
 *
 * FFmpeg 来源固定为 BtbN/FFmpeg-Builds 的 win64-gpl-shared 预编译包（重要记录 014）：
 * Windows 上全项目唯一一份 FFmpeg——原生解码服务动态链接其 DLL，主进程 CLI（缩略图、波形、
 * 压缩、帧导出、探测）调用同包 ffmpeg.exe / ffprobe.exe。版本、下载地址与 SHA256 固定在
 * FFMPEG_BUILD，禁止改成 latest / master 浮动构建；选月末构建（BtbN 长期保留），升级时同步改
 * 这里与重要记录 014。
 *
 * 用法：
 *   node scripts/video-decoder-ffmpeg.cjs ensure          下载（如缺失）、校验并解压，输出目录
 *   node scripts/video-decoder-ffmpeg.cjs path            输出已就绪的 FFmpeg 目录（缺失则失败）
 *   node scripts/video-decoder-ffmpeg.cjs build [--debug] ensure + cargo build，并把 FFmpeg 运行时文件复制到产物目录
 *   node scripts/video-decoder-ffmpeg.cjs test            ensure + cargo test（DLL 目录加入 PATH）
 *
 * 定位约定（主进程 electron/main/services/video/ffmpeg-loader.ts 与脚本 scripts/lib/mediaBinaries.cjs 共用）：
 *   - 开发：ensure 写入 native/video-decoder/ffmpeg/current.json，指向当前包的 bin 目录（ffmpeg.exe、ffprobe.exe 与 DLL）。
 *   - 打包：target/release 下的服务、全部 FFmpeg DLL 与 ffmpeg.exe/ffprobe.exe 整体放入 resources/video-decoder/
 *     （electron-builder.yml win.extraResources），服务与 CLI 共用同一份 DLL。
 *
 * 只支持 Windows（重要记录 005）；其他平台 ensure/build/test 输出跳过说明并以 0 退出。
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const crateDir = path.join(root, 'native', 'video-decoder')
const manifestPath = path.join(crateDir, 'Cargo.toml')
const ffmpegRoot = path.join(crateDir, 'ffmpeg')

const FFMPEG_BUILD = Object.freeze({
  version: 'n9.0.2-17-g2a571b6068',
  releaseTag: 'autobuild-2026-09-30-13-08',
  asset: 'ffmpeg-n9.0.2-17-g2a571b6068-win64-gpl-shared-9.0.zip',
  sha256: '3da6c7b60bb9ccd73ec5b5e815ba804a0879eb362ba0e3beebce50174c022696',
  size: 86321582,
})
const FFMPEG_URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_BUILD.releaseTag}/${FFMPEG_BUILD.asset}`
const ffmpegDir = path.join(ffmpegRoot, FFMPEG_BUILD.asset.replace(/\.zip$/, ''))
const ffmpegBinDir = path.join(ffmpegDir, 'bin')
const READY_MARKER = path.join(ffmpegDir, '.henji-ready')
const CURRENT_POINTER = path.join(ffmpegRoot, 'current.json')
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000]
// 服务链接 avcodec/avformat/avutil/swscale/swresample；ffmpeg.exe/ffprobe.exe 另需 avfilter/avdevice。
// 运行时目录只放这些 DLL 与两个 CLI（不含 ffplay）。
const FFMPEG_DLL = /^(avcodec|avformat|avutil|swscale|swresample|avfilter|avdevice|postproc)-\d+\.dll$/i
const CLI_EXECUTABLES = ['ffmpeg.exe', 'ffprobe.exe']
const CERT_ERROR = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS_CERT/i

function log(message) {
  console.log(`[video-decoder] ${message}`)
}

function isSupportedPlatform() {
  return process.platform === 'win32' && process.arch === 'x64'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function downloadOnce(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'henji-ai-build' }, timeout: 60_000 }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirects > 5) return reject(new Error('下载重定向次数过多'))
        return resolve(downloadOnce(new URL(response.headers.location, url).toString(), destination, redirects + 1))
      }
      if (status !== 200) {
        response.resume()
        const error = new Error(`下载失败：HTTP ${status}`)
        error.httpStatus = status
        return reject(error)
      }
      const file = fs.createWriteStream(destination)
      let received = 0
      let lastReport = Date.now()
      response.on('data', (chunk) => {
        received += chunk.length
        if (Date.now() - lastReport > 5_000) {
          lastReport = Date.now()
          log(`已下载 ${(received / 1048576).toFixed(1)} / ${(FFMPEG_BUILD.size / 1048576).toFixed(1)} MiB`)
        }
      })
      response.pipe(file)
      file.on('finish', () => file.close(() => resolve(received)))
      file.on('error', reject)
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('下载超时')))
    request.on('error', reject)
  })
}

async function downloadWithRetry(url, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await downloadOnce(url, destination)
    } catch (error) {
      const message = error instanceof Error ? `${error.code ?? ''} ${error.message}` : String(error)
      // 认证/证书错误与 4xx 不是临时故障，停止盲重试。
      if (CERT_ERROR.test(message) || (error.httpStatus >= 400 && error.httpStatus < 500)) throw error
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined) throw error
      log(`下载中断（${message.trim()}），${delay / 1000}s 后重试（第 ${attempt + 1} 次）`)
      await sleep(delay)
    }
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject)
  })
}

function extractZip(zipPath, destination) {
  // Windows 10+ 自带 bsdtar（System32\tar.exe）可解 zip；Git Bash 的 GNU tar 不支持 zip，必须用绝对路径。
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  const result = spawnSync(tar, ['-xf', zipPath, '-C', destination], { stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) throw new Error(`解压 FFmpeg 失败（退出码 ${result.status}）`)
}

function isReady() {
  return fs.existsSync(READY_MARKER)
    && fs.existsSync(path.join(ffmpegDir, 'include', 'libavformat', 'avformat.h'))
    && fs.existsSync(path.join(ffmpegDir, 'lib', 'avformat.lib'))
    && CLI_EXECUTABLES.every((name) => fs.existsSync(path.join(ffmpegBinDir, name)))
}

/** 写入开发期定位指针（主进程 CLI 与脚本读取），并移除本脚本此前解压的旧版本目录。 */
function finalizeCurrent() {
  const pointer = {
    version: FFMPEG_BUILD.version,
    asset: FFMPEG_BUILD.asset,
    binDir: path.relative(ffmpegRoot, ffmpegBinDir).split(path.sep).join('/'),
  }
  const serialized = `${JSON.stringify(pointer, null, 2)}\n`
  if (!fs.existsSync(CURRENT_POINTER) || fs.readFileSync(CURRENT_POINTER, 'utf8') !== serialized) {
    fs.writeFileSync(CURRENT_POINTER, serialized)
  }
  for (const entry of fs.readdirSync(ffmpegRoot, { withFileTypes: true })) {
    const candidate = path.join(ffmpegRoot, entry.name)
    if (!entry.isDirectory() || candidate === ffmpegDir || !fs.existsSync(path.join(candidate, '.henji-ready'))) continue
    fs.rmSync(candidate, { recursive: true, force: true })
    log(`已移除旧版本 FFmpeg：${entry.name}`)
  }
}

async function ensureFfmpeg() {
  if (isReady()) {
    finalizeCurrent()
    return ffmpegDir
  }
  fs.mkdirSync(ffmpegRoot, { recursive: true })
  const zipPath = path.join(ffmpegRoot, FFMPEG_BUILD.asset)
  if (!fs.existsSync(zipPath) || (await sha256File(zipPath)) !== FFMPEG_BUILD.sha256) {
    const partial = `${zipPath}.partial`
    log(`下载 FFmpeg ${FFMPEG_BUILD.version}（GPL 共享库）：${FFMPEG_URL}`)
    await downloadWithRetry(FFMPEG_URL, partial)
    const digest = await sha256File(partial)
    if (digest !== FFMPEG_BUILD.sha256) {
      fs.rmSync(partial, { force: true })
      throw new Error(`FFmpeg 包校验失败：期望 ${FFMPEG_BUILD.sha256}，实际 ${digest}`)
    }
    fs.renameSync(partial, zipPath)
  }
  fs.rmSync(ffmpegDir, { recursive: true, force: true })
  extractZip(zipPath, ffmpegRoot)
  if (!fs.existsSync(path.join(ffmpegDir, 'lib', 'avformat.lib'))) {
    throw new Error(`解压结果缺少 lib/avformat.lib：${ffmpegDir}`)
  }
  fs.writeFileSync(READY_MARKER, `${JSON.stringify({ ...FFMPEG_BUILD, url: FFMPEG_URL }, null, 2)}\n`)
  fs.rmSync(zipPath, { force: true })
  finalizeCurrent()
  log(`FFmpeg 已就绪：${ffmpegDir}`)
  return ffmpegDir
}

/** 与服务同目录分发的 FFmpeg 运行时文件：库 DLL + ffmpeg.exe/ffprobe.exe（主进程 CLI 用，不含 ffplay）。 */
function runtimeFiles() {
  return fs.readdirSync(ffmpegBinDir)
    .filter((name) => FFMPEG_DLL.test(name) || CLI_EXECUTABLES.includes(name.toLowerCase()))
    .map((name) => path.join(ffmpegBinDir, name))
}

function findOnPath(env, exe) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  return (env[pathKey] ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, exe)))
}

/**
 * ffmpeg-sys-next 的 build.rs 会用 C 编译器编译一个特性探测程序；本机 cargo 配置可能只写了
 * CC=cl.exe 而 PATH 里没有 cl.exe。此时通过 vswhere 定位 VS 生成工具并加载 vcvars64 环境，
 * 不修改任何全局或用户配置。
 */
function msvcDeveloperEnv(env) {
  if (findOnPath(env, 'cl.exe')) return {}
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const vswhere = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!fs.existsSync(vswhere)) return {}
  const located = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true })
  const installationPath = located.stdout?.trim().split(/\r?\n/)[0]
  if (!installationPath) return {}
  const vcvars = path.join(installationPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  if (!fs.existsSync(vcvars)) return {}
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"call "${vcvars}" >nul && set"`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) return {}
  const loaded = {}
  for (const line of result.stdout.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) loaded[line.slice(0, index)] = line.slice(index + 1)
  }
  log(`已加载 MSVC 生成环境：${installationPath}`)
  return loaded
}

function cargoEnv() {
  const env = { ...process.env }
  const developerEnv = msvcDeveloperEnv(env)
  for (const [key, value] of Object.entries(developerEnv)) {
    const existing = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase())
    if (existing && existing !== key) delete env[existing]
    env[key] = value
  }
  env.FFMPEG_DIR = ffmpegDir
  // bindgen 需要 libclang；未显式配置时使用 LLVM 默认安装位置。
  const defaultLlvm = 'C:\\Program Files\\LLVM\\bin'
  if (!env.LIBCLANG_PATH && fs.existsSync(path.join(defaultLlvm, 'libclang.dll'))) env.LIBCLANG_PATH = defaultLlvm
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = `${path.join(ffmpegDir, 'bin')}${path.delimiter}${env[pathKey] ?? ''}`
  return env
}

function runCargo(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('cargo', [...args, '--manifest-path', manifestPath], { cwd: root, env: cargoEnv(), stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`cargo ${args[0]} 失败（退出码 ${code}）`))))
  })
}

async function build(profile) {
  await ensureFfmpeg()
  const startedAt = Date.now()
  await runCargo(profile === 'release' ? ['build', '--release'] : ['build'])
  const targetDir = path.join(crateDir, 'target', profile)
  const files = runtimeFiles()
  const names = new Set(files.map((file) => path.basename(file).toLowerCase()))
  // 升级后旧主版本的 DLL（如 avcodec-62.dll）留在产物目录会被一并打包，先清掉。
  for (const name of fs.readdirSync(targetDir)) {
    if (FFMPEG_DLL.test(name) && !names.has(name.toLowerCase())) fs.rmSync(path.join(targetDir, name), { force: true })
  }
  for (const file of files) {
    const destination = path.join(targetDir, path.basename(file))
    const source = fs.statSync(file)
    const existing = fs.existsSync(destination) ? fs.statSync(destination) : null
    if (!existing || existing.size !== source.size || existing.mtimeMs < source.mtimeMs) fs.copyFileSync(file, destination)
  }
  log(`构建完成（${profile}，${((Date.now() - startedAt) / 1000).toFixed(1)}s）：${path.join(targetDir, 'henji-video-decoder.exe')}`)
}

async function main() {
  const [command = 'ensure', ...rest] = process.argv.slice(2)
  if (!isSupportedPlatform()) {
    if (command === 'path') throw new Error('原生视频解码服务只支持 Windows x64')
    log(`当前平台 ${process.platform}-${process.arch} 不构建原生视频解码服务（只支持 Windows x64），已跳过。`)
    return
  }
  if (command === 'ensure') return void console.log(await ensureFfmpeg())
  if (command === 'path') {
    if (!isReady()) throw new Error('FFmpeg 尚未就绪，请先运行 node scripts/video-decoder-ffmpeg.cjs ensure')
    return void console.log(ffmpegDir)
  }
  if (command === 'build') return build(rest.includes('--debug') ? 'debug' : 'release')
  if (command === 'test') {
    await ensureFfmpeg()
    return runCargo(['test', ...rest])
  }
  throw new Error(`未知命令：${command}`)
}

module.exports = { FFMPEG_BUILD, FFMPEG_URL, ffmpegDir, ffmpegBinDir, CURRENT_POINTER, ensureFfmpeg, isReady, isSupportedPlatform }

if (require.main === module) {
  main().catch((error) => {
    console.error(`[video-decoder] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
