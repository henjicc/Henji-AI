import fs from 'node:fs/promises'
import { BrowserWindow } from 'electron'
import { TRACKING_IPC_CHANNELS, type TrackingProgressEvent } from '../../../../src/platform/contracts/tracking'
import { getProgramStoreDir } from '../appPaths'
import { createMainLogger } from '../logging'
import { createContentDiskCache } from '../media/content-disk-cache'
import { identifyMediaContent } from '../media/content-identity'
import { ensureLocalModel } from '../local-models/runtime'
import { executionProviderOrder } from '../local-inference/providers'
import { getLocalInferenceHost } from '../smart-regions/runtime'
import { probeSmartRegionSource } from '../smart-regions/probe'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import { registerWorkRootBusyProbe } from '../work-root/busy-probes'
import { TrackingService } from './service'

/*
 * 跟踪服务的进程内单例（任务 4.10）：与智能区域共用本地推理后台进程与程序目录（SmartRegions/，扩展名 .htrk）。
 */

const logger = createMainLogger('main.tracking')

function broadcast(event: TrackingProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(TRACKING_IPC_CHANNELS.progress, event)
  }
}

async function readHead(file: string, bytes: number): Promise<Uint8Array> {
  const handle = await fs.open(file, 'r')
  try {
    const buffer = new Uint8Array(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally { await handle.close() }
}

let service: TrackingService | undefined

export function getTrackingService(): TrackingService {
  if (service) return service
  const inference = getLocalInferenceHost()
  const created = new TrackingService({
    identity: identifyMediaContent,
    probe: async source => probeSmartRegionSource(await loadFfprobePath(), source),
    ensureModel: async id => (await ensureLocalModel(id)).files.filter(file => file.role === 'model').map(file => ({ name: file.name, path: file.path })),
    ffmpegPath: loadFfmpegPath,
    // 形状跟踪每帧约 5–15KB（压缩后），10 分钟约 100MB；超过 2GB 按最久未用清理。
    results: createContentDiskCache({ directory: () => getProgramStoreDir('smartRegions'), extension: '.htrk', budgetBytes: 2 * 1024 ** 3, pruneIntervalMs: 60_000, onError: (event, error) => logger.warn('跟踪结果缓存操作失败', { event: `tracking.cache.${event}`, error }) }),
    track: (job, progress) => inference.track(job, progress),
    candidates: job => inference.candidates(job),
    cancel: id => inference.cancel(id),
    readHead,
    providers: executionProviderOrder(process.platform),
    emit: broadcast,
    log: (level, message, event, context) => logger[level](message, { event, context }),
  })
  // 跟踪期间模型可能在下载（写在作品目录里），不允许更换作品目录。
  registerWorkRootBusyProbe('tracking', { reason: '还有跟踪正在进行', isBusy: () => created.hasActiveJobs() })
  service = created
  return created
}

export function disposeTracking(): void { service?.dispose() }
