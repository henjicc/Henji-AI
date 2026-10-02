const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

/**
 * 原生显卡帧零拷贝通道（native video-decoder 合成测试画面 → 主进程 sharedTexture → 沙盒 preload →
 * MessagePort → 剪辑渲染 Worker → WebGPU importExternalTexture）。
 *
 * 阶段：各格式像素校验 → 单流/多流 4K60 负载 → 长时间运行资源曲线 → 关闭与页面重载后的资源归零。
 * 时长可用 HENJI_VIDEO_FRAMES_LOAD_SECONDS（默认 30）、HENJI_VIDEO_FRAMES_SOAK_SECONDS（默认 300）缩短，
 * 缩短后的结果不能作为验收数字。证据写入 node_modules/.cache/video-frames/evidence.json。
 */

const ROOT = path.resolve('node_modules/.cache/video-frames')
const LOAD_SECONDS = Number(process.env.HENJI_VIDEO_FRAMES_LOAD_SECONDS ?? 30)
const SOAK_SECONDS = Number(process.env.HENJI_VIDEO_FRAMES_SOAK_SECONDS ?? 300)
const SAMPLE_EVERY_SECONDS = 30
const SIZES = [{ width: 3840, height: 2160 }, { width: 2560, height: 2560 }]
const FORMATS = ['nv12', 'rgba', 'bgra', 'rgbaf16']
/** 每种格式的像素期望：色条最大误差、透明是否保留、灰阶至少多少级（位深是否保留）。 */
const EXPECT = {
  nv12: { barsMaxError: 0.02, alpha: false, rampDistinct: 200 },
  rgba: { barsMaxError: 0.01, alpha: true, rampDistinct: 250 },
  bgra: { barsMaxError: 0.01, alpha: true, rampDistinct: 250 },
  rgbaf16: { barsMaxError: 0.002, alpha: true, rampDistinct: 1024 },
}
const UNSUPPORTED = ['p010le', 'nv16']
/** 第二个窗口：用正式 preload 打开两路帧流并一直持有帧不还，随后销毁窗口，验证引用与资源被回收。 */
const HOLDER_HTML = `<!doctype html><meta charset="utf-8"><title>video-frames-holder</title><script>
window.__holderReady = (async () => {
  const native = window.henjiNative.videoFrames
  let route = null
  const port = await new Promise((resolve) => {
    addEventListener('message', (event) => { if (event.data?.type === 'henji:video-frames-port' && event.data.route === route) resolve(event.ports[0]) })
    route = native.connect()
  })
  const held = []
  port.onmessage = (event) => { if (event.data?.type === 'frame') held.push(event.data) }
  window.__held = held
  for (const format of ['nv12', 'rgbaf16']) await native.openTestStream({ route, format, width: 3840, height: 2160, fps: 60, poolSize: 6 })
  return true
})()
</script>`

function quantile(sorted, q) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0
}

function powershell(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim()
}

/** 进程句柄数、工作集与 GPU 专用显存（性能计数器）。 */
function processResources(pids) {
  const ids = pids.filter(Boolean)
  const processes = JSON.parse(powershell(`Get-Process -Id ${ids.join(',')} | Select-Object Id,HandleCount,WorkingSet64 | ConvertTo-Json -Compress`) || '[]')
  const list = Array.isArray(processes) ? processes : [processes]
  const gpuMemory = {}
  for (const pid of ids) {
    const value = powershell(`$s = (Get-Counter '\\GPU Process Memory(pid_${pid}_*)\\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples; if ($s) { ($s | Measure-Object CookedValue -Sum).Sum } else { 0 }`)
    gpuMemory[pid] = Math.round(Number(value) / 1048576)
  }
  return Object.fromEntries(list.map((item) => [item.Id, { handles: item.HandleCount, workingSetMiB: Math.round(item.WorkingSet64 / 1048576), gpuDedicatedMiB: gpuMemory[item.Id] ?? null }]))
}

/** 整卡已用显存（MiB）。按进程的 GPU 计数器对 Chromium GPU 进程会把共享资源重复计入，只作参考。 */
function totalGpuMemoryMiB() {
  try {
    return Number(execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim().split(',')[0])
  } catch {
    return null
  }
}

function workerAssetUrl() {
  const assets = path.resolve('out/renderer/assets')
  const name = fs.readdirSync(assets).find((file) => /^videoEditWorker-[\w-]+\.js$/.test(file))
  assert.ok(name, '构建产物里找不到剪辑渲染 Worker')
  return `./assets/${name}`
}

async function installHarness(page) {
  await page.evaluate(async (workerUrl) => {
    const previous = window.__henjiVideoFrames
    if (previous) previous.worker.terminate()
    const worker = new Worker(new URL(workerUrl, location.href), { type: 'module' })
    const pending = new Map()
    let next = 1
    worker.addEventListener('message', (event) => {
      const entry = pending.get(event.data?.id)
      if (!entry) return
      pending.delete(event.data.id)
      if (event.data.error) entry.reject(new Error(event.data.error))
      else entry.resolve(event.data.nativeFrames)
    })
    worker.addEventListener('error', (event) => console.error('原生帧诊断 Worker 出错', event.message))
    const native = window.henjiNative.videoFrames
    let route = null
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('帧通道端口未送达')), 5000)
      const onMessage = (event) => {
        if (event.data?.type !== 'henji:video-frames-port' || event.data.route !== route || !event.ports[0]) return
        window.removeEventListener('message', onMessage)
        clearTimeout(timer)
        resolve(event.ports[0])
      }
      window.addEventListener('message', onMessage)
      route = native.connect()
    })
    worker.postMessage({ kind: 'nativeFrames.attach', port }, [port])
    const ended = []
    native.onStreamEnded((payload) => ended.push(payload))
    window.__henjiVideoFrames = {
      worker,
      route,
      ended,
      diagnose: (request) => new Promise((resolve, reject) => {
        const id = 1_000_000 + next++
        pending.set(id, { resolve, reject })
        worker.postMessage({ kind: 'nativeFrames.diagnose', id, request })
      }),
    }
  }, workerAssetUrl())
}

const open = (page, request) => page.evaluate((value) => window.henjiNative.videoFrames.openTestStream({ route: window.__henjiVideoFrames.route, ...value }), request)
const close = (page, streamId) => page.evaluate((id) => window.henjiNative.videoFrames.closeStream(id), streamId)
const diagnose = (page, request) => page.evaluate((value) => window.__henjiVideoFrames.diagnose(value), request)
const bridgeStats = (page) => page.evaluate(() => window.henjiNative.videoFrames.stats())

async function cpuSample(app, page) {
  const process = await app.evaluate(({ app: electronApp }) => ({
    at: Date.now(),
    main: process.cpuUsage(),
    mainPid: process.pid,
    metrics: electronApp.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type, cpuSeconds: metric.cpu.cumulativeCPUUsage ?? null })),
  }))
  const stats = await bridgeStats(page)
  return { ...process, nativeCpuMs: stats.native?.cpuMs ?? null, nativePid: stats.native?.pid ?? null }
}

function cpuCores(before, after) {
  const seconds = (after.at - before.at) / 1000
  const gpuBefore = before.metrics.find((metric) => metric.type === 'GPU')
  const gpuAfter = after.metrics.find((metric) => metric.type === 'GPU' && metric.pid === gpuBefore?.pid)
  const rendererCpu = (sample) => sample.metrics.filter((metric) => metric.type === 'Tab').reduce((total, metric) => total + (metric.cpuSeconds ?? 0), 0)
  return {
    seconds: Math.round(seconds * 10) / 10,
    main: Math.round(((after.main.user + after.main.system - before.main.user - before.main.system) / 1e6 / seconds) * 1000) / 1000,
    gpuProcess: gpuBefore && gpuAfter ? Math.round(((gpuAfter.cpuSeconds - gpuBefore.cpuSeconds) / seconds) * 1000) / 1000 : null,
    renderers: Math.round(((rendererCpu(after) - rendererCpu(before)) / seconds) * 1000) / 1000,
    nativeService: before.nativeCpuMs !== null && after.nativeCpuMs !== null ? Math.round(((after.nativeCpuMs - before.nativeCpuMs) / 1000 / seconds) * 1000) / 1000 : null,
  }
}

async function checkFormat(page, format, size) {
  const info = await open(page, { format, width: size.width, height: size.height, fps: 60, poolSize: 6 })
  await diagnose(page, { action: 'start', streams: [{ streamId: info.streamId, pattern: info.pattern, checkFrames: 5, skipFrames: 3 }], composite: true })
  await page.waitForTimeout(1500)
  const result = (await diagnose(page, { action: 'stop', streamIds: [info.streamId] })).streams[0]
  const bridge = (await bridgeStats(page)).streams.find((stream) => stream.streamId === info.streamId)
  assert.equal(await close(page, info.streamId), true)
  const expectation = EXPECT[format]
  const checks = result.checks
  const summary = {
    format,
    size: `${size.width}x${size.height}`,
    colorSpace: info.colorSpace,
    received: result.received,
    errors: result.errors,
    frameFormat: checks[0]?.frameFormat ?? null,
    checked: checks.length,
    bitsOk: checks.every((check) => check.bitsOk),
    barsMaxError: Math.max(...checks.map((check) => check.barsMaxError)),
    alpha: checks[0]?.alpha,
    background: checks[0]?.background,
    rampDistinct: Math.min(...checks.map((check) => check.rampDistinct)),
    rampNonMonotonic: Math.max(...checks.map((check) => check.rampNonMonotonic)),
    rampRange: checks[0] ? [checks[0].rampMin, checks[0].rampMax] : null,
    bars: checks[0]?.bars,
    bridge: bridge && { delivered: bridge.delivered, importFailures: bridge.importFailures, sendFailures: bridge.sendFailures, handoffP50: bridge.handoffMs.p50 },
  }
  const label = `${format} ${summary.size}`
  assert.deepEqual(result.errors, [], `${label} Worker 出错`)
  assert.ok(checks.length >= 3, `${label} 像素校验帧数不足：${checks.length}`)
  assert.ok(summary.bitsOk, `${label} 帧号位块解码不一致`)
  assert.ok(summary.barsMaxError <= expectation.barsMaxError, `${label} 色条误差 ${summary.barsMaxError} 超过 ${expectation.barsMaxError}`)
  assert.equal(summary.rampNonMonotonic, 0, `${label} 灰阶出现倒序`)
  assert.ok(summary.rampDistinct >= expectation.rampDistinct, `${label} 灰阶只有 ${summary.rampDistinct} 级`)
  if (expectation.alpha) {
    assert.ok(Math.abs(summary.alpha[3] - 0.5) <= 0.01 && Math.abs(summary.alpha[0] - 0.75) <= 0.01, `${label} 透明块未保留：${summary.alpha}`)
  } else {
    assert.ok(Math.abs(summary.alpha[3] - 1) <= 0.001, `${label} 无透明格式 alpha 应为 1`)
  }
  return summary
}

async function runLoad(page, app, label, layout, seconds) {
  const streams = []
  for (const { format, count } of layout) {
    for (let index = 0; index < count; index += 1) streams.push(await open(page, { format, width: 3840, height: 2160, fps: 60, poolSize: 6 }))
  }
  await page.waitForTimeout(2000)
  await diagnose(page, { action: 'start', streams: streams.map((stream) => ({ streamId: stream.streamId })), composite: true })
  const before = await cpuSample(app, page)
  await page.waitForTimeout(seconds * 1000)
  const after = await cpuSample(app, page)
  const worker = await diagnose(page, { action: 'stop' })
  const bridge = await bridgeStats(page)
  for (const stream of streams) assert.equal(await close(page, stream.streamId), true)
  const perStream = worker.streams.map((result) => {
    const own = bridge.streams.find((stream) => stream.streamId === result.streamId)
    const nativeCounters = bridge.native?.streams.find((stream) => stream.streamId === result.streamId)?.counters
    return {
      streamId: result.streamId,
      format: own?.format,
      framesPerSecond: result.framesPerSecond,
      intervals: result.intervals,
      missingFrames: result.missingFrames,
      errors: result.errors,
      handoffMs: own?.handoffMs,
      syncMs: own?.syncMs,
      releaseMs: own?.releaseMs,
      sendFailures: own?.sendFailures,
      importFailures: own?.importFailures,
      nativeSkipped: nativeCounters?.skipped,
      nativeRenderUsAverage: nativeCounters && Math.round(nativeCounters.renderUsAverage),
    }
  })
  const handoffs = perStream.map((stream) => stream.handoffMs?.p50 ?? 0).sort((a, b) => a - b)
  return {
    label,
    seconds,
    streams: perStream.length,
    minFramesPerSecond: Math.min(...perStream.map((stream) => stream.framesPerSecond)),
    maxIntervalP95: Math.max(...perStream.map((stream) => stream.intervals.p95)),
    maxIntervalP99: Math.max(...perStream.map((stream) => stream.intervals.p99)),
    maxInterval: Math.max(...perStream.map((stream) => stream.intervals.max)),
    totalMissingFrames: perStream.reduce((total, stream) => total + stream.missingFrames, 0),
    handoffP50Median: quantile(handoffs, 0.5),
    syncP50Max: Math.max(...perStream.map((stream) => stream.syncMs?.p50 ?? 0)),
    cpuCores: cpuCores(before, after),
    nativeGpuLocalMemoryMiB: bridge.native?.gpuLocalMemory ? Math.round(bridge.native.gpuLocalMemory.currentUsageBytes / 1048576) : null,
    perStream,
  }
}

async function resourceSnapshot(app, page) {
  const pids = await app.evaluate(({ app: electronApp }) => ({ main: process.pid, gpu: electronApp.getAppMetrics().find((metric) => metric.type === 'GPU')?.pid }))
  const stats = await bridgeStats(page)
  const nativePid = stats.native?.pid
  const resources = processResources([pids.main, pids.gpu, nativePid])
  return {
    at: new Date().toISOString(),
    main: resources[pids.main],
    gpuProcess: resources[pids.gpu],
    nativeProcess: nativePid ? { ...resources[nativePid], handlesSelfReported: stats.native.handleCount, gpuLocalMemoryMiB: stats.native.gpuLocalMemory ? Math.round(stats.native.gpuLocalMemory.currentUsageBytes / 1048576) : null } : null,
    gpuTotalUsedMiB: totalGpuMemoryMiB(),
    openStreams: stats.streams.length,
    nativeStreams: stats.native?.streams.length ?? null,
    unreleasedImports: stats.unreleasedImports,
    orphanHandles: stats.orphanHandles,
    preloadOutstanding: stats.preload.outstanding,
  }
}

async function waitForQuiet(page, timeoutMs = 10000, unreleasedTarget = 0) {
  const deadline = Date.now() + timeoutMs
  let stats
  do {
    stats = await bridgeStats(page)
    if (stats.streams.length === 0 && stats.unreleasedImports <= unreleasedTarget && (stats.native?.streams.length ?? 0) === 0) return stats
    await page.waitForTimeout(250)
  } while (Date.now() < deadline)
  return stats
}

function createVideoFramesScene() {
  return {
    id: 'video-frames-zero-copy',
    surface: '剪辑',
    name: '剪辑-原生显卡帧零拷贝通道格式校验与4K60负载',
    writesUserData: false,
    setup: async (page, app) => {
      fs.mkdirSync(ROOT, { recursive: true })
      const evidence = {
        machine: { cpu: os.cpus()[0].model, memoryBytes: os.totalmem(), os: os.version() },
        settings: { loadSeconds: LOAD_SECONDS, soakSeconds: SOAK_SECONDS },
        isolation: null,
        formats: [],
        unsupported: [],
        loads: [],
        soak: [],
        cleanup: {},
      }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = (name) => { evidence.currentPhase = name; store(); console.log(`[video-frames] ${name}`) }
      try {
        evidence.runtime = await app.evaluate(async ({ app: electronApp }) => ({ versions: process.versions, gpu: (await electronApp.getGPUInfo('basic')).gpuDevice }))
        phase('页面隔离检查')
        evidence.isolation = await page.evaluate(() => ({
          pageHasSharedTexture: typeof window.sharedTexture,
          pageHasRequire: typeof window.require,
          pageHasProcess: typeof window.process,
          videoFramesKeys: Object.keys(window.henjiNative.videoFrames).sort(),
        }))
        assert.equal(evidence.isolation.pageHasSharedTexture, 'undefined', '页面不应拿到 sharedTexture')
        assert.equal(evidence.isolation.pageHasRequire, 'undefined', '页面不应拿到 require')
        assert.deepEqual(evidence.isolation.videoFramesKeys, ['cancelSchedule', 'closeStream', 'connect', 'disconnect', 'frameAt', 'onStreamEnded', 'openDecoder', 'openTestStream', 'schedule', 'stats'])
        evidence.isolation.webPreferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => { const prefs = win.webContents.getLastWebPreferences(); return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration } }))
        assert.ok(evidence.isolation.webPreferences.every((prefs) => prefs.sandbox === true && prefs.contextIsolation === true && prefs.nodeIntegration !== true), '窗口必须保持 sandbox + contextIsolation')
        await installHarness(page)

        phase('格式像素校验')
        for (const size of SIZES) {
          for (const format of FORMATS) {
            const result = await checkFormat(page, format, size)
            evidence.formats.push(result)
            store()
            if (!evidence.baseline) {
              await waitForQuiet(page)
              evidence.baseline = await resourceSnapshot(app, page)
            }
          }
        }
        for (const format of UNSUPPORTED) {
          const error = await open(page, { format, width: 3840, height: 2160, fps: 60 }).then(() => null, (reason) => String(reason?.message ?? reason))
          assert.ok(error && error.includes(format), `${format} 应被拒绝`)
          evidence.unsupported.push({ format, error })
        }

        phase('单流与多流 4K60 负载')
        const loads = [
          ['单流 nv12', [{ format: 'nv12', count: 1 }]],
          ['单流 rgbaf16', [{ format: 'rgbaf16', count: 1 }]],
          ['4 路 nv12', [{ format: 'nv12', count: 4 }]],
          ['4 路 rgbaf16', [{ format: 'rgbaf16', count: 4 }]],
          ['9 路 nv12', [{ format: 'nv12', count: 9 }]],
          ['9 路 rgbaf16', [{ format: 'rgbaf16', count: 9 }]],
        ]
        // HENJI_VIDEO_FRAMES_LOAD_SECONDS=0 只复测其他阶段（如单独复跑长时间资源曲线）。
        for (const [label, layout] of LOAD_SECONDS > 0 ? loads : []) {
          phase(`负载：${label}`)
          const result = await runLoad(page, app, label, layout, LOAD_SECONDS)
          evidence.loads.push(result)
          store()
        }
        const single = evidence.loads[0]
        if (single) {
          assert.ok(single.minFramesPerSecond >= 59, `单流 4K60 送达 ${single.minFramesPerSecond} 帧/秒`)
          assert.ok(single.maxInterval <= 100, `单流最大间隔 ${single.maxInterval}ms`)
          assert.ok(single.handoffP50Median <= 2, `单流主进程交接中位数 ${single.handoffP50Median}ms`)
        }

        phase('长时间运行资源曲线')
        await waitForQuiet(page)
        const soakStreams = []
        for (const format of ['nv12', 'nv12', 'rgbaf16', 'rgbaf16']) soakStreams.push(await open(page, { format, width: 3840, height: 2160, fps: 60, poolSize: 6 }))
        await diagnose(page, { action: 'start', streams: soakStreams.map((stream) => ({ streamId: stream.streamId })), composite: true })
        const soakStarted = Date.now()
        evidence.soak.push({ elapsedSeconds: 0, ...(await resourceSnapshot(app, page)) })
        store()
        while (Date.now() - soakStarted < SOAK_SECONDS * 1000) {
          await page.waitForTimeout(Math.min(SAMPLE_EVERY_SECONDS * 1000, SOAK_SECONDS * 1000 - (Date.now() - soakStarted)))
          evidence.soak.push({ elapsedSeconds: Math.round((Date.now() - soakStarted) / 1000), ...(await resourceSnapshot(app, page)) })
          store()
        }
        const soakWorker = await diagnose(page, { action: 'stop' })
        evidence.soakDelivery = soakWorker.streams.map((stream) => ({ streamId: stream.streamId, framesPerSecond: stream.framesPerSecond, intervals: stream.intervals, missingFrames: stream.missingFrames }))
        for (const stream of soakStreams) await close(page, stream.streamId)
        evidence.cleanup.afterClose = await resourceSnapshot(app, page)
        evidence.cleanup.afterCloseQuiet = await waitForQuiet(page).then(() => resourceSnapshot(app, page))
        store()

        phase('窗口销毁回收')
        const holderFile = path.join(ROOT, 'holder.html')
        fs.writeFileSync(holderFile, HOLDER_HTML)
        const beforeHolder = await bridgeStats(page)
        await app.evaluate(async ({ BrowserWindow }, files) => {
          const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { preload: files.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
          globalThis.__henjiVideoFramesHolder = win
          await win.loadFile(files.holder)
          await win.webContents.executeJavaScript('window.__holderReady')
        }, { preload: path.resolve('out/preload/index.cjs'), holder: holderFile })
        await page.waitForTimeout(2000)
        evidence.cleanup.holderBeforeDestroy = await resourceSnapshot(app, page)
        assert.equal(evidence.cleanup.holderBeforeDestroy.openStreams, 2, '持有窗口的两路帧流未打开')
        assert.ok(evidence.cleanup.holderBeforeDestroy.unreleasedImports - beforeHolder.unreleasedImports >= 6, '持有窗口应占住纹理池')
        await app.evaluate(() => { globalThis.__henjiVideoFramesHolder.destroy(); delete globalThis.__henjiVideoFramesHolder })
        await waitForQuiet(page, 10000, beforeHolder.unreleasedImports)
        evidence.cleanup.afterWindowDestroyed = await resourceSnapshot(app, page)
        store()
        const destroyed = evidence.cleanup.afterWindowDestroyed
        assert.equal(destroyed.openStreams, 0, '窗口销毁后桥上仍有帧流')
        assert.equal(destroyed.nativeStreams, 0, '窗口销毁后原生服务仍有帧流')
        assert.equal(destroyed.unreleasedImports, beforeHolder.unreleasedImports, '窗口销毁后仍有未释放的导入')
        const baselineVram = evidence.baseline.nativeProcess.gpuLocalMemoryMiB
        assert.ok(destroyed.nativeProcess.gpuLocalMemoryMiB <= baselineVram + 64, `原生服务显存未回到基线：${destroyed.nativeProcess.gpuLocalMemoryMiB}MiB（基线 ${baselineVram}MiB）`)
        assert.ok(destroyed.nativeProcess.handles <= evidence.baseline.nativeProcess.handles + 16, `原生服务句柄未回到基线：${destroyed.nativeProcess.handles}（基线 ${evidence.baseline.nativeProcess.handles}）`)

        phase('页面重载回收')
        for (const format of ['nv12', 'rgbaf16']) {
          const info = await open(page, { format, width: 3840, height: 2160, fps: 60, poolSize: 6 })
          await diagnose(page, { action: 'start', streams: [{ streamId: info.streamId }], composite: true })
        }
        await page.waitForTimeout(2000)
        evidence.cleanup.beforeReload = await resourceSnapshot(app, page)
        await page.reload()
        await page.waitForFunction(() => Boolean(window.henjiNative?.videoFrames), null, { timeout: 30000 })
        evidence.cleanup.afterReloadQuiet = await waitForQuiet(page, 15000, 12).then(() => resourceSnapshot(app, page))
        store()
        const quiet = evidence.cleanup.afterReloadQuiet
        assert.equal(quiet.openStreams, 0, '重载后桥上仍有帧流')
        assert.equal(quiet.nativeStreams, 0, '重载后原生服务仍有帧流')
        // 已知限制（Electron 42.5）：重载时页面里在途的帧，渲染进程不再发释放回执，而同一 frame 未销毁，
        // Electron 不会自动回收；要到窗口销毁才释放（上一阶段已验证）。这里只记录数量，上限为两路纹理池。
        assert.ok(quiet.unreleasedImports - destroyed.unreleasedImports <= 12, `重载后遗留导入 ${quiet.unreleasedImports} 超过两路纹理池`)
        evidence.completed = true
        delete evidence.currentPhase
        store()
      } catch (error) {
        evidence.failed = { phase: evidence.currentPhase, message: String(error?.message ?? error) }
        store()
        throw error
      }
    },
  }
}

module.exports = { createVideoFramesScene, videoFramesHarness: { installHarness, processResources, totalGpuMemoryMiB, cpuSample, cpuCores, quantile, workerAssetUrl } }
