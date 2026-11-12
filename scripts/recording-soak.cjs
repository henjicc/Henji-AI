#!/usr/bin/env node
'use strict'

/**
 * 无人值守长录测试：接管已经在运行的痕迹AI，自己开始录制、按墙钟时间表施压、停止、核对，
 * 把结论写进 tickets/46-正式使用链路/长录结果/<时间戳>-<场景>/（result.json、summary.md、soak.log）。
 *
 * 先启动正式构建并打开调试端口（另一个终端，PowerShell）：
 *   npm run build:audio-capture; npm run electron:bundle      # 需要新产物时
 *   $env:HENJI_ELECTRON_REMOTE_DEBUGGING_PORT=9334; npm run electron:prod -- --dev-skip-onboarding --skip-build
 *
 * 再运行（耗时等于录制时长，建议后台跑）：
 *   npm run test:recording-soak -- --scenario audio            # 录音，默认 60 分钟
 *   npm run test:recording-soak -- --scenario screen           # 录屏，默认 30 分钟
 *   npm run test:recording-soak -- --scenario audio --smoke    # 3 分钟冒烟档，先验证脚本本身
 *
 * 参数：
 *   --minutes <1–120>       录制时长（--smoke 固定 3 分钟）
 *   --port <9334>           远程调试端口
 *   --project <长录测试>    产物放进的项目，不存在就新建；不碰其他项目与作品
 *   --out <目录>            结果目录（默认见上）
 *   录屏专用：
 *   --source <id|名称片段>  录制来源（默认主显示器整屏）；id 形如 screen:0:0、window:123:0
 *   --width 3840 --height 2160 --fps 60
 *   --no-microphone / --no-system-audio   默认带麦克风与系统声
 *   --kill-encoder          中途结束一次画面编码进程，验证自动续录
 *   --no-cursor             不移动鼠标做事件对齐抽查（默认会在几个时刻把光标移到主屏中心附近再放回）
 *   通用：
 *   --crash-renderer        另外让界面渲染进程崩溃一次（CDP Page.crash），验证崩溃后接管
 *   --load-seconds <20>     主进程加压时长（冒烟档按时长缩短）
 *
 * 时间表见 scripts/lib/recordingSoak.cjs 的 PLANS；退出码 0 = 通过，1 = 有问题，2 = 没能开始。
 * 产物不自动删除，占用大小与路径写在结果里。Ctrl+C 会先停止录制、写完结果再退出。
 */

const fs = require('node:fs')
const path = require('node:path')
const lib = require('./lib/recordingSoak.cjs')
const { AppDriver, directorySize, MCP_CONNECTION_NAME, os, probe, sceneChanges } = require('./lib/recordingSoakDriver.cjs')

const ROOT = path.resolve(__dirname, '..')
const RESULTS = path.join(ROOT, 'tickets', '46-正式使用链路', '长录结果')
const SEED_SECONDS = 0.5
const CURSOR_HOLD_MS = 400
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 写死的已知缺口：现有应用没有安全的入口，脚本用近似办法或跳过。 */
const KNOWN_GAPS = [
  '主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢',
  '窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口',
  '音频编辑录音没有开始/停止的正式能力（有意不开放），脚本走界面按钮与标题栏停止；录音会话 ID 从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态',
  'powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证',
]

async function main() {
  let options
  try { options = lib.parseSoakArgs(process.argv.slice(2)) } catch (error) {
    console.error(error.message)
    console.error('用法见 scripts/recording-soak.cjs 文件头')
    process.exit(2)
  }
  if (options.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); return }

  // 先确认应用在运行，再建结果目录：没开应用时只说明怎么启动，不留空目录。
  const probeDriver = new AppDriver({ port: options.port, log: () => {} })
  try { await probeDriver.connect() } catch (error) { console.error(error.message); process.exit(2) } finally { await probeDriver.browser?.close().catch(() => {}) }

  const dir = options.out ? path.resolve(options.out) : path.join(RESULTS, `${lib.timestampName()}-${options.scenario}`)
  fs.mkdirSync(dir, { recursive: true })
  const logFile = path.join(dir, 'soak.log')
  const log = message => { const line = `${new Date().toISOString()} ${message}`; console.log(line); fs.appendFileSync(logFile, `${line}\n`) }
  const durationSec = options.minutes * 60
  const result = {
    version: 1, scenario: options.scenario, options, resultDir: dir, startedAt: new Date().toISOString(),
    plan: lib.planSchedule(options.scenario, durationSec, options), steps: [], heartbeats: [], memory: [], power: {}, logs: {}, checks: {}, storage: {},
    recording: {}, missingInterfaces: [...KNOWN_GAPS],
  }
  const persist = () => {
    const file = path.join(dir, 'result.json')
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(result, null, 2)); fs.renameSync(`${file}.tmp`, file)
  }
  let aborted = false
  process.on('SIGINT', () => { if (aborted) process.exit(130); aborted = true; log('收到中断：停止录制并写完结果后退出（再按一次强制退出）') })

  const driver = new AppDriver({ port: options.port, log })
  const ctx = { options, durationSec, dir, log, result, persist, driver, aborted: () => aborted, stopped: false, recordingActive: false }
  log(`场景 ${options.scenario}，录制 ${options.minutes} 分钟，结果目录 ${dir}`)
  try {
    result.app = await driver.connect()
    result.app.dev = /^https?:\/\/localhost:/.test(result.app.url)
    if (result.app.dev) log('注意：连接的是开发版（热更新），正式验收应使用 electron:prod')
    result.app.mainPid = await driver.mainPid()
    const processes = await os.processes()
    const main = processes.find(item => item.ProcessId === result.app.mainPid)
    result.app.executable = main?.ExecutablePath ?? null
    result.memory.push(lib.memorySample(processes, result.app.mainPid, 'before-start', Date.now()))
    result.mcp = await driver.connectMcp()
    persist()
    const scenario = options.scenario === 'audio' ? audioScenario(ctx) : screenScenario(ctx)
    await scenario.prepare()
    persist()
    await scenario.start()
    ctx.recordingActive = true
    result.recording.startedAtMs = Date.now()
    log('录制已开始')
    await sampleMemory(ctx, 'start')
    persist()
    const intervals = lib.periodicIntervals(durationSec)
    let previous = null
    // 每个动作结束时由 onProgress 写进 result.steps 并落盘，中途失败也留得下。
    await lib.runSchedule({
      plan: result.plan, startedAtMs: result.recording.startedAtMs, now: Date.now, sleep, shouldAbort: ctx.aborted,
      periodic: [
        { name: 'heartbeat', everySec: intervals.heartbeatSec, run: async () => {
          const state = { atMs: Date.now(), ...await scenario.alive() }
          if (previous?.alive && state.alive && state.atMs - previous.atMs > 5000 && !(state.durationSeconds > previous.durationSeconds)) state.stalled = true
          result.heartbeats.push(state); previous = state
          if (!state.alive || state.stalled) log(`存活检查：录制${state.alive ? '时长没有前进' : `不在进行（${state.reason ?? ''}）`}`)
          persist()
        } },
        { name: 'memory', everySec: intervals.memorySec, run: () => sampleMemory(ctx, 'periodic') },
      ],
      execute: async item => {
        log(`执行 ${item.action}（计划第 ${item.atSec} 秒）`)
        if (item.action === 'stop') return scenario.stop()
        const handler = scenario.actions[item.action] ?? commonActions(ctx, scenario)[item.action]
        if (!handler) return { ok: false, reason: `未知动作 ${item.action}` }
        return handler(item.params ?? {}, item)
      },
      onProgress: event => {
        if (event.kind === 'action') { result.steps.push(event.record); log(`${event.record.action} ${event.record.ok ? '完成' : `失败：${String(event.record.error ?? event.record.details?.reason ?? '').split('\n')[0]}`}`) }
        else log(`周期任务 ${event.name} 失败：${event.error}`)
        persist()
      },
    })
    if (!ctx.stopped) await scenario.stop().then(details => result.steps.push({ action: 'stop', scheduledSec: (Date.now() - result.recording.startedAtMs) / 1000, ok: true, details, note: '中断后补停' }))
    await scenario.verify()
  } catch (error) {
    result.fatal = String(error?.message ?? error)
    log(`失败：${error?.stack ?? error}`)
  } finally {
    await finish(ctx)
  }
}

/** 收尾：录制还开着就停下，读日志、防睡眠、内存与占用，写结论。每一步都单独兜底。 */
async function finish(ctx) {
  const { result, log, driver, options } = ctx
  const attempt = async (label, fn) => { try { await fn() } catch (error) { log(`${label}失败：${error?.message ?? error}`); (result.collectionErrors ??= []).push(`${label}：${String(error?.message ?? error)}`) } }
  if (ctx.recordingActive && !ctx.stopped && ctx.scenario) await attempt('补停录制', () => ctx.scenario.stop())
  if (result.recording.stoppedAtMs) {
    await sleep(5000)
    await attempt('结束后防睡眠检查', async () => { result.power.after = await powerCheck(ctx) })
    await attempt('结束后内存采样', () => sampleMemory(ctx, 'after-stop'))
  }
  if (result.recording.startedAtMs) await attempt('读取日志', () => collectLogs(ctx))
  if (ctx.scenario && result.recording.stoppedAtMs && !result.checks.summary) await attempt('读取结束汇总', () => ctx.scenario.verify())
  await attempt('统计产物占用', () => measureStorage(ctx))
  result.endedAt = new Date().toISOString()
  result.verdict = lib.evaluateSoak(result)
  ctx.persist()
  fs.writeFileSync(path.join(ctx.dir, 'summary.md'), lib.renderSoakMarkdown(result))
  await driver.close()
  log(`结论：${result.verdict.passed ? '通过' : `有问题（${result.verdict.problems.length} 项）`}；结果在 ${ctx.dir}`)
  if (!result.verdict.passed) for (const problem of result.verdict.problems) log(`  - ${problem}`)
  if (options.scenario && result.mcp?.connectionId && driver.connectionId) log(`外部连接「${MCP_CONNECTION_NAME}」没能撤销，请在设置 › 外部连接里手动撤销`)
  process.exitCode = result.verdict.passed ? 0 : 1
}

async function sampleMemory(ctx, label) {
  const sample = lib.memorySample(await os.processes(), ctx.result.app.mainPid, label, Date.now())
  ctx.result.memory.push(sample)
  ctx.persist()
  return sample
}

async function powerCheck(ctx) {
  const output = await os.powerRequests()
  const parsed = lib.parsePowercfgRequests(output.text)
  if (!parsed.available) return { available: false, atMs: Date.now(), error: output.error ?? '没有输出（需要管理员权限）' }
  // powercfg 用 \Device\HarddiskVolumeN\… 表示路径，用去掉盘符的路径尾部比对，免得把别的 Electron 应用算进来。
  const executable = ctx.result.app.executable
  const tail = executable ? executable.replace(/^[A-Za-z]:/, '') : null
  return { available: true, atMs: Date.now(), hits: lib.powerRequestsFor(parsed, [tail]), sections: parsed.sections }
}

async function collectLogs(ctx) {
  const { result, driver } = ctx
  const since = result.recording.prepareAtMs ?? result.recording.startedAtMs
  const sinceIso = new Date(since - 5000).toISOString()
  const dates = lib.utcDatesBetween(since - 5000, Date.now())
  const warnings = await driver.queryLogs({ sinceIso, dates, level: 'warn' })
  const errors = await driver.queryLogs({ sinceIso, dates, level: 'error' })
  const families = ctx.options.scenario === 'audio' ? ['audio_capture', 'recording_power', 'audio_edit.splice'] : ['recording', 'audio_capture']
  const seen = new Set(), events = []
  for (const keyword of families) {
    for (const event of (await driver.queryLogs({ sinceIso, dates, keyword })).events) {
      const key = `${event.timestamp}|${event.event}|${event.message}`
      if (seen.has(key) || !/^(audio_capture|recording|recording_power|audio_edit\.splice)\./.test(event.event ?? '')) continue
      seen.add(key); events.push(event)
    }
  }
  const byTime = (a, b) => a.timestamp.localeCompare(b.timestamp)
  result.logs = {
    sinceIso, warnings: warnings.events.sort(byTime), errors: errors.events.sort(byTime), events: events.sort(byTime),
    corruptedLines: warnings.corrupted + errors.corrupted, summary: lib.summarizeLogs([...warnings.events, ...errors.events]),
  }
  ctx.persist()
}

async function measureStorage(ctx) {
  const dirs = [...new Set(ctx.storageDirs ?? [])].filter(dir => fs.existsSync(dir))
  const paths = []
  for (const dir of dirs) paths.push({ path: dir, bytes: await directorySize(dir) })
  ctx.result.storage = { paths, totalBytes: paths.reduce((sum, entry) => sum + entry.bytes, 0) }
}

async function ensureProject(ctx) {
  const { driver, options, result } = ctx
  const listed = await driver.call('list_projects', { includeDrafts: false }, { retryMs: 30_000 })
  const existing = listed.projects.find(project => project.name === options.project)
  const id = existing ? existing.ref.id : (await driver.call('create_project', { name: options.project }, { write: true })).resultRef.id
  result.project = { id, name: options.project, created: !existing }
  return id
}

/** 两个场景共用的施压动作；每个动作前后各查一次录制是否仍在进行。 */
function commonActions(ctx, scenario) {
  const { driver, result, log } = ctx
  const around = async (body, settleMs = 3000) => {
    const before = await scenario.alive()
    const details = (await body()) ?? {}
    await sleep(settleMs)
    const after = await scenario.alive()
    return { ...details, before, after, ok: details.ok !== false }
  }
  return {
    'wake-lock': () => around(async () => {
      result.power.during = await powerCheck(ctx)
      return { power: { available: result.power.during.available, hits: result.power.during.hits, error: result.power.during.error } }
    }, 0),
    'switch-away': ({ workspaceId }) => around(async () => {
      await scenario.mark?.(`switch-${workspaceId}`)
      const atMs = Date.now()
      await driver.call('switch_workspace', { workspaceId }, { write: true, retryMs: 30_000 })
      ;(ctx.switches ??= []).push({ workspaceId, atMs })
      return { workspaceId, ...(await scenario.afterSwitchAway?.() ?? {}) }
    }),
    minimize: () => around(async () => {
      await driver.evaluate(() => window.henjiNative.window.minimize())
      await sleep(1500)
      const windows = await os.windows(result.app.mainPid)
      const minimized = windows.some(window => window.minimized)
      return { windows, ok: minimized, ...(minimized ? {} : { reason: '主窗口没有进入最小化' }) }
    }),
    restore: () => around(async () => {
      const restored = await os.restoreWindows(result.app.mainPid)
      await sleep(2000)
      const windows = await os.windows(result.app.mainPid)
      const still = windows.filter(window => window.minimized)
      return { restored, windows, ok: still.length === 0, ...(still.length ? { reason: '还有窗口停在最小化' } : {}) }
    }),
    'main-load': () => around(async () => {
      const seconds = lib.loadSecondsFor(ctx.durationSec, ctx.options.loadSeconds)
      const now = Date.now()
      const dates = [new Date(now).toISOString().slice(0, 10), new Date(now - 86_400_000).toISOString().slice(0, 10)]
      const load = await driver.evaluate(async ({ seconds, dates }) => {
        const api = window.henjiNative
        const ping = async () => { const at = performance.now(); await api.diagnostics.ping(); return performance.now() - at }
        const stats = list => { const sorted = [...list].sort((a, b) => a - b); return { count: sorted.length, p50: sorted[Math.floor(sorted.length / 2)] ?? null, p95: sorted[Math.floor(sorted.length * 0.95)] ?? null, max: sorted.at(-1) ?? null } }
        const baseline = []
        for (let index = 0; index < 10; index++) { baseline.push(await ping()); await new Promise(resolve => setTimeout(resolve, 100)) }
        const end = Date.now() + seconds * 1000
        let queries = 0, errors = 0
        const during = []
        // 每次查询都在主进程里把整天日志逐行解析一遍、关键字不命中，返回很小；6 路并发让主进程持续忙。
        const worker = async index => { while (Date.now() < end) { try { await api.logging.queryLogEvents({ date: dates[index % dates.length], keyword: 'recording-soak-no-match-7f3a', limit: 1 }); queries++ } catch { errors++ } } }
        const pinger = async () => { while (Date.now() < end) { during.push(await ping()); await new Promise(resolve => setTimeout(resolve, 200)) } }
        await Promise.all([...Array.from({ length: 6 }, (_, index) => worker(index)), pinger()])
        return { seconds, queries, errors, baselinePingMs: stats(baseline), loadPingMs: stats(during) }
      }, { seconds, dates })
      const notes = (load.loadPingMs.max ?? 0) < 50 ? [`加压期间主进程 ping 最长只有 ${Math.round(load.loadPingMs.max ?? 0)} ms，压力不明显（当天日志可能很小）`] : []
      log(`主进程加压 ${seconds} 秒：查询 ${load.queries} 次，ping p50 ${Math.round(load.loadPingMs.p50 ?? 0)} ms、最长 ${Math.round(load.loadPingMs.max ?? 0)} ms（平时 ${Math.round(load.baselinePingMs.p50 ?? 0)} ms）`)
      return { load, notes }
    }),
    reload: () => around(async () => {
      const atMs = Date.now()
      await driver.reloadPage()
      const reattach = await scenario.afterReload?.(atMs) ?? {}
      return { reloadedInMs: Date.now() - atMs, ...reattach }
    }, 5000),
    'crash-renderer': () => around(async () => {
      const atMs = Date.now()
      await driver.crashRenderer()
      await sleep(3000)
      let autoReloaded = true
      try { await driver.page({ timeoutMs: 60_000 }) } catch {
        autoReloaded = false
        log('崩溃后界面没有自动重载，改为手动重载')
        await driver.reloadPage()
      }
      const reattach = await scenario.afterReload?.(atMs) ?? {}
      return { autoReloaded, recoveredInMs: Date.now() - atMs, ...reattach, notes: autoReloaded ? [] : ['渲染进程崩溃后应用没有自动重载界面'] }
    }, 5000),
    status: ({ memoryLabel }) => around(async () => {
      const status = await scenario.status()
      if (memoryLabel) await sampleMemory(ctx, memoryLabel)
      return { status }
    }, 0),
  }
}

/** 录音：音频编辑里点“开始录音”，期间切页、最小化、加压、重载，最后从标题栏停止并等拼回作品。 */
function audioScenario(ctx) {
  const { driver, result, log } = ctx
  const recordingRef = { kind: 'audio_capture.settings', id: 'singleton' }
  const state = { documentId: null, sessionId: null, status: null }
  const ui = () => driver.evaluate(() => {
    const visible = element => Boolean(element && element.getClientRects().length)
    const indicator = document.querySelector('[role="status"][aria-label="正在录音"]')
    const page = [...document.querySelectorAll('[data-capture-phase]')].find(visible)
    return { indicator: visible(indicator), time: indicator?.querySelector('[aria-label="已录时长"]')?.textContent ?? null, pagePhase: page?.getAttribute('data-capture-phase') ?? null }
  })
  const uiRecording = value => value.indicator || value.pagePhase === 'recording'
  const waitUi = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    let last
    while (Date.now() < deadline) { last = await ui().catch(() => null); if (last && predicate(last)) return { ok: true, ui: last }; await sleep(500) }
    return { ok: false, ui: last }
  }
  const scenario = {
    async prepare() {
      const props = await driver.readEntity(recordingRef, ['audio_capture.settings.recording'])
      const current = props?.['audio_capture.settings.recording']?.value ?? props?.['audio_capture.settings.recording']
      if (current?.phase === 'recording' || current?.phase === 'paused') throw new Error('已经有一段音频编辑录音在进行，先结束它再跑')
      const projectId = await ensureProject(ctx)
      const seed = path.join(ctx.dir, 'seed.wav')
      fs.writeFileSync(seed, lib.silentWav(48000, SEED_SECONDS))
      const name = `长录 ${lib.timestampName()}`
      const created = await driver.call('create_document', { kind: 'audio_edit', name, projectId }, { write: true })
      state.documentId = created.resultRef.id
      result.document = { id: state.documentId, name }
      await driver.call('import_audio_edit_source', { documentRef: { kind: 'audio_edit.document', id: state.documentId }, sourcePath: seed }, { write: true })
      const before = await driver.evaluate(id => window.henjiNative.documents.readDocument({ id }), state.documentId)
      result.document.path = before.meta.path
      ;(ctx.storageDirs ??= []).push(path.dirname(before.meta.path))
      await driver.call('open_document', { documentId: state.documentId }, { write: true, retryMs: 30_000 })
      log(`已建作品「${name}」并在音频编辑里打开`)
    },
    async start() {
      const page = await driver.page()
      result.recording.prepareAtMs = Date.now()
      await page.getByRole('button', { name: '开始录音', exact: true }).first().click({ timeout: 60_000 })
      const started = await waitUi(value => value.pagePhase === 'recording', 30_000)
      if (!started.ok) throw new Error(`点了开始录音，30 秒内没有进入录音：${JSON.stringify(started.ui)}`)
      // 录音会话 ID 只在主进程日志里：用它读主进程真实状态，界面重载期间也查得到。
      const deadline = Date.now() + 20_000
      while (!state.sessionId && Date.now() < deadline) {
        const found = await driver.queryLogs({ sinceIso: new Date(result.recording.prepareAtMs - 2000).toISOString(), dates: lib.utcDatesBetween(result.recording.prepareAtMs - 2000, Date.now()), keyword: 'audio_capture.recording.start' })
        state.sessionId = found.events.find(event => event.event === 'audio_capture.recording.start' && event.context?.mode === 'exclusive')?.context?.sessionId ?? null
        if (!state.sessionId) await sleep(1000)
      }
      if (!state.sessionId) result.missingInterfaces.push('没能从日志取到录音会话 ID，存活检查只能读界面状态')
      result.recording.sessionId = state.sessionId
      if (state.sessionId) {
        state.status = await driver.evaluate(id => window.henjiNative.audioCapture.status(id), state.sessionId)
        result.recording.outputPath = state.status.outputPath
        result.recording.sampleRate = state.status.sampleRate
        // 原始录音所在目录还放着别的录音，只统计这一个文件。
        ;(ctx.storageDirs ??= []).push(state.status.outputPath)
      }
    },
    async alive() {
      if (!state.sessionId) {
        const props = await driver.readEntity(recordingRef, ['audio_capture.settings.recording']).catch(error => ({ error }))
        const value = props?.['audio_capture.settings.recording']
        const recording = value?.value ?? value
        return { alive: recording?.phase === 'recording', durationSeconds: recording?.durationSeconds ?? null, via: 'ui', reason: props?.error ? String(props.error.message) : recording?.phase }
      }
      try {
        const status = await driver.evaluate(id => window.henjiNative.audioCapture.status(id), state.sessionId)
        return { alive: status.state === 'recording', durationSeconds: status.durationSeconds, health: status.health, via: 'main', ...(status.state === 'recording' ? {} : { reason: status.state }) }
      } catch (error) { return { alive: false, via: 'main', reason: String(error?.message ?? error).split('\n')[0] } }
    },
    async status() {
      const main = await scenario.alive()
      const props = await driver.readEntity(recordingRef, ['audio_capture.settings.recording']).catch(error => ({ error: String(error.message) }))
      return { main, ui: await ui().catch(() => null), entity: props }
    },
    async afterSwitchAway() {
      const first = await waitUi(value => value.indicator, 10_000)
      await sleep(2500)
      const second = await ui().catch(() => null)
      const advancing = Boolean(first.ui?.time && second?.time && second.time !== first.ui.time)
      return { indicator: first.ok, times: [first.ui?.time ?? null, second?.time ?? null], ok: first.ok && advancing, ...(first.ok && advancing ? {} : { reason: first.ok ? '标题栏录音时长没有走' : '切走后标题栏没有显示录音指示' }) }
    },
    async afterReload() {
      const back = await waitUi(uiRecording, 45_000)
      return { reattached: back.ok, ui: back.ui, ok: back.ok, ...(back.ok ? {} : { reason: '重载后 45 秒内界面没有接管录音（标题栏和音频编辑都不显示）' }) }
    },
    actions: {
      'switch-back': async () => {
        const before = await scenario.alive()
        await driver.call('select_toolbox_tool', { toolId: 'audioEdit' }, { write: true, retryMs: 30_000 })
        const back = await waitUi(value => value.pagePhase === 'recording' && !value.indicator, 15_000)
        await sleep(2000)
        const after = await scenario.alive()
        return { before, after, ui: back.ui, ok: back.ok, ...(back.ok ? {} : { reason: '回到音频编辑后页面没有显示录音中，或标题栏指示没有消失' }) }
      },
    },
    /** 不回音频编辑，直接点标题栏的停止；标题栏找不到时退回音频编辑页面里的按钮。 */
    async stop() {
      if (ctx.stopped) return { alreadyStopped: true }
      const before = await scenario.alive()
      await sampleMemory(ctx, 'end').catch(() => {})
      const page = await driver.page()
      let via = 'title-bar'
      const titleStop = page.getByRole('status', { name: '正在录音' }).getByRole('button', { name: '停止录音', exact: true })
      result.recording.stopRequestedAtMs = Date.now()
      if (await titleStop.isVisible().catch(() => false)) await titleStop.click({ timeout: 30_000 })
      else {
        via = 'audio-edit'
        log('标题栏没有录音指示，改从音频编辑停止')
        await driver.call('select_toolbox_tool', { toolId: 'audioEdit' }, { write: true, retryMs: 30_000 }).catch(() => {})
        result.recording.stopRequestedAtMs = Date.now()
        await (await driver.page()).getByRole('button', { name: '停止录音', exact: true }).first().click({ timeout: 30_000 })
      }
      ctx.stopped = true
      result.recording.stoppedAtMs = Date.now()
      result.recording.wallSeconds = (result.recording.stopRequestedAtMs - result.recording.prepareAtMs) / 1000
      result.recording.stopVia = via
      log(`已从${via === 'title-bar' ? '标题栏' : '音频编辑'}停止，等待拼回作品`)
      return { via, before, ok: true }
    },
    async verify() {
      if (!result.recording.stoppedAtMs) return
      const deadline = Date.now() + 10 * 60_000
      let take = { spliced: false, reason: '10 分钟内没有拼回作品' }
      while (Date.now() < deadline) {
        const document = await driver.evaluate(id => window.henjiNative.documents.readDocument({ id }), state.documentId).catch(() => null)
        const source = document?.content?.source
        const seconds = source ? source.durationFrames / source.sampleRate : 0
        if (source && seconds > SEED_SECONDS + 0.5) {
          take = { spliced: true, insertedSeconds: seconds - SEED_SECONDS, totalSeconds: seconds, sampleRate: source.sampleRate, channels: source.channels, sourcePath: source.sourcePath, audioPath: source.audioPath }
          break
        }
        await sleep(2000)
      }
      result.checks.take = take
      const summaries = (await driver.queryLogs({ sinceIso: new Date(result.recording.prepareAtMs - 2000).toISOString(), dates: lib.utcDatesBetween(result.recording.prepareAtMs - 2000, Date.now()), keyword: 'audio_capture.recording.summary' })).events
      result.checks.summary = summaries.find(event => event.event === 'audio_capture.recording.summary' && (!state.sessionId || event.context?.sessionId === state.sessionId))?.context ?? null
      const files = []
      if (take.audioPath) files.push({ role: '作品音频', path: take.audioPath, required: true, probe: await probe(take.audioPath) })
      if (result.recording.outputPath) files.push({ role: '原始录音', path: result.recording.outputPath, required: false, probe: await probe(result.recording.outputPath) })
      result.checks.files = files
      result.checks.pendingFiles = await driver.evaluate(() => window.henjiNative.audioCapture.pendingFiles()).catch(error => ({ error: String(error.message) }))
      if (take.audioPath) (ctx.storageDirs ??= []).push(take.audioPath)
      ctx.persist()
    },
  }
  ctx.scenario = scenario
  return scenario
}

/** 录屏：正式能力开始整屏或窗口录制（带麦克风与系统声），期间切页、加压、重载、可选结束编码进程，最后正式能力停止。 */
function screenScenario(ctx) {
  const { driver, result, log, options } = ctx
  const state = { sessionRef: null, marks: [], cursorMoves: [], expectedRestarts: 0 }
  const snapshot = () => driver.evaluate(() => window.henjiNative.screenRecording.snapshot())
  const scenario = {
    async prepare() {
      const projectId = await ensureProject(ctx)
      const sources = await driver.evaluate(() => window.henjiNative.screenRecording.sources())
      const wanted = options.source
      const source = wanted ? sources.find(item => item.id === wanted) ?? sources.find(item => item.name.includes(wanted))
        : sources.find(item => item.kind === 'screen' && item.display?.primary) ?? sources.find(item => item.kind === 'screen')
      if (!source) throw new Error(`找不到录制来源 ${wanted ?? '（主显示器）'}；可用：${sources.map(item => `${item.id} ${item.name}`).join('；')}`)
      result.source = { id: source.id, name: source.name, kind: source.kind, display: source.display ?? null }
      const existing = await snapshot()
      if (existing && !['stopped', 'failed'].includes(existing.phase)) throw new Error(`已经有一段录屏在进行（${existing.phase}），先结束它再跑`)
      state.projectId = projectId
    },
    async start() {
      result.recording.prepareAtMs = Date.now()
      const name = `长录 ${lib.timestampName()}`
      const tracks = { ...(options.microphone ? { microphone: {} } : {}), systemAudio: options.systemAudio }
      const started = await driver.call('start_screen_recording', { sourceRef: { kind: 'screen_recording.source', id: result.source.id }, name, width: options.width, height: options.height, fps: options.fps, tracks, projectId: state.projectId }, { write: true, timeoutMs: 120_000 })
      state.sessionRef = started.resultRef
      result.recording.sessionId = state.sessionRef.id
      result.document = { id: state.sessionRef.id, name }
      const deadline = Date.now() + 60_000
      let current
      while (Date.now() < deadline) { current = await snapshot(); if (current?.phase === 'recording') break; if (current?.phase === 'failed') break; await sleep(250) }
      if (current?.phase !== 'recording') throw new Error(`录屏 60 秒内没有进入录制：${JSON.stringify(current)}`)
      result.recording.firstSnapshot = current
    },
    async alive() {
      try {
        const current = await snapshot()
        const alive = current?.phase === 'recording' && current.sessionId === state.sessionRef?.id
        return { alive, durationSeconds: current ? current.elapsedMs / 1000 : null, phase: current?.phase ?? null, warnings: current?.trackWarnings ?? [], ...(alive ? {} : { reason: current ? `${current.phase}${current.error ? `：${current.error}` : ''}` : '没有录制会话' }) }
      } catch (error) { return { alive: false, reason: String(error?.message ?? error).split('\n')[0] } }
    },
    async status() {
      const main = await scenario.alive()
      const entity = await driver.readEntity(state.sessionRef).catch(error => ({ error: String(error.message) }))
      return { main, entity }
    },
    /** 打标记校准时钟：标记事件的 monoUs 与调用前后墙钟的中点对应，误差不超过往返时间的一半。 */
    async mark(note) {
      const label = `soak-${state.marks.length + 1}-${note}`
      const beforeMs = Date.now()
      await driver.call('mark_screen_recording', { sessionRef: state.sessionRef, note: label }, { write: true })
      const mark = { note: label, beforeMs, afterMs: Date.now() }
      state.marks.push(mark)
      return mark
    },
    async afterReload() {
      const deadline = Date.now() + 30_000
      let current
      while (Date.now() < deadline) { current = await scenario.alive(); if (current.alive) break; await sleep(500) }
      return { ok: current?.alive === true, ...(current?.alive ? {} : { reason: '重载后录制不在进行' }) }
    },
    actions: {
      'switch-back': async () => {
        const before = await scenario.alive()
        await driver.call('switch_workspace', { workspaceId: 'tools' }, { write: true, retryMs: 30_000 })
        await sleep(3000)
        return { before, after: await scenario.alive(), ok: true }
      },
      cursor: async (_params, item) => {
        const before = await scenario.alive()
        const mark = await scenario.mark('cursor')
        const move = await os.moveCursor(CURSOR_HOLD_MS)
        state.cursorMoves.push({ scheduledSec: item.atSec, mark, move })
        return { before, after: await scenario.alive(), move, ok: true }
      },
      'kill-encoder': async () => {
        const before = await scenario.alive()
        const tree = lib.descendants(await os.processes(), result.app.mainPid)
        const encoders = tree.filter(process => /ffmpeg/i.test(process.Name ?? '') && /gfxcapture=/.test(process.CommandLine ?? ''))
        if (!encoders.length) return { before, after: before, ok: false, reason: '没有找到画面编码进程（不是 gfxcapture 后端？）' }
        const target = encoders.at(-1)
        const killed = await os.kill(target.ProcessId)
        state.expectedRestarts += 1
        log(`已结束画面编码进程 ${target.ProcessId}`)
        await sleep(15_000)
        const after = await scenario.alive()
        const restarted = lib.descendants(await os.processes(), result.app.mainPid).some(process => /ffmpeg/i.test(process.Name ?? '') && /gfxcapture=/.test(process.CommandLine ?? '') && process.ProcessId !== target.ProcessId)
        return { before, after, killedPid: target.ProcessId, killed: killed.code === 0, restarted, ok: killed.code === 0 && restarted, ...(restarted ? {} : { reason: '15 秒内没有新的编码进程' }) }
      },
    },
    async stop() {
      if (ctx.stopped) return { alreadyStopped: true }
      const before = await scenario.alive()
      await sampleMemory(ctx, 'end').catch(() => {})
      result.recording.stopRequestedAtMs = Date.now()
      let stopped
      try { stopped = await driver.call('stop_screen_recording', { sessionRef: state.sessionRef }, { write: true, timeoutMs: 30 * 60_000 }) } catch (error) {
        // 能力调用超时或断开不等于没停：看录制是否已经结束，结束了照常核对。
        log(`停止调用失败：${error.message}；等待录制自己结束`)
        const deadline = Date.now() + 10 * 60_000
        while (Date.now() < deadline && (await scenario.alive()).alive) await sleep(2000)
        if ((await scenario.alive()).alive) throw error
        stopped = { error: String(error.message) }
      }
      ctx.stopped = true
      result.recording.stoppedAtMs = Date.now()
      result.recording.wallSeconds = (result.recording.stopRequestedAtMs - result.recording.startedAtMs) / 1000
      log(`已停止，正式能力用时 ${((result.recording.stoppedAtMs - result.recording.stopRequestedAtMs) / 1000).toFixed(1)} 秒`)
      return { before, stopped, ok: true }
    },
    async verify() {
      if (!result.recording.stoppedAtMs) return
      const deadline = Date.now() + 10 * 60_000
      let document
      while (Date.now() < deadline) {
        document = await driver.evaluate(id => window.henjiNative.documents.readDocument({ id }), state.sessionRef.id).catch(() => null)
        if (document && !['ready', 'recording', 'paused', 'empty'].includes(document.content?.status)) break
        await sleep(2000)
      }
      const content = document?.content
      result.document.path = document?.meta?.path
      if (document?.meta?.path) (ctx.storageDirs ??= []).push(path.dirname(document.meta.path))
      const since = new Date(result.recording.prepareAtMs - 2000).toISOString(), dates = lib.utcDatesBetween(result.recording.prepareAtMs - 2000, Date.now())
      const summaries = (await driver.queryLogs({ sinceIso: since, dates, keyword: 'recording.capture.summary' })).events
      result.checks.summary = summaries.find(event => event.event === 'recording.capture.summary' && event.context?.sessionId === state.sessionRef.id)?.context ?? null
      result.checks.documentStatus = content?.status ?? null
      result.checks.expectedEncoderRestarts = state.expectedRestarts
      result.checks.expectedFrames = Math.round((result.recording.wallSeconds ?? 0) * options.fps)
      result.checks.expectedAudioKinds = [...(options.microphone ? ['microphone'] : []), ...(options.systemAudio ? ['systemAudio'] : [])]
      const media = content?.media ?? []
      const audioFiles = {}
      for (const item of media) if (item.kind === 'microphone' || item.kind === 'systemAudio') audioFiles[item.kind] = (audioFiles[item.kind] ?? 0) + 1
      result.checks.audioFiles = audioFiles
      result.checks.gaps = (content?.tracks?.tracks ?? []).flatMap(track => track.gaps.map(gap => ({ kind: track.kind, reason: gap.reason, startUs: gap.monoSpanUs[0], durationUs: gap.monoSpanUs[1] - gap.monoSpanUs[0] })))
      result.checks.files = []
      for (const item of media) result.checks.files.push({ role: item.kind === 'screen' ? '画面分片' : item.kind === 'microphone' ? '麦克风' : item.kind === 'systemAudio' ? '系统声' : item.kind, path: item.path, monoUs: item.monoUs, durationUs: item.durationUs, required: true, probe: await probe(item.path) })
      const screenSeconds = media.filter(item => item.kind === 'screen').reduce((sum, item) => sum + item.durationUs, 0) / 1e6
      result.checks.screenSeconds = screenSeconds
      const mediaDirs = [...new Set(media.map(item => path.dirname(item.path)))]
      ;(ctx.storageDirs ??= []).push(...mediaDirs)
      result.checks.leftoverNativeCopies = mediaDirs.flatMap(dir => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(file => /^microphone-native-.*\.wav$/.test(file)).map(file => path.join(dir, file)))
      result.checks.markers = content?.markers ?? []
      await checkCursor(content)
      await checkPicture(content, media)
      ctx.persist()
    },
  }

  /** 标记与光标移动都在事件时钟上：用标记把墙钟换成 monoUs，再到事件里找移动。 */
  const monoAt = (content, mark, wallMs) => {
    const marker = content?.markers?.find(item => item.note === mark.note)
    return marker ? marker.monoUs + (wallMs - (mark.beforeMs + mark.afterMs) / 2) * 1000 : null
  }
  async function checkCursor(content) {
    const total = result.checks.summary?.events
    const reader = async (offset, limit) => (await driver.call('read_screen_recording_events', { sessionRef: state.sessionRef, offset, limit }, { retryMs: 30_000 })).events ?? []
    result.checks.cursor = []
    for (const move of state.cursorMoves) {
      const aUs = monoAt(content, move.mark, move.move.aAtMs), bUs = monoAt(content, move.mark, move.move.bAtMs), endUs = monoAt(content, move.mark, move.move.endAtMs)
      if (aUs === null || !Number.isFinite(total)) { result.checks.cursor.push({ scheduledSec: move.scheduledSec, ok: false, reason: aUs === null ? '标记没有进入录制' : '没有事件总数' }); continue }
      try {
        const events = await lib.readEventsBetween(reader, total, aUs - 500_000, endUs + 200_000)
        const direction = [move.move.b[0] - move.move.a[0], move.move.b[1] - move.move.a[1]]
        result.checks.cursor.push({ scheduledSec: move.scheduledSec, rtMs: move.mark.afterMs - move.mark.beforeMs, ...lib.analyzeCursorMove(events, { aUs, bUs, holdUs: CURSOR_HOLD_MS * 1000, direction }) })
      } catch (error) { result.checks.cursor.push({ scheduledSec: move.scheduledSec, ok: false, reason: String(error.message) }) }
    }
  }
  /** 切工作区那一刻画面应有变化（被录的屏幕上显示着应用时）；只做提示，不判失败。 */
  async function checkPicture(content, media) {
    result.checks.picture = []
    for (const [index, change] of (ctx.switches ?? []).entries()) {
      const mark = state.marks.find(item => item.note.endsWith(`switch-${change.workspaceId}`) && item.beforeMs <= change.atMs && !result.checks.picture.some(done => done.mark === item.note))
      if (!mark || index > 2) continue
      const atUs = monoAt(content, mark, change.atMs)
      const span = media.find(item => item.kind === 'screen' && atUs >= item.monoUs && atUs < item.monoUs + item.durationUs)
      if (!span) { result.checks.picture.push({ mark: mark.note, changed: false, windowSeconds: 4, reason: '找不到这一刻的画面分片' }); continue }
      const offset = (atUs - span.monoUs) / 1e6
      const scene = await sceneChanges(span.path, offset - 1, 4)
      const after = scene.ok ? scene.times.filter(time => time >= 0.9) : []
      result.checks.picture.push({ mark: mark.note, file: span.path, offsetSeconds: offset, changed: after.length > 0, firstChangeDelayMs: after.length ? Math.round((after[0] - 1) * 1000) : null, windowSeconds: 4, ...(scene.ok ? {} : { error: scene.error }) })
    }
  }
  ctx.scenario = scenario
  return scenario
}

main().catch(error => { console.error(error); process.exit(1) })
