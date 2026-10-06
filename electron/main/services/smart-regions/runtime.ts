import path from 'node:path'
import { BrowserWindow, utilityProcess } from 'electron'
import { SMART_REGIONS_IPC_CHANNELS, type SmartRegionProgressEvent } from '../../../../src/platform/contracts/smartRegions'
import { getProgramStoreDir } from '../appPaths'
import { createMainLogger } from '../logging'
import { createContentDiskCache } from '../media/content-disk-cache'
import { identifyMediaContent } from '../media/content-identity'
import { ensureLocalModel } from '../local-models/runtime'
import { LocalInferenceHost, type LocalInferenceChild } from '../local-inference/host'
import { executionProviderOrder } from '../local-inference/providers'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { registerWorkRootBusyProbe } from '../work-root/busy-probes'
import { probeSmartRegionSource } from './probe'
import { SmartRegionService } from './service'

/*
 * 智能区域与本地推理的进程内单例：真实的后台进程、FFmpeg、缓存目录、模型下载与窗口广播。
 */

const logger = createMainLogger('main.smart_regions')
const inferenceLogger = createMainLogger('main.local_inference')

function broadcast(event: SmartRegionProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(SMART_REGIONS_IPC_CHANNELS.progress, event)
  }
}

let host: LocalInferenceHost | undefined
let service: SmartRegionService | undefined

export function getLocalInferenceHost(): LocalInferenceHost {
  return host ??= new LocalInferenceHost({
    fork: () => {
      const child = utilityProcess.fork(path.join(__dirname, 'local-inference-utility.cjs'), [], { serviceName: '痕迹AI本地推理', stdio: 'pipe' })
      // onnxruntime 的原生日志只看严重级别，避免大量“节点分配到 CPU”之类的提示刷屏。
      child.stderr?.on('data', (chunk: Buffer) => { inferenceLogger.debug('本地推理进程输出', { event: 'local_inference.process.stderr', context: { text: chunk.toString('utf8').slice(0, 500) } }) })
      return child as unknown as LocalInferenceChild
    },
    log: (level, message, event, context) => inferenceLogger[level](message, { event, context }),
  })
}

export function getSmartRegionService(): SmartRegionService {
  if (service) return service
  const cacheDirectory = (): string => getProgramStoreDir('smartRegions')
  const onError = (event: string, error: unknown): void => logger.warn('智能区域缓存操作失败', { event: `smart_regions.cache.${event}`, error })
  const inference = getLocalInferenceHost()
  const created = new SmartRegionService({
    identity: identifyMediaContent,
    probe: async source => probeSmartRegionSource(await loadFfprobePath(), source),
    ensureModel: async id => {
      const model = await ensureLocalModel(id)
      const file = model.files.find(entry => entry.role === 'model')
      if (!file) throw new Error(`模型 ${id} 缺少模型文件。`)
      return file.path
    },
    ffmpegPath: loadFfmpegPath,
    // 人物抠像 1 分钟 30 帧约 10–20MB；超过 4GB 时按最久未用清理。
    segments: createContentDiskCache({ directory: cacheDirectory, extension: '.hsrg', budgetBytes: 4 * 1024 ** 3, pruneIntervalMs: 60_000, onError }),
    indexes: createContentDiskCache({ directory: cacheDirectory, extension: '.json', budgetBytes: 64 * 1024 ** 2, pruneIntervalMs: 60_000, onError }),
    analyze: (job, progress) => inference.analyze(job, progress),
    cancelAnalysis: id => inference.cancel(id),
    providers: executionProviderOrder(process.platform),
    emit: broadcast,
    log: (level, message, event, context) => logger[level](message, { event, context }),
  })
  // 分析期间模型可能在下载（写在作品目录里），不允许更换作品目录。
  registerWorkRootBusyProbe('smart_region_analysis', { reason: '还有智能区域正在分析', isBusy: () => created.hasActiveJobs() })
  service = created
  return created
}

export function disposeSmartRegions(): void {
  service?.dispose()
  host?.dispose()
}
