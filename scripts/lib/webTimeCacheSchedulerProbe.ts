import { BrowserWindow, sharedTexture } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { WebCacheScheduler } from '../../electron/main/services/web-source/scheduler'
import { WebSourcePages } from '../../electron/main/services/web-source/pages'
import { WebSourcePage } from '../../electron/main/services/web-source/page'
import { WebCacheRegistrations } from '../../electron/main/services/web-source/registration'
import { WebCacheActivity } from '../../electron/main/services/web-source/activity'
import { WebCacheLocks } from '../../electron/main/services/web-source/locks'
import { WebCacheCapabilityGate, probeWebCacheHardware } from '../../electron/main/services/web-source/capability'
import { WebCacheSubmissions } from '../../electron/main/services/web-source/submissions'
import { readWebTimeSegment, readWebTimeGeometry } from '../../electron/main/services/web-source/publication'
import { GpuFrameCapture } from '../../electron/main/services/web-replay/player/gpuCapture'
import { VideoDecoderService } from '../../electron/main/services/video-decoder/client'
import { createMainLogger } from '../../electron/main/services/logging/main-logger'
import { appendLogEvents } from '../../electron/main/services/logging/push'
import { queryLogEvents } from '../../electron/main/services/logging/query'
import { ContentTrustSession } from '../../electron/main/services/content-trust/runtime'
import type { VideoFrameTarget } from '../../electron/main/services/video-decoder/texture-bridge'
import { VideoFrameBridge } from '../../electron/main/services/video-decoder/texture-bridge'
import { WebCacheReader } from '../../electron/main/services/web-source/reader'
import { WebCacheSegments } from '../../electron/main/services/web-source/segments'
import { cacheReadProbe } from './webTimeCacheReadProbe'

export async function schedulerProbe(output: string, ffmpeg: string, stateful = false, readCache = false): Promise<unknown> {
  const root = path.join(output, 'scheduler-site'), cacheRoot = path.join(output, 'scheduler-cache')
  await fs.mkdir(root)
  await fs.writeFile(path.join(root, 'index.html'), `<!doctype html><style>html,body{margin:0}div{width:100vw;height:100vh;background:red}</style><div data-henji-stage></div><script>let calls=0;window.henjiWeb={ready:Promise.resolve(),duration:2.1,seek(t){document.querySelector("div").style.background=${stateful ? '"rgb("+(++calls*30)+",0,0)"' : 'Math.round(t)%2?"blue":"red"'}}}</script>`)
  const logger = createMainLogger('main.web_source')
  const service = new VideoDecoderService({ resolveExecutable: () => path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe'), logger })
  const activity = new WebCacheActivity(service, logger), submissions = new WebCacheSubmissions(logger, activity)
  const registrations = new WebCacheRegistrations(new ContentTrustSession(() => false, () => undefined), logger)
  const binaries = { ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), 'ffprobe.exe') }
  const capability = new WebCacheCapabilityGate(control => probeWebCacheHardware({ service, logger, binaries, directory: path.join(output, 'hardware'), control }), logger)
  let published = 0
  const scheduler = new WebCacheScheduler({ registrations, activity, capability, locks: new WebCacheLocks(service), logger, binaries,
    cacheRoot: () => cacheRoot, canScan: async () => true, published: () => { published++ } })
  const bridge = new VideoFrameBridge({ service, sharedTexture, logger })
  const segments = new WebCacheSegments(() => cacheRoot, new WebCacheLocks(service))
  const cacheReader = readCache ? new WebCacheReader({ registrations, capability, segments, service, bridge, logger, retry: (page, request) => scheduler.retry(page, request) }) : undefined
  const pages = new WebSourcePages(logger, () => undefined, registrations, scheduler, cacheReader)
  const host = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(output, 'preload', 'decode.cjs') } })
  const target: VideoFrameTarget = { id: host.webContents.id, get mainFrame() { return host.webContents.mainFrame }, isDestroyed: () => host.isDestroyed(), send: () => undefined,
    onGone: callback => { const gone = (): void => callback('closed'); host.once('closed', gone); return () => host.removeListener('closed', gone) } }
  const view = { width: 257, height: 259, region: [0, 0, 257, 259] as [number, number, number, number], scale: 1 }
  let truthPage: WebSourcePage | undefined
  let secondHost: BrowserWindow | undefined
  let secondConsumer: { source: Awaited<ReturnType<WebSourcePages['open']>>; target: VideoFrameTarget } | undefined
  const reader = new GpuFrameCapture(0, 'yuv444p')
  try {
    await host.loadURL('data:text/html,<title>Scheduler probe</title>')
    const source = await activity.foreground(() => pages.open(target, { route: 'scheduler', path: root, ...view, trust: [] }))
    if (!registrations.get(source.streamId)) throw new Error('正式开页未登记可信来源')
    if (readCache) {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(output, 'preload', 'decode.cjs') } })
      secondHost = window
      const destination: VideoFrameTarget = { id: window.webContents.id, get mainFrame() { return window.webContents.mainFrame }, isDestroyed: () => window.isDestroyed(), send: () => undefined,
        onGone: callback => { const gone = (): void => callback('closed'); window.once('closed', gone); return () => window.removeListener('closed', gone) } }
      await window.loadURL('data:text/html,<title>Second cache consumer</title>')
      const other = await activity.foreground(() => pages.open(destination, { route: 'second', path: root, ...view, trust: [] }))
      secondConsumer = { source: other, target: destination }
      await activity.foreground(() => pages.capture(destination.id, { streamId: other.streamId, time: 0, ticket: 'warm-second', precision: 'web-cache', boxes: ['div'], cacheGrid: { rate: { numerator: 1, denominator: 1 }, phase: { numerator: '0', denominator: '1' } } }))
    }
    const started = performance.now()
    const foreground = await activity.foreground(() => pages.capture(target.id, { streamId: source.streamId, ticket: 'foreground', time: 0, boxes: ['div'], latest: true }))
    pages.cacheDemand(target.id, { streamId: source.streamId, time: 0, boxes: ['div'], latest: true,
      cacheGrid: { rate: { numerator: 1, denominator: 1 }, phase: { numerator: '0', denominator: '1' } } })
    await fs.writeFile(path.join(output, 'scheduler-foreground.json'), JSON.stringify({ source, foreground }))
    await scheduler.drained()
    const recordingMs = performance.now() - started
    if (Number(published) !== 3) throw new Error(`正式需求未完成首段及相邻两段：${published}`)
    const entries = []
    for (const name of await fs.readdir(cacheRoot)) {
      const match = /^([a-f0-9]{64})-(\d+)$/.exec(name)
      if (!match) throw new Error('补录残留临时段')
      const segment = await readWebTimeSegment(cacheRoot, match[1], Number(match[2]))
      if (!segment) throw new Error('补录段不能读回')
      const geometry = await readWebTimeGeometry(segment)
      if (!geometry || geometry.boxes.some(boxes => JSON.stringify(boxes?.div) !== JSON.stringify([0, 0, 257, 259]))) throw new Error('补录几何与画面不齐全')
      entries.push(segment)
    }
    await reader.open()
    truthPage = new WebSourcePage('scheduler-truth', target, 'truth', { root }, view, source.contentHash, () => undefined, () => undefined, submissions)
    await truthPage.open()
    const truth = path.join(output, 'scheduler-truth.yuv')
    for (let frame = 0; frame < 3; frame++) {
      const captured = await truthPage.captureReliable(frame, String(frame), reader, ['div'])
      await fs.appendFile(truth, captured.frame.bitmap())
    }
    truthPage.close(); truthPage = undefined
    if (readCache) return { recordingMs, published, ...await cacheReadProbe({ source, target, pages, segments, service, bridge, activity, scheduler, second: secondConsumer!, closeHost: () => host.destroy() }) }
    // 停在同一帧时不再由渲染层发需求；内容重载完成后应自行重放已登记的需求。
    const reloadStarted = performance.now()
    if (!stateful) {
      await fs.appendFile(path.join(root, 'index.html'), '<!-- content epoch -->')
      // 成功扩槽后的新代次可直接两槽录制。
      while (published < 5 && performance.now() - reloadStarted < 90_000) await new Promise(resolve => setTimeout(resolve, 50))
      await scheduler.drained()
      if (published !== 5) throw new Error(`内容重载丢失补录需求：${published}`)
    }
    pages.close(target.id, source.streamId)
    await scheduler.drained()
    if (registrations.get(source.streamId)) throw new Error('关闭后补录来源仍登记')
    await appendLogEvents([{ timestamp: new Date().toISOString(), level: 'debug', domain: 'main.web_source', event: 'web_source.probe.completed', message: '正式补录队列专项完成', source: 'backend' }])
    const logs = await queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source', limit: 1000 })
    const events = logs.events.filter(event => event.event?.startsWith('web_source.scheduler.')).map(event => ({ event: event.event, context: event.context }))
    if (logs.corruptedLines || events.filter(event => event.event === 'web_source.scheduler.completed').length !== published) throw new Error('调度完成日志未读回')
    if (!events.some(event => event.event === (stateful ? 'web_source.scheduler.overlap_failed' : 'web_source.scheduler.overlap_completed'))) throw new Error('交叠门禁未实际执行')
    return { entries, truth, recordingMs, published, stateful, reloadMs: stateful ? null : performance.now() - reloadStarted, reloadDemandRetained: !stateful, geometryComplete: true, sourceRemoved: true, events, afterClose: await service.stats(), versions: process.versions }
  } catch (error) {
    await appendLogEvents([{ timestamp: new Date().toISOString(), level: 'warn', domain: 'main.web_source', event: 'web_source.probe.failed', message: String(error), source: 'backend' }])
    await fs.writeFile(path.join(output, 'scheduler-failure.json'), JSON.stringify(await queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source', limit: 1000 }), null, 2))
    throw error
  } finally {
    pages.dispose(); await scheduler.drained(); truthPage?.close(); await reader.dispose(); await bridge.dispose()
    if (!host.isDestroyed()) host.destroy()
    if (secondHost && !secondHost.isDestroyed()) secondHost.destroy()
    await activity.dispose().catch(() => undefined); await service.shutdown()
  }
}
