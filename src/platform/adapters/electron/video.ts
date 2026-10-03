import type { VideoPlatform } from '@/platform/contracts/video'

const DOMAIN = 'video'

function getNativeVideo(): NonNullable<typeof window.henjiNative>['video'] {
  const native = window.henjiNative
  if (!native?.video) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.video is not available`)
  }
  return native.video
}

/** 主进程缩略图缓存（资产缩略图与片段缩略帧共用同一请求/取消通道）：返回缓存文件路径。 */
async function cachedThumbnail(payload: { source: string; maxSize?: number; cache?: boolean; frame?: { timeUs: number; height: number } }, signal?: AbortSignal): Promise<{ path: string }> {
  signal?.throwIfAborted()
  const requestId = crypto.randomUUID()
  const native = getNativeVideo()
  const pending = native.generateThumbnailBytes({ ...payload, requestId })
  const cancel = (): void => { void native.cancelThumbnail(requestId).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const result = await pending
    signal?.throwIfAborted()
    if (!result.cachePath) throw new Error('视频缩略图未返回缓存位置。')
    return { path: result.cachePath }
  } finally { signal?.removeEventListener('abort', cancel) }
}

export function createElectronVideo(): VideoPlatform {
  return {
    getCachedThumbnail: (source, signal) => cachedThumbnail({ source, maxSize: 320, cache: true }, signal),
    getFilmstripFrame: ({ source, timeUs, height }, signal) => cachedThumbnail({ source, frame: { timeUs, height } }, signal),
    readVideoInfo: (source) => getNativeVideo().readVideoInfo(source),
    trimVideoSource: (payload) => getNativeVideo().trimVideoSource(payload),
    compressVideoToFit: (payload) => getNativeVideo().compressVideoToFit(payload),
    startFrameExport: (payload) => getNativeVideo().startFrameExport(payload),
    appendFrameExport: (payload) => getNativeVideo().appendFrameExport(payload),
    finishFrameExport: (payload) => getNativeVideo().finishFrameExport(payload),
    cancelFrameExport: (sessionId) => getNativeVideo().cancelFrameExport(sessionId),
    onFrameExportProgress: (listener) => getNativeVideo().onFrameExportProgress(listener),
  }
}
