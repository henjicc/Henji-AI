import { app, webContents } from 'electron'
import path from 'node:path'
import { WEB_SOURCE_CONTENT_CHANGED_CHANNEL } from '../../../../src/platform/contracts/videoFrameTypes'
import { createMainLogger } from '../logging/main-logger'
import { WebSourcePages } from './pages'
import { WebCacheCapabilityGate, probeWebCacheHardware } from './capability'
import { getVideoDecoderService, getVideoFrameBridge } from '../video-decoder'
import { WebCacheRegistrations } from './registration'
import { contentTrust } from '../content-trust/runtime'
import { WebCacheActivity } from './activity'
import { WebCacheScheduler } from './scheduler'
import { WebCacheLocks } from './locks'
import { getMediaCacheManager, getWebCacheSegments } from '../media/media-cache-runtime'
import { WebCacheReader } from './reader'
import { WebCacheExportWriter } from './exportWriter'
import { waitWebCacheTask } from './submissions'

export { parseWebSourceCacheRequest, parseWebSourceCaptureRequest, parseWebSourceOpenRequest, parseWebSourcePaths } from './pages'

let pages: WebSourcePages | null = null
let capability: WebCacheCapabilityGate | undefined
let activity: WebCacheActivity | undefined

export function getWebCacheActivity(): WebCacheActivity | undefined {
  if (process.platform !== 'win32') return undefined
  if (!activity) {
    const logger = createMainLogger('main.web_source')
    const created = new WebCacheActivity(getVideoDecoderService(), logger)
    activity = created
    app.once('will-quit', () => { void created.dispose().catch(error => logger.warn('网页补录协调关闭失败', { event: 'web_source.activity.close_failed', error })) })
  }
  return activity
}

/** 按需由缓存录制调度器检查，不在实时网页打开或应用启动时抢占 GPU。 */
function getWebCacheCapabilityGate(): WebCacheCapabilityGate {
  if (capability) return capability
  const logger = createMainLogger('main.web_source')
  const service = getVideoDecoderService()
  let gpuInfoFlight: Promise<void> | undefined
  const refreshGpu = (): Promise<void> => gpuInfoFlight ??= waitWebCacheTask(app.getGPUInfo('basic'), AbortSignal.timeout(30_000)).then(info => gate.updateGpuInfo(info))
    .catch(error => logger.warn('网页缓存设备信息暂不可用', { event: 'web_source.capability.gpu_info_failed', error }))
    .finally(() => { gpuInfoFlight = undefined })
  const gate = new WebCacheCapabilityGate(async control => {
    await waitWebCacheTask(refreshGpu(), control?.signal)
    return probeWebCacheHardware({ directory: path.join(app.getPath('temp'), 'henji-web-cache-capability'), service, logger, control })
  }, logger)
  service.onLifecycle(event => { if (event.type === 'exited') gate.invalidate() })
  // 信息补全也会触发此事件；只在设备/驱动身份变化时作废，GPU 进程退出另行立即作废。
  app.on('gpu-info-update', () => { void refreshGpu() })
  app.on('child-process-gone', (_event, details) => { if (details.type === 'GPU') gate.invalidate() })
  capability = gate
  return gate
}

const WEB_CACHE_MEMORY_HEADROOM_BYTES = 1024 ** 3

/** 主进程唯一的网页来源服务；内容变化发给所有有界面的页面，没订阅的忽略。 */
export function getWebSourcePages(): WebSourcePages {
  if (pages) return pages
  const logger = createMainLogger('main.web_source')
  const registrations = new WebCacheRegistrations(contentTrust(), logger)
  const activity = getWebCacheActivity()
  let scheduler: WebCacheScheduler | undefined
  if (activity) {
    const manager = getMediaCacheManager()
    scheduler = new WebCacheScheduler({ registrations, activity, capability: getWebCacheCapabilityGate(), locks: new WebCacheLocks(getVideoDecoderService()), logger,
      cacheRoot: () => manager.categoryDirectory('render', 'web-time'),
      canScan: async () => { const usage = await manager.usage(); return usage.totalBytes < usage.budgetBytes },
      published: () => manager.scheduleEnforce(),
      // DXGI 给的本机显存预算随全系统占用收缩：原生服务余量不足 1 GiB 即视为紧张。
      memoryTight: async signal => {
        const memory = (await getVideoDecoderService().stats({ signal, timeoutMs: 2_000 })).gpuLocalMemory
        return { tight: !!memory && memory.budgetBytes - memory.currentUsageBytes < WEB_CACHE_MEMORY_HEADROOM_BYTES, context: memory ?? undefined }
      } })
    const queue = scheduler
    const unprotect = manager.protect(file => queue.protects(file)), unsubscribe = manager.onChange(() => queue.invalidated())
    app.once('will-quit', () => { unprotect(); unsubscribe() })
  }
  const reader = activity ? new WebCacheReader({ registrations, capability: getWebCacheCapabilityGate(), segments: getWebCacheSegments(), service: getVideoDecoderService(), bridge: getVideoFrameBridge(), logger,
    retry: (page, request) => scheduler?.retry(page, request) }) : undefined
  const created = new WebSourcePages(logger, change => {
    for (const contents of webContents.getAllWebContents()) if (!contents.isDestroyed() && !contents.isOffscreen()) contents.send(WEB_SOURCE_CONTENT_CHANGED_CHANNEL, change)
  }, registrations, scheduler, reader, activity ? new WebCacheExportWriter({ registrations, capability: getWebCacheCapabilityGate(), locks: new WebCacheLocks(getVideoDecoderService()), logger,
    cacheRoot: () => getMediaCacheManager().categoryDirectory('render', 'web-time'), published: () => getMediaCacheManager().scheduleEnforce() }) : undefined)
  app.once('will-quit', () => created.dispose())
  pages = created
  return created
}
