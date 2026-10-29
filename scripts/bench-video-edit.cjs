'use strict'

/**
 * 剪辑播放基准台：`npm run bench:video-edit -- [选项]`
 *
 * 用 out/ 里的正式构建（比 src/、electron/ 源码旧就在启动前报错，提示先 electron:bundle）在隔离资料目录里打开固定工程，关掉自动预渲染，
 * 预热播放一遍、正式播放若干遍（默认两遍）。每遍停止时节目写一条 `video_edit.playback.stats` 日志，
 * 基准台经正式日志查询接口读回，输出 JSON：跳帧比例、渲染耗时与“设帧到上屏”的 P50/P95/最大值、各渲染分段分布与显卡负载。
 * 正式各遍的跳帧比例与渲染耗时 P50/P95 两两相差都在容差（默认 5%）以内才算基线；最大值只报不判。
 *
 * `--diagnostics` 打开渲染诊断（GPU 时间戳分段 gpu.*、Worker 事件循环迟滞探针与投递延迟 lag.*）；诊断本身有开销，
 * 不要和不带诊断的结果混着比较。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.cjs')
const STATS_EVENT = 'video_edit.playback.stats'
const LAG_EVENT = 'video_edit.worker.lag.summary'

const HELP = `用法：npm run bench:video-edit -- [选项]

默认打开固定合成夹具（10 秒 1080p60 录屏 + 代码标题条），从头播到尾：预热 1 遍、正式 2 遍。
需要 out/ 是最新构建（先 npm run electron:bundle）；全程使用隔离资料目录，不读写用户真实资料。

选项：
  --project <路径>     真实工程文件夹（或工程里的任一文件）：按 .henji/project.json 找到工程根，只把这个工程复制到临时目录再测
  --document <ID>      工程里有多份剪辑时指定剪辑文档 ID（默认工程的主剪辑）
  --from <帧>          起播帧（默认 0）
  --to <帧>            播到这一帧停（不含；默认序列末尾）
  --rounds <n>         正式播放遍数，至少 2（默认 2）
  --warmup <n>         预热遍数（默认 1）
  --tolerance <比例>   基线容差（默认 0.05）
  --diagnostics        打开渲染诊断：GPU 时间戳分段与 Worker 迟滞探针（有额外开销）
  --out <目录>         结果目录（默认 .bench/video-edit）
  --help, -h           显示本帮助

输出：结果 JSON 写到 --out 目录并打印到标准输出；baseline.stable 为 true 才算基线。`

function parseArgs(argv) {
  const options = { project: null, document: null, from: 0, to: null, rounds: 2, warmup: 1, tolerance: 0.05, diagnostics: false, out: path.join(ROOT, '.bench', 'video-edit'), help: false }
  const value = (index, name) => {
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) throw new Error(`${name} 需要一个值`)
    return next
  }
  const integer = (text, name, min) => {
    const number = Number(text)
    if (!Number.isInteger(number) || number < min) throw new Error(`${name} 必须是不小于 ${min} 的整数：${text}`)
    return number
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--diagnostics') options.diagnostics = true
    else if (arg === '--project') options.project = path.resolve(value(index++, arg))
    else if (arg === '--document') options.document = value(index++, arg)
    else if (arg === '--from') options.from = integer(value(index++, arg), arg, 0)
    else if (arg === '--to') options.to = integer(value(index++, arg), arg, 1)
    else if (arg === '--rounds') options.rounds = integer(value(index++, arg), arg, 2)
    else if (arg === '--warmup') options.warmup = integer(value(index++, arg), arg, 0)
    else if (arg === '--out') options.out = path.resolve(value(index++, arg))
    else if (arg === '--tolerance') {
      const tolerance = Number(value(index++, arg))
      if (!(tolerance > 0 && tolerance < 1)) throw new Error(`--tolerance 必须在 0 和 1 之间：${argv[index]}`)
      options.tolerance = tolerance
    } else throw new Error(`未知选项：${arg}`)
  }
  if (options.to !== null && options.to <= options.from) throw new Error('--to 必须大于 --from')
  return options
}

/** 工程根是最近一个带 `.henji/project.json` 的目录（路径本身或它的上级）；不在工程里就报错，不去复制无关的父目录。 */
function findProjectRoot(target) {
  let current = fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.dirname(target)
  for (;;) {
    if (fs.existsSync(path.join(current, '.henji', 'project.json'))) return current
    const parent = path.dirname(current)
    if (parent === current) throw new Error(`${target} 不在痕迹AI工程里（没有找到 .henji/project.json）`)
    current = parent
  }
}

const relativeDifference = (a, b) => {
  const scale = Math.max(Math.abs(a), Math.abs(b))
  return scale === 0 ? 0 : Math.abs(a - b) / scale
}

/**
 * 基线判定：每一遍都和第一遍比跳帧比例、渲染耗时 P50/P95，相对差都不超过容差才算稳定。
 * 跳帧比例另允许相差一帧（几乎不跳帧时一帧之差的相对差没有意义）。
 */
function baselineVerdict(runs, tolerance = 0.05) {
  const metrics = [
    ['droppedRatio', run => run.droppedRatio, run => 1 / run.expectedFrames],
    ['renderMs.p50', run => run.renderMs?.p50],
    ['renderMs.p95', run => run.renderMs?.p95],
  ]
  const checks = []
  for (let index = 1; index < runs.length; index++) {
    for (const [metric, read, allowance] of metrics) {
      const values = [read(runs[0]), read(runs[index])]
      if (!values.every(Number.isFinite)) { checks.push({ metric, rounds: [0, index], values, ok: false, reason: '缺少样本' }); continue }
      const difference = relativeDifference(values[0], values[1])
      const slack = allowance ? Math.max(allowance(runs[0]), allowance(runs[index])) : 0
      checks.push({ metric, rounds: [0, index], values, relativeDifference: Math.round(difference * 10000) / 10000, ok: difference <= tolerance || Math.abs(values[0] - values[1]) <= slack + 1e-12 })
    }
  }
  return { stable: runs.length >= 2 && checks.every(check => check.ok), tolerance, checks }
}

/** 只给渲染 Worker 的初始化加诊断开关、给画面请求盖上发出时刻；不替换解码、渲染、计时或消息本身。 */
function installDiagnosticsWorker() {
  const NativeWorker = window.Worker
  window.__benchVideoEditInits = 0
  window.Worker = class BenchVideoEditWorker extends NativeWorker {
    constructor(url, options) { super(url, options); this.__benchVideoEdit = String(url).includes('videoEditWorker') }
    postMessage(message, transfer) {
      if (this.__benchVideoEdit && message && typeof message === 'object') {
        if (message.kind === 'init') { message = { ...message, diagnostics: true }; window.__benchVideoEditInits++ }
        else if (message.kind === 'render') message = { ...message, sentAt: performance.timeOrigin + performance.now() }
      }
      return transfer === undefined ? super.postMessage(message) : super.postMessage(message, transfer)
    }
  }
}

function sequenceEnd(sequence) {
  return Math.max(0, ...sequence.clips.map(clip => clip.start + clip.duration))
}

async function main(options) {
  const { assertBuildFreshness, launchElectronApp, waitForApp } = require('./lib/electronLaunch.cjs')
  // 先于复制工程、生成夹具检查：产物比源码旧，量到的是上一次构建的播放。
  assertBuildFreshness(MAIN_ENTRY)
  const { assignIsolatedMcpPort, authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./lib/uiInspectionMcpClient.cjs')
  const { openVideoEditProjectCard, readVideoEditFile, seedVideoEditProject } = require('./lib/uiInspectionVideoEditDocuments.cjs')
  const { presented } = require('./lib/uiInspectionSceneVideoEditMonitor.cjs')
  const { startGpuSampler } = require('./lib/uiInspectionGpuSampler.cjs')
  const { statistics } = require('./lib/uiInspectionSceneVideoEditCodePerformance.cjs')
  const { PERFORMANCE_GENERATOR } = require('./lib/uiInspectionAuthorSources.cjs')
  const { benchProject, ensureBenchRecording } = require('../tests/fixtures/bench/video-edit/fixture.cjs')

  const startedAt = new Date().toISOString()
  const result = { bench: 'video-edit-playback', startedAt, options: { ...options, out: undefined }, completed: false }
  fs.mkdirSync(options.out, { recursive: true })
  const outFile = path.join(options.out, `${startedAt.replace(/[:.]/g, '-')}.json`)
  const save = () => fs.writeFileSync(outFile, JSON.stringify(result, null, 2))

  // 真实工程只读复制到自己的临时目录，测完删掉；原工程不动。
  let copyRoot = null
  let projectFolder = null
  if (options.project) {
    if (!fs.existsSync(options.project)) throw new Error(`工程不存在：${options.project}`)
    const source = findProjectRoot(options.project)
    copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-bench-project-'))
    projectFolder = path.join(copyRoot, path.basename(source))
    fs.cpSync(source, projectFolder, { recursive: true })
  }
  const recording = options.project ? null : ensureBenchRecording()

  const launched = await launchElectronApp({ mainEntry: MAIN_ENTRY, cwd: ROOT, isolateUserData: true, useElectronApi: true, skipOnboarding: true })
  const { app, page } = launched
  let client
  let browserWindow
  try {
    await waitForApp(page)
    if (!await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA))) throw new Error('基准台只允许隔离资料目录')
    if (options.diagnostics) {
      // 渲染 Worker 在进入剪辑页时就会建好（空闲节目会话），必须在应用代码运行前装上。
      await page.addInitScript(installDiagnosticsWorker)
      await page.reload()
      await waitForApp(page)
    }
    browserWindow = await app.browserWindow(page)
    await browserWindow.evaluate(win => win.webContents.setBackgroundThrottling(false))
    result.runtime = await app.evaluate(async ({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: await app.getGPUInfo('basic') }))

    await assignIsolatedMcpPort(page)
    const identity = await authorizeMcpConnection(page, { name: '播放基准台' })
    client = await connectMcpClient(identity.config, 'Henji video edit bench')
    const change = async (ref, entry, summary) => {
      const read = await callTool(client, 'read_application_entity', { ref })
      const changed = await callTool(client, 'change_application_entities', operationEnvelope([read], { summary, changes: [entry] }))
      if (changed.executionState !== 'completed') throw new Error(`${summary}失败：${JSON.stringify(changed)}`)
    }

    let documentId
    let file
    if (projectFolder) {
      const project = await page.evaluate(folder => window.henjiNative.documents.registerExternalProject(folder), projectFolder)
      documentId = options.document ?? project.mainVideoEditId
      if (!documentId) throw new Error('工程没有主剪辑，请用 --document 指定剪辑文档 ID')
      const documents = await page.evaluate(() => window.henjiNative.documents.listDocuments({ kind: 'video_edit', includeDrafts: true, includeMissing: false }))
      file = documents.find(item => item.id === documentId)?.path
      if (!file) throw new Error(`复制的工程里找不到剪辑文档：${documentId}`)
      await openVideoEditProjectCard(page, project.id)
      result.project = { source: options.project, copiedTo: projectFolder, documentId }
    } else {
      const seeded = await seedVideoEditProject(page, benchProject(recording), { projectName: '播放基准' })
      documentId = seeded.documentId; file = seeded.file
      await openVideoEditProjectCard(page, seeded.projectId)
      const documentRef = { kind: 'video_edit.document', id: documentId }
      await change(documentRef, { kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.source': PERFORMANCE_GENERATOR } }] }, '添加基准代码素材')
      let item
      for (let attempt = 0; attempt < 100 && !item; attempt++) { item = readVideoEditFile(file).items.find(entry => entry.kind === 'code'); if (!item) await page.waitForTimeout(100) }
      if (!item) throw new Error('基准代码素材没有保存')
      const sequenceRef = { kind: 'video_edit.sequence', id: `${documentId}:main` }
      await change(sequenceRef, { kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.kind': 'code', 'video_edit.clip.name': '持续动态标题条', 'video_edit.clip.track': 2, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 600 } }] }, '添加基准代码片段')
      result.project = { source: 'fixture', recording: path.relative(ROOT, recording), documentId }
    }

    const documentRef = { kind: 'video_edit.document', id: documentId }
    await change(documentRef, { kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.render_preference': { autoRender: false } } }, '关闭自动预渲染')
    await change(documentRef, { kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.playback_resolution': { resolution: 'full', fullWhenPaused: true } } }, '完整分辨率播放')
    const active = (await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.active_sequence_id'] })).data.properties['video_edit.document.active_sequence_id']
    const sequence = readVideoEditFile(file).sequences.find(entry => entry.id === active) ?? readVideoEditFile(file).sequences[0]
    const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
    const end = sequenceEnd(sequence)
    const to = Math.min(options.to ?? end, end)
    if (to <= options.from) throw new Error(`播放区间为空：序列只有 ${end} 帧`)
    Object.assign(result.project, { sequenceId: sequence.id, width: sequence.width, height: sequence.height, fps, from: options.from, to })
    save()

    const playback = (frame, playing) => change(documentRef, { kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { frame, playing, playbackDirection: 1 } } }, playing ? '起播' : '定位')
    const queryEvents = async (after, keyword) => (await page.evaluate(async ({ after, keyword }) => (await window.henjiNative.logging.queryLogEvents({ date: after.slice(0, 10), afterTimestamp: after, keyword, level: 'info', limit: 20 })).events, { after, keyword }))
      .filter(event => event.event === keyword)
    const pass = async (label, round) => {
      await playback(options.from, false); await presented(page, options.from)
      await page.waitForTimeout(1500)
      const gpu = []
      const stopSampler = await startGpuSampler({ onReading: reading => gpu.push(reading.values.split(',').map(Number)), onError: () => {} }).catch(() => async () => {})
      const after = new Date().toISOString()
      await playback(options.from, true)
      // 播到区间末尾（序列末尾时节目会自己停）；轮询间隔放宽，不给被测的渲染层添负担。
      await page.waitForFunction(last => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) >= last, to - 1, { timeout: Math.max(60000, (to - options.from) / fps * 3000), polling: 250 })
      await playback(to - 1, false)
      await stopSampler()
      // 前端日志按批写入；停播后 Worker 的迟滞汇总也稍晚才到。
      let stats, lag
      for (let attempt = 0; attempt < 50 && (!stats || options.diagnostics && !lag); attempt++) {
        if (attempt) await page.waitForTimeout(200)
        // 中途被打断时会多出一段“restarted”的短记录，取覆盖帧数最多的那条。
        stats ??= (await queryEvents(after, STATS_EVENT)).filter(event => event.context?.sequenceId === sequence.id).sort((a, b) => b.context.expectedFrames - a.context.expectedFrames)[0]?.context
        if (options.diagnostics) lag ??= (await queryEvents(after, LAG_EVENT)).find(event => event.context?.sequenceId === sequence.id)?.context
      }
      if (!stats) throw new Error(`${label}：没有读到 ${STATS_EVENT} 日志`)
      if (options.diagnostics) lag ??= null
      const column = index => statistics(gpu.map(values => values[index]))
      return { label, round, ...stats, gpuLoad: { utilization: column(0), decoder: column(1), memoryUsedMb: column(2) }, ...(lag !== undefined ? { workerLag: lag } : {}) }
    }

    result.warmup = []
    for (let round = 0; round < options.warmup; round++) { result.warmup.push(await pass('预热', round)); save() }
    result.runs = []
    for (let round = 0; round < options.rounds; round++) { result.runs.push(await pass('正式', round)); save() }
    if (options.diagnostics) result.diagnosticInits = await page.evaluate(() => window.__benchVideoEditInits)
    result.baseline = baselineVerdict(result.runs, options.tolerance)
    result.completed = true
  } finally {
    result.finishedAt = new Date().toISOString()
    save()
    if (client) { await client.close().catch(() => {}); await disableMcp(page).catch(() => {}) }
    await browserWindow?.dispose().catch(() => {})
    await launched.close()
    if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
  }
  return { result, outFile }
}

module.exports = { parseArgs, baselineVerdict, findProjectRoot }

if (require.main === module) {
  let options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) { console.error(`[bench:video-edit] ${error.message}\n\n${HELP}`); process.exit(1) }
  if (options.help) { console.log(HELP); process.exit(0) }
  main(options).then(({ result, outFile }) => {
    console.log(JSON.stringify(result, null, 2))
    console.error(`[bench:video-edit] 结果：${outFile}；${result.baseline.stable ? '两遍误差在容差内，可作基线' : '两遍误差超出容差，不能作基线'}`)
  }, error => { console.error(`[bench:video-edit] 失败：${error.stack ?? error}`); process.exit(1) })
}
