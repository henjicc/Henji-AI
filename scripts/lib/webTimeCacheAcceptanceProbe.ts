import { BrowserWindow, ipcMain, sharedTexture } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { WebCacheScheduler } from '../../electron/main/services/web-source/scheduler'
import { WebSourcePages } from '../../electron/main/services/web-source/pages'
import { WebCacheRegistrations } from '../../electron/main/services/web-source/registration'
import { WebCacheActivity } from '../../electron/main/services/web-source/activity'
import { WebCacheLocks } from '../../electron/main/services/web-source/locks'
import { WebCacheCapabilityGate, probeWebCacheHardware } from '../../electron/main/services/web-source/capability'
import { VideoDecoderService } from '../../electron/main/services/video-decoder/client'
import { createMainLogger } from '../../electron/main/services/logging/main-logger'
import { appendLogEvents } from '../../electron/main/services/logging/push'
import { queryLogEvents } from '../../electron/main/services/logging/query'
import { ContentTrustSession } from '../../electron/main/services/content-trust/runtime'
import { VideoFrameBridge, type VideoFrameTarget } from '../../electron/main/services/video-decoder/texture-bridge'
import { WebCacheReader } from '../../electron/main/services/web-source/reader'
import { WebCacheSegments } from '../../electron/main/services/web-source/segments'
import { WebCacheExportWriter } from '../../electron/main/services/web-source/exportWriter'

/**
 * 整体验收专项：同一自造网页按序列帧率逐帧取实时画面（逐帧等待与两帧流水两种方式），登记补录并等全部段录完，
 * 再按播放语义读网页缓存，统计每帧耗时、命中、回退原因与补录进度。只测主进程取帧到纹理交付，不含渲染层合成与上屏。
 */
export async function acceptanceProbe(output: string, ffmpeg: string, width: number, height: number, frames: number, reuse?: string, heavy = false, liveOnly = false, exportOnly = false): Promise<Record<string, unknown>> {
  // 复用目录保留同一网页与已录好的段，剖析读取路径时不必每次重录。
  const base = reuse ?? output
  const suffix = `${width}x${height}${heavy ? '-heavy' : ''}`
  const root = path.join(base, `acceptance-site-${suffix}`), cacheRoot = path.join(base, `acceptance-cache-${suffix}`)
  const fps = 30, duration = frames / fps + 0.5
  await fs.mkdir(root, { recursive: true })
  // 确定性页面：彩色渐变、细线与随时间变化的文字，按 seek 时刻直接算出，不依赖时钟。
  await fs.writeFile(path.join(root, 'index.html'), `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}#s{width:100vw;height:100vh;display:grid;place-items:center;font:700 120px sans-serif;color:white}#l{position:absolute;left:0;right:0;top:50%;height:1px;background:lime}</style><div id="s" data-henji-stage>0</div><div id="l"></div><script>window.henjiWeb={ready:Promise.resolve(),duration:${duration},seek(t){const s=document.getElementById('s');s.textContent='网页 '+t.toFixed(3);s.style.background='linear-gradient('+Math.round(t*90)%360+'deg,hsl('+Math.round(t*60)%360+',80%,45%),hsl('+(Math.round(t*60)+180)%360+',80%,45%))';document.getElementById('l').style.transform='translateY('+Math.round(Math.sin(t)*200)+'px)'}}</script>`)
  // eslint-disable-next-line no-restricted-syntax -- 自造性能页面的像素内容，不是应用界面颜色。
  if (heavy) await fs.writeFile(path.join(root, 'index.html'), `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;overflow:hidden;background:#101622;color:white}#s{width:100vw;height:100vh;display:grid;grid-template-columns:repeat(12,1fr);gap:6px;font:12px sans-serif}.card{padding:6px;background:linear-gradient(120deg,#25364e,#162132);border:1px solid #5988aa;border-radius:8px;box-shadow:0 3px 8px #050810}.chart{display:flex;align-items:end;height:56px;gap:2px}.bar{flex:1;background:linear-gradient(#40d9d0,#367be1);filter:drop-shadow(0 0 2px #3ab9df)}
    </style><div id="s" data-henji-stage>${Array.from({ length: 144 }, (_, i) => `<div class="card"><span>动态指标 ${i}</span><div class="chart">${'<div class="bar"></div>'.repeat(12)}</div></div>`).join('')}</div><script>
    const bars=[...document.querySelectorAll('.bar')],labels=[...document.querySelectorAll('span')];window.henjiWeb={ready:Promise.resolve(),duration:${duration},seek(t){bars.forEach((bar,i)=>{bar.style.height=(8+Math.round((Math.sin(i*.13+t*2)+1)*24))+'px';bar.style.filter='drop-shadow(0 0 '+(1+Math.round((Math.cos(i+t)+1)*2))+'px hsl('+((i*7+Math.round(t*30))%360)+',80%,50%))'});labels.forEach((label,i)=>label.textContent='动态指标 '+i+' / '+(100+Math.sin(i+t)*80).toFixed(2))}}
    </script>`)
  const logger = createMainLogger('main.web_source')
  const service = new VideoDecoderService({ resolveExecutable: () => path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe'), logger })
  const activity = new WebCacheActivity(service, logger)
  const registrations = new WebCacheRegistrations(new ContentTrustSession(() => false, () => undefined), logger)
  const binaries = { ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), 'ffprobe.exe') }
  const capability = new WebCacheCapabilityGate(control => probeWebCacheHardware({ service, logger, binaries, directory: path.join(output, `acceptance-hardware-${width}`), control }), logger)
  let published = 0
  const publishedAt: number[] = []
  const scheduler = new WebCacheScheduler({ registrations, activity, capability, locks: new WebCacheLocks(service), logger, binaries,
    cacheRoot: () => cacheRoot, canScan: async () => true, published: () => { published++; publishedAt.push(performance.now()) },
    memoryTight: async signal => { const memory = (await service.stats({ signal, timeoutMs: 2_000 })).gpuLocalMemory; return { tight: false, context: memory ?? undefined } } })
  const bridge = new VideoFrameBridge({ service, sharedTexture, logger })
  const segments = new WebCacheSegments(() => cacheRoot, new WebCacheLocks(service))
  const reader = new WebCacheReader({ registrations, capability, segments, service, bridge, logger, retry: (page, request) => { if (!exportOnly) scheduler.retry(page, request) } })
  const exportWriter = new WebCacheExportWriter({ registrations, capability, locks: new WebCacheLocks(service), logger, binaries, cacheRoot: () => cacheRoot, published: () => { published++ } })
  const pages = new WebSourcePages(logger, () => undefined, registrations, scheduler, reader, exportWriter)
  const host = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(output, 'preload', 'decode.cjs') } })
  const target: VideoFrameTarget = { id: host.webContents.id, get mainFrame() { return host.webContents.mainFrame }, isDestroyed: () => host.isDestroyed(), send: () => undefined,
    onGone: callback => { const gone = (): void => callback('closed'); host.once('closed', gone); return () => host.removeListener('closed', gone) } }
  const view = { width, height, region: [0, 0, width, height] as [number, number, number, number], scale: 1 }
  const grid = { rate: { numerator: fps, denominator: 1 }, phase: { numerator: '0', denominator: '1' } }
  const startedAt = new Date().toISOString()
  const summary = (values: number[]): Record<string, number> => {
    const sorted = [...values].sort((a, b) => a - b), at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    return { count: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), p50Ms: at(0.5), p95Ms: at(0.95), maxMs: sorted.at(-1) ?? 0 }
  }
  // 分阶段计时：主进程共享纹理导入/发送、原生取帧往返与解码、桥接整次取帧、缓存读取的文件操作、渲染层接收与绘制。
  let active: Record<string, number[]> | undefined
  const note = (stage: string, ms: unknown): void => { if (active && typeof ms === 'number' && Number.isFinite(ms)) (active[stage] ??= []).push(ms) }
  const restores: Array<() => void> = []
  const wrap = <T extends object>(owner: T, key: keyof T & string, stage: string): void => {
    const original = owner[key] as unknown as (...args: unknown[]) => unknown
    const patched = function (this: unknown, ...args: unknown[]): unknown {
      const begun = performance.now(), value = original.apply(this, args)
      if (!(value instanceof Promise)) { note(stage, performance.now() - begun); return value }
      return value.then(result => {
        note(stage, performance.now() - begun)
        if (stage === 'native.frameAt') note('native.decodeMs', (result as { decodeMs?: number }).decodeMs)
        return result
      }, (error: unknown) => { note(stage, performance.now() - begun); throw error })
    }
    Object.defineProperty(owner, key, { value: patched, configurable: true, writable: true })
    restores.push(() => Object.defineProperty(owner, key, { value: original, configurable: true, writable: true }))
  }
  wrap(service, 'frameAt', 'native.frameAt')
  wrap(bridge, 'frameAt', 'bridge.frameAt')
  wrap(sharedTexture, 'importSharedTexture', 'main.importSharedTexture')
  wrap(sharedTexture, 'sendSharedTexture', 'main.sendSharedTexture')
  for (const key of ['readFile', 'stat', 'utimes', 'realpath'] as const) wrap(fs, key, `fs.${key}`)
  const decoded = (_event: unknown, message: { drawMs?: number; receiverMs?: number }): void => { note('renderer.draw', message.drawMs); note('renderer.receiver', message.receiverMs) }
  ipcMain.on('web-cache-probe:decoded', decoded)
  restores.push(() => ipcMain.off('web-cache-probe:decoded', decoded))
  // 超时被外层结束时也留下各阶段进度。
  const progress = (phase: string, data: unknown): Promise<void> => fs.appendFile(path.join(output, `acceptance-progress-${width}x${height}.jsonl`), `${JSON.stringify({ phase, at: performance.now(), data })}
`)
  try {
    await host.loadURL('data:text/html,<title>Acceptance probe</title>')
    const source = await activity.foreground(() => pages.open(target, { route: 'acceptance', path: root, ...view, trust: [] }))
    if (source.pixelWidth !== width || source.pixelHeight !== height) throw new Error(`网页实际尺寸不符：${source.pixelWidth}×${source.pixelHeight}`)
    // 前台持有期间后台补录只停提交，实时取帧不与补录争用。
    const pass = (precision: 'exact' | 'web-cache', label: string, inFlight: number, adaptive = false) => activity.foreground(async () => {
      const times: number[] = [], provenance: Record<string, number> = {}
      const stages: Record<string, number[]> = {}
      active = stages
      let next = 0, ticket = 0
      const started = performance.now()
      const worker = async (): Promise<void> => {
        while (next < frames) {
          const frame = next++, begun = performance.now()
          const result = await pages.capture(target.id, { streamId: source.streamId, time: frame / fps, ticket: `${label}-${ticket++}`, ...(precision === 'web-cache' ? { precision, cacheGrid: grid, latest: true, ...(adaptive ? { cachePolicy: 'adaptive' as const } : {}) } : exportOnly && label === 'live-seq' ? { cacheWrite: true, cacheGrid: grid } : {}) })
          if (result.dropped) throw new Error(`${label} 第 ${frame} 帧被丢弃`)
          times.push(performance.now() - begun)
          provenance[result.provenance ?? 'live'] = (provenance[result.provenance ?? 'live'] ?? 0) + 1
        }
      }
      await Promise.all(Array.from({ length: inFlight }, worker))
      const totalMs = performance.now() - started
      // 等最后几帧的渲染层回执进来再结束计时归属。
      await new Promise(resolve => setTimeout(resolve, 200))
      active = undefined
      return { precision, inFlight, totalMs, intervalMs: totalMs / frames, ...summary(times), first: times[0], provenance,
        stages: Object.fromEntries(Object.entries(stages).map(([stage, values]) => [stage, { ...summary(values), totalMs: values.reduce((sum, value) => sum + value, 0) }])) }
    })
    const liveSequential = await pass('exact', 'live-seq', 1)
    await progress('live-seq', liveSequential)
    const livePipelined = await pass('exact', 'live-pipe', 2)
    await progress('live-pipe', livePipelined)
    if (liveOnly) return { size: { width, height }, fps, frames, heavy, liveSequential, livePipelined, scope: 'live-only; no cache recording or read' }
    const recordingStarted = performance.now()
    if (reuse || exportOnly) {
      await capability.check()
      // 只读剖析不登记补录：多槽交叠会重演已发布段，掩盖读取成本并阻塞已有段锁。
      await activity.foreground(async () => {
        const deadline = performance.now() + 30_000
        while ((await pages.capture(target.id, { streamId: source.streamId, time: 0, ticket: 'warm-cache', precision: 'web-cache', cacheGrid: grid, latest: true })).provenance !== 'web-cache') {
          if (performance.now() >= deadline) throw new Error('复用缓存未就绪')
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      })
    } else {
      pages.cacheDemand(target.id, { streamId: source.streamId, time: 0, latest: true, cacheGrid: grid })
      await scheduler.drained()
    }
    const recordingMs = performance.now() - recordingStarted
    await progress('recording', { recordingMs, published })
    const stats = await service.stats()
    // 播放语义（latest）只要最新一幅，会作废同来源更早的在途读取，所以缓存只测逐帧等待。
    const cachedSequential = await pass('web-cache', 'cache-seq', 1)
    const adaptiveSequential = await pass('web-cache', 'adaptive-seq', 1, true)
    const cacheStreams = (await service.stats()).streams.filter(stream => stream.kind === 'decoder').map(stream => ({ streamId: stream.streamId, format: stream.format, width: stream.width, height: stream.height, counters: stream.counters }))
    await appendLogEvents([{ timestamp: new Date().toISOString(), level: 'debug', domain: 'main.web_source', event: 'web_source.probe.acceptance', message: '整体验收专项完成', source: 'backend' }])
    const events: Awaited<ReturnType<typeof queryLogEvents>>['events'] = []
    let beforeLine: number | undefined
    for (;;) {
      const logs = await queryLogEvents({ date: new Date().toISOString().slice(0, 10), afterTimestamp: startedAt, domainPrefix: 'main.web_source', limit: 2000, beforeLine })
      events.push(...logs.events)
      if (!logs.hasMore) break
      beforeLine = logs.nextBeforeLine
    }
    const count = (event: string): number => events.filter(entry => entry.event === event).length
    const reasons: Record<string, number> = {}
    for (const entry of events) if (entry.event === 'web_source.cache.miss') { const reason = String((entry.context as Record<string, unknown> | undefined)?.reason); reasons[reason] = (reasons[reason] ?? 0) + 1 }
    const segmentCount = Math.ceil(frames / (2 * fps))
    return {
      size: { width, height }, heavy, exportOnly, fps, frames, liveSequential, livePipelined, cachedSequential, adaptiveSequential, cacheStreams,
      selections: events.filter(entry => entry.event === 'web_source.cache.selection').map(entry => entry.context),
      recording: { recordingMs, published, segmentsForFrames: segmentCount, publishedAtMs: publishedAt.map(at => at - recordingStarted), framesPerSecond: published * 2 * fps / (recordingMs / 1000) },
      failures: events.filter(entry => /\.(failed|throttled)$/.test(entry.event)).map(entry => ({ event: entry.event, message: entry.message, error: entry.error, context: entry.context })),
      logs: { hits: count('web_source.cache.hit'), misses: count('web_source.cache.miss'), missReasons: reasons, recordCompleted: count('web_source.record.completed'), recordFailed: count('web_source.record.failed'), recordCancelled: count('web_source.record.cancelled'), preempted: count('web_source.record.preempted'), resumed: count('web_source.record.resumed') },
      gpuLocalMemory: stats.gpuLocalMemory, decoderBudget: stats.budget,
    }
  } finally {
    for (const restore of restores.splice(0).reverse()) restore()
    pages.dispose(); await scheduler.drained(); await bridge.dispose()
    if (!host.isDestroyed()) host.destroy()
    await activity.dispose().catch(() => undefined); await service.shutdown()
  }
}
