#!/usr/bin/env node
/**
 * 生成 GPL 对应源码包（任务 3.3，重要记录 014）：供发布时作为 GitHub Release 附件，
 * 与安装包内 resources/licenses/README.txt 第四节引用的文件名一致。
 *
 * 只在本地生成文件，不创建 Release、不上传（发布需用户确认）。
 *
 * 用法：
 *   node scripts/build-source-package.cjs [--ref <git 引用>] [--out <目录>]
 *     --ref  打包的项目提交；默认 v<package.json 版本> 标签，标签不存在时用 HEAD 并提示“仅供预演”
 *     --out  输出目录；默认 release/source/<版本>/
 *     --skip-dependencies  不获取外部库源码（仅供预演）
 *     --jobs <N>           外部库并行获取数（默认 4）
 *     --stages <正则>      只获取匹配的阶段（调试用，如 "x264|zimg"）
 *
 * 产物（文件名见 scripts/lib/distributionNotices.cjs sourcePackageFileNames）：
 *   henji-ai-<版本>-src.tar.gz                       git archive 项目源码（含 native/video-decoder）
 *   henji-ai-<版本>-video-decoder-cargo-vendor.tar.gz cargo vendor 的原生服务 Rust 依赖源码
 *   ffmpeg-<FFmpeg 版本>-src.tar.gz                   FFmpeg 官方提交源码
 *   ffmpeg-builds-<BtbN 标签>-src.tar.gz              BtbN/FFmpeg-Builds 构建脚本（固定全部外部库版本）
 *   ffmpeg-<FFmpeg 版本>-dependencies.tsv             对该变体启用的构建阶段与外部库来源（BtbN 自己的判定求值）
 *   ffmpeg-<FFmpeg 版本>-dependency-sources.partN.tar 外部库源码（每阶段一个 tar.gz，按 2GiB 附件上限分卷；重要记录 016）
 *   ffmpeg-<FFmpeg 版本>-dependency-sources.tsv       每个阶段的获取状态、归档 SHA256、耗时与未执行的生成步骤
 *   henji-ai-<版本>-SOURCE-README.txt、henji-ai-<版本>-SHA256SUMS.txt
 * 外部库按 BtbN 各阶段自己的下载命令获取，不依赖 Docker（替换方式见 scripts/lib/sourcePackage.cjs）。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { FFMPEG_BUILD, downloadWithRetry, sha256File } = require('./video-decoder-ffmpeg.cjs')
const { sourcePackageFileNames } = require('./lib/distributionNotices.cjs')
const {
  BTBN_STAGE_LISTING_SCRIPT,
  btbnVariantArgs,
  buildStageFetchScript,
  groupIntoParts,
  parseStageListing,
  renderChecksums,
  renderDependencyFetchStatus,
  renderDependencyTsv,
  renderSourceReadme,
  stageArchiveBase,
} = require('./lib/sourcePackage.cjs')

const root = path.resolve(__dirname, '..')

function log(message) {
  console.log(`[source-package] ${message}`)
}

function parseArgs(argv) {
  const options = { ref: null, out: null, skipDependencies: false, jobs: 4, stageFilter: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--ref') options.ref = argv[++index]
    else if (arg === '--out') options.out = argv[++index]
    else if (arg === '--skip-dependencies') options.skipDependencies = true
    else if (arg === '--jobs') options.jobs = Math.max(1, Number.parseInt(argv[++index], 10) || 1)
    else if (arg === '--stages') options.stageFilter = new RegExp(argv[++index])
    else throw new Error(`未知参数：${arg}`)
  }
  return options
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.error) throw new Error(`无法运行 ${command}：${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败（退出码 ${result.status}）：${(result.stderr || '').trim().slice(0, 600)}`)
  return result.stdout
}

/** Windows 10+ 自带 bsdtar（System32\tar.exe）支持 gzip 读写；Git Bash 的 GNU tar 不认 Windows 盘符，必须用绝对路径。 */
function tarExecutable() {
  return process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
}

/** Windows 上 PATH 里的 bash 可能是 WSL 的 System32\bash.exe；BtbN 脚本要用 Git for Windows 自带的 bash。 */
function bashExecutable() {
  if (process.platform !== 'win32') return 'bash'
  const execPath = run('git', ['--exec-path']).trim()
  // <Git>/mingw64/libexec/git-core → <Git>/bin/bash.exe
  const candidate = path.resolve(execPath, '..', '..', '..', 'bin', 'bash.exe')
  if (!fs.existsSync(candidate)) throw new Error(`找不到 Git for Windows 的 bash：${candidate}`)
  return candidate
}

function resolveCommit(options, version) {
  const tag = `v${version}`
  const ref = options.ref ?? tag
  const verified = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', windowsHide: true })
  if (verified.status === 0) return { ref, commit: verified.stdout.trim(), rehearsal: false }
  if (options.ref) throw new Error(`找不到 git 引用：${options.ref}`)
  log(`未找到标签 ${tag}，改用 HEAD 生成——仅供预演，正式发布须在打标签后重新生成。`)
  return { ref: 'HEAD', commit: run('git', ['rev-parse', 'HEAD']).trim(), rehearsal: true }
}

async function download(url, destination) {
  const partial = `${destination}.partial`
  log(`下载 ${url}`)
  await downloadWithRetry(url, partial)
  fs.renameSync(partial, destination)
}

function cargoVendor(commit, workDir, outputFile) {
  const lockPath = 'native/video-decoder/Cargo.lock'
  const committedLock = run('git', ['show', `${commit}:${lockPath}`])
  const workingLock = fs.readFileSync(path.join(root, lockPath), 'utf8')
  if (committedLock.replace(/\r\n/g, '\n') !== workingLock.replace(/\r\n/g, '\n')) {
    throw new Error(`工作区 ${lockPath} 与 ${commit} 不一致，cargo vendor 结果不能代表该提交；请检出该提交后重试。`)
  }
  const vendorRoot = path.join(workDir, 'cargo-vendor')
  const vendorDir = path.join(vendorRoot, 'vendor')
  const manifest = path.join(root, 'native', 'video-decoder', 'Cargo.toml')
  const base = ['vendor', '--locked', '--versioned-dirs', '--manifest-path', manifest, vendorDir]
  // 构建过的机器上依赖已在本地缓存，先离线；全新环境再联网（cargo 自带重试）。
  const offline = spawnSync('cargo', [...base, '--offline'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  const config = offline.status === 0 ? offline.stdout : run('cargo', base, { env: { ...process.env, CARGO_NET_RETRY: '10' } })
  fs.writeFileSync(path.join(vendorRoot, 'cargo-config.toml'), config)
  run(tarExecutable(), ['-czf', outputFile, '-C', vendorRoot, 'vendor', 'cargo-config.toml'])
}

function listBtbnStages(buildScriptsArchive, workDir) {
  const extractDir = path.join(workDir, 'btbn')
  fs.mkdirSync(extractDir, { recursive: true })
  run(tarExecutable(), ['-xzf', buildScriptsArchive, '-C', extractDir])
  const [top] = fs.readdirSync(extractDir)
  const scriptsDir = path.join(extractDir, top)
  const listing = run(bashExecutable(), ['-c', BTBN_STAGE_LISTING_SCRIPT, 'btbn-stages', ...btbnVariantArgs(FFMPEG_BUILD.variant)], { cwd: scriptsDir })
  const stages = parseStageListing(listing)
  if (stages.length === 0) throw new Error('BtbN 构建脚本没有列出任何启用的构建阶段')
  return stages
}

/** git 设置：保持源码原样（不转换换行）、允许长路径；只作用于本脚本启动的 git 进程。 */
const FETCH_GIT_CONFIG = Object.freeze({ 'core.autocrlf': 'false', 'core.longpaths': 'true', 'advice.detachedHead': 'false' })

function fetchEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', CARGO_NET_RETRY: '10', PYTHON: process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3') }
  const entries = Object.entries(FETCH_GIT_CONFIG)
  env.GIT_CONFIG_COUNT = String(entries.length)
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key
    env[`GIT_CONFIG_VALUE_${index}`] = value
  })
  return env
}

function runStageScript(scriptFile, cwd, logFile, timeoutMs) {
  return new Promise((resolve) => {
    const output = fs.openSync(logFile, 'w')
    // Git Bash 接受正斜杠的 Windows 路径。
    const child = spawn(bashExecutable(), [scriptFile.split(path.sep).join('/')], { cwd, env: fetchEnv(), stdio: ['ignore', output, output], windowsHide: true })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      fs.closeSync(output)
      resolve({ ok: false, reason: `无法运行 bash：${error.message}` })
    })
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      fs.closeSync(output)
      resolve(code === 0 ? { ok: true } : { ok: false, reason: signal ? `超时（${timeoutMs / 60000} 分钟）被终止` : `退出码 ${code}` })
    })
  })
}

/** 阶段目录里除 .git 外至少有一个文件（防止下载“成功”却是空目录，如 svn 修订版未命中）。 */
function hasSourceFiles(dir) {
  const pending = [dir]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      if (entry.isDirectory()) pending.push(path.join(current, entry.name))
      else return true
    }
  }
  return false
}

function tailOf(file, lines = 3) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter((line) => !line.startsWith('[fetch] ')).slice(-lines).join(' | ').slice(0, 400)
  } catch {
    return ''
  }
}

/**
 * 按 BtbN 各阶段自己的下载命令取得外部库源码（不依赖 Docker，见 scripts/lib/sourcePackage.cjs buildStageFetchScript），
 * 每个阶段打成一个不含 .git 的 <阶段>.tar.gz，再按附件上限分组为 tar。拿不到的阶段记录原因，不中断其他阶段。
 */
async function fetchDependencySources(stages, { outDir, workDir, names, jobs, stageFilter }) {
  const fetchRoot = path.join(outDir, '.dependency-work')
  const archiveDir = path.join(fetchRoot, 'archives')
  fs.rmSync(fetchRoot, { recursive: true, force: true })
  fs.mkdirSync(archiveDir, { recursive: true })
  const queue = stages.filter((stage) => stage.steps.length && (!stageFilter || stageFilter.test(stage.stage)))
  const results = []
  let next = 0
  const startedAt = Date.now()
  async function worker() {
    while (next < queue.length) {
      const stage = queue[next++]
      const base = stageArchiveBase(stage.stage)
      const stageDir = path.join(fetchRoot, 'src', base)
      const scriptFile = path.join(fetchRoot, `${base}.sh`)
      const logFile = path.join(workDir, `${base}.log`)
      fs.mkdirSync(stageDir, { recursive: true })
      const { script, skipped } = buildStageFetchScript(stage.steps)
      fs.writeFileSync(scriptFile, script)
      const began = Date.now()
      const run = await runStageScript(scriptFile, stageDir, logFile, 40 * 60 * 1000)
      const seconds = (Date.now() - began) / 1000
      const note = skipped.map((item) => `未执行：${item.step}（${item.reason}）`).join('；')
      if (run.ok && !hasSourceFiles(stageDir)) {
        results.push({ stage: stage.stage, status: 'failed', seconds, note: `下载命令成功但没有取到任何源码文件：${tailOf(logFile)}` })
        log(`  ✗ ${stage.stage}（${seconds.toFixed(0)}s）：没有取到源码文件`)
      } else if (!run.ok) {
        results.push({ stage: stage.stage, status: 'failed', seconds, note: `${run.reason}：${tailOf(logFile)}${note ? `；${note}` : ''}` })
        log(`  ✗ ${stage.stage}（${seconds.toFixed(0)}s）：${run.reason}`)
      } else {
        const archiveName = `${base}.tar.gz`
        const archive = path.join(archiveDir, archiveName)
        const packed = spawnSync(tarExecutable(), ['-czf', archive, '--exclude', '.git', '-C', stageDir, '.'], { windowsHide: true, encoding: 'utf8' })
        if (packed.status !== 0) {
          results.push({ stage: stage.stage, status: 'failed', seconds, note: `打包失败：${(packed.stderr || '').trim().slice(0, 300)}` })
        } else {
          const size = fs.statSync(archive).size
          results.push({ stage: stage.stage, status: 'ok', archive: archiveName, size, sha256: await sha256File(archive), seconds, note })
          log(`  ✓ ${stage.stage}（${seconds.toFixed(0)}s，${(size / 1048576).toFixed(1)} MiB）`)
        }
      }
      fs.rmSync(stageDir, { recursive: true, force: true })
      fs.rmSync(scriptFile, { force: true })
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, () => worker()))
  results.sort((left, right) => left.stage.localeCompare(right.stage))

  const ok = results.filter((result) => result.status === 'ok')
  const parts = groupIntoParts(ok.map((result) => ({ name: result.archive, size: result.size })), 1900 * 1024 * 1024)
  const partFiles = []
  parts.forEach((part, index) => {
    const partName = `${names.dependencySourcesPrefix}.part${index + 1}.tar`
    run(tarExecutable(), ['-cf', path.join(outDir, partName), '-C', archiveDir, ...part.entries.map((entry) => entry.name)])
    partFiles.push(partName)
  })
  fs.writeFileSync(path.join(outDir, names.dependencyStatus), renderDependencyFetchStatus(results))
  fs.rmSync(fetchRoot, { recursive: true, force: true })
  const totalBytes = ok.reduce((sum, result) => sum + result.size, 0)
  log(`外部库源码：${ok.length}/${results.length} 个阶段成功，${(totalBytes / 1048576).toFixed(1)} MiB，${partFiles.length} 个分卷，${((Date.now() - startedAt) / 1000).toFixed(0)}s`)
  return { partFiles, failures: results.filter((result) => result.status !== 'ok'), totalBytes }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  const { ref, commit, rehearsal } = resolveCommit(options, version)
  const names = sourcePackageFileNames({ version, ffmpegBuild: FFMPEG_BUILD })
  const outDir = path.resolve(root, options.out ?? path.join('release', 'source', version))
  fs.mkdirSync(outDir, { recursive: true })
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-source-package-'))
  const startedAt = Date.now()
  try {
    const projectArchive = path.join(outDir, names.project)
    log(`项目源码：git archive ${commit}${ref !== commit ? `（${ref}）` : ''}`)
    run('git', ['archive', '--format=tar.gz', `--prefix=henji-ai-${version}/`, '-o', projectArchive, commit])

    log('原生视频解码服务 Rust 依赖：cargo vendor')
    cargoVendor(commit, workDir, path.join(outDir, names.projectCargoVendor))

    await download(`https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/${FFMPEG_BUILD.sourceCommit}`, path.join(outDir, names.ffmpeg))
    const buildScripts = path.join(outDir, names.buildScripts)
    await download(`https://codeload.github.com/BtbN/FFmpeg-Builds/tar.gz/${FFMPEG_BUILD.buildScriptsCommit}`, buildScripts)

    const stages = listBtbnStages(buildScripts, workDir)
    fs.writeFileSync(path.join(outDir, names.dependencies), renderDependencyTsv(stages, FFMPEG_BUILD))
    const withSources = stages.filter((stage) => stage.command)
    log(`BtbN 对 ${FFMPEG_BUILD.variant} 启用 ${stages.length} 个构建阶段，其中 ${withSources.length} 个有源码下载`)

    let dependencyResult = { partFiles: [], failures: [] }
    if (options.skipDependencies) {
      log('按 --skip-dependencies 跳过外部库源码（仅供预演；正式发布必须包含）')
    } else {
      log(`获取外部库源码（${options.jobs} 路并行）`)
      dependencyResult = await fetchDependencySources(stages, { outDir, workDir, names, jobs: options.jobs, stageFilter: options.stageFilter })
    }

    fs.writeFileSync(path.join(outDir, names.readme), renderSourceReadme({
      appVersion: version, commit, ref, ffmpegBuild: FFMPEG_BUILD, names, stageCount: withSources.length,
      dependencyParts: dependencyResult.partFiles, dependencyFailures: dependencyResult.failures,
    }))

    const entries = []
    const files = ['project', 'projectCargoVendor', 'ffmpeg', 'buildScripts', 'dependencies']
      .map((key) => names[key])
      .concat(dependencyResult.partFiles, options.skipDependencies ? [] : [names.dependencyStatus], [names.readme])
    for (const name of files) {
      const file = path.join(outDir, name)
      entries.push({ name, size: fs.statSync(file).size, sha256: await sha256File(file) })
    }
    const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
    log(`源码包合计 ${(totalBytes / 1048576).toFixed(1)} MiB（${entries.length} 个文件）`)
    if (dependencyResult.failures.length) log(`警告：${dependencyResult.failures.length} 个外部库阶段未能取得，见 ${names.dependencyStatus}；正式发布前须补齐`)
    fs.writeFileSync(path.join(outDir, names.checksums), renderChecksums(entries))
    for (const entry of entries) log(`  ${entry.name}  ${(entry.size / 1048576).toFixed(1)} MiB  ${entry.sha256}`)
    log(`完成（${((Date.now() - startedAt) / 1000).toFixed(1)}s）：${outDir}${rehearsal ? '（预演：基于 HEAD，非发布标签）' : ''}`)
    log('未创建 GitHub Release、未上传；发布时把该目录内全部文件作为 Release 附件（需用户确认）。')
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[source-package] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

module.exports = { parseArgs }
