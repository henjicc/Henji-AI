import { BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { VideoDecoderService } from '../../electron/main/services/video-decoder/client'
import type { VideoFrameTarget } from '../../electron/main/services/video-decoder/texture-bridge'
import { createMainLogger } from '../../electron/main/services/logging/main-logger'
import { WebCacheActivity } from '../../electron/main/services/web-source/activity'
import { WebCacheCapabilityGate, probeWebCacheHardware } from '../../electron/main/services/web-source/capability'
import { WebCacheLocks } from '../../electron/main/services/web-source/locks'
import { WebCacheRegistrations } from '../../electron/main/services/web-source/registration'
import { WebCacheScheduler } from '../../electron/main/services/web-source/scheduler'
import { WebSourcePages } from '../../electron/main/services/web-source/pages'
import { ContentTrustSession } from '../../electron/main/services/content-trust/runtime'

/** 诊断预算只允许本专项分配真实测试纹理；生产阈值与调度器都保持正式实现。 */
export async function memoryProbe(output: string, ffmpeg: string): Promise<unknown> {
  const root = path.join(output, 'memory-site'), cacheRoot = path.join(output, 'memory-cache')
  await fs.mkdir(root)
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><style>html,body{margin:0}div{width:100vw;height:100vh;background:blue}</style><div data-henji-stage></div><script>window.henjiWeb={ready:Promise.resolve(),duration:2,seek(t){document.querySelector("div").textContent=t.toFixed(3)}}</script>')
  const logger = createMainLogger('main.web_source')
  const service = new VideoDecoderService({ resolveExecutable: () => path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe'), logger,
    limits: () => ({ vramBytes: 64 * 1024 ** 3, decoderSessions: 64 }), requestTimeoutMs: 30_000 })
  const activity = new WebCacheActivity(service, logger)
  const registrations = new WebCacheRegistrations(new ContentTrustSession(() => false, () => undefined), logger)
  const binaries = { ffmpeg, ffprobe: path.join(path.dirname(ffmpeg), 'ffprobe.exe') }
  const capability = new WebCacheCapabilityGate(control => probeWebCacheHardware({ service, logger, binaries, directory: path.join(output, 'memory-hardware'), control }), logger)
  const samples: unknown[] = [], textures: string[] = []
  const lifecycle: unknown[] = []
  const stopLifecycle = service.onLifecycle(event => lifecycle.push(event))
  // 持续写入自己分配的纹理，避免 WDDM 把从未再用的测试池逐批移出本地显存。
  const stopFrames = service.onEvent(event => { if (event.event === 'frame' && event.streamId.startsWith('pressure-')) service.notify({ type: 'release_frame', streamId: event.streamId, slot: event.slot }) })
  let started = false, released = false, published = 0
  const scheduler = new WebCacheScheduler({ registrations, activity, capability, locks: new WebCacheLocks(service), binaries,
    logger: { ...logger, info: (message, data) => { if (data?.event === 'web_source.scheduler.start') started = true; if (data?.event === 'web_source.record.released') released = true; logger.info(message, data) } },
    cacheRoot: () => cacheRoot, canScan: async () => false, published: () => { published++ },
    memoryTight: async signal => { const memory = (await service.stats({ signal, timeoutMs: 2_000 })).gpuLocalMemory; return { tight: !!memory && memory.budgetBytes - memory.currentUsageBytes < 1024 ** 3, context: memory ?? undefined } } })
  const pages = new WebSourcePages(logger, () => undefined, registrations, scheduler)
  const host = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(output, 'preload', 'decode.cjs') } })
  const target: VideoFrameTarget = { id: host.webContents.id, get mainFrame() { return host.webContents.mainFrame }, isDestroyed: () => host.isDestroyed(), send: () => undefined, onGone: () => () => undefined }
  const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
  let foreground: Promise<void> | undefined, resume: (() => void) | undefined
  try {
    await capability.check()
    // 与正式消费方一样：宿主页面先就绪，开页登记可信来源后补录才有对象可录。
    await host.loadURL('data:text/html,<title>Memory probe</title>')
    const source = await activity.foreground(() => pages.open(target, { route: 'memory', path: root, width: 640, height: 360, region: [0, 0, 640, 360], scale: 1, trust: [] }))
    if (!registrations.get(source.streamId)) throw new Error('正式开页未登记可信来源')
    pages.cacheDemand(target.id, { streamId: source.streamId, time: 0, latest: true, cacheGrid: { rate: { numerator: 30, denominator: 1 }, phase: { numerator: '0', denominator: '1' } } })
    const deadline = performance.now() + 120_000
    while (!started && performance.now() < deadline) await pause(50)
    if (!started) throw new Error('补录没有进入真实录制组')
    await pause(1000)
    foreground = activity.foreground(() => new Promise<void>(resolve => { resume = resolve }))
    while (!resume) await pause(10)
    const initial = (await service.stats()).gpuLocalMemory
    for (let index = 0; index < 32 && !released && performance.now() < deadline; index++) {
      const streamId = `pressure-${index}`
      await service.startTestStream({ streamId, format: 'rgbaf16', width: 4096, height: 4096, fps: 30, poolSize: 8 })
      textures.push(streamId)
      await pause(100)
      const stats = await service.stats(), memory = stats.gpuLocalMemory
      samples.push({ streamId, pid: service.pid, memory, nonLocalBytes: stats.gpuNonLocalUsageBytes })
      await fs.writeFile(path.join(output, 'memory-progress.json'), JSON.stringify({ initial, samples, lifecycle, released }, null, 2))
      if (memory && memory.budgetBytes - memory.currentUsageBytes < 1024 ** 3) {
        for (let wait = 0; wait < 40 && !released; wait++) await pause(100)
        break
      }
    }
    const atPressure = await service.stats()
    for (const streamId of textures.splice(0)) await service.stopStream(streamId)
    if (!released) throw new Error('真实纹理分配没有触发正式显存紧张释放条件')
    let remaining = await fs.readdir(cacheRoot)
    while (remaining.some(name => name.includes('.tmp-')) && performance.now() < deadline) { await pause(50); remaining = await fs.readdir(cacheRoot) }
    if (remaining.some(name => name.includes('.tmp-'))) throw new Error('显存紧张释放后仍残留临时录制段')
    const publishedBeforeRecovery = published
    resume(); await foreground; foreground = undefined
    await scheduler.drained()
    if (published <= publishedBeforeRecovery) throw new Error('释放显存并恢复前台后没有重新录完段')
    return { initial, samples, lifecycle, atPressure, released, publishedBeforeRecovery, published, afterRecovery: await service.stats() }
  } finally {
    for (const streamId of textures) await service.stopStream(streamId).catch(() => undefined)
    resume?.(); await foreground
    pages.dispose(); await scheduler.drained(); if (!host.isDestroyed()) host.destroy()
    await activity.dispose().catch(() => undefined); await service.shutdown()
    stopFrames(); stopLifecycle()
  }
}
