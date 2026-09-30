import type { VideoPlatform } from '@/platform/contracts/video'

const DOMAIN = 'video'

function getNativeVideo(): NonNullable<typeof window.henjiNative>['video'] {
  const native = window.henjiNative
  if (!native?.video) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.video is not available`)
  }
  return native.video
}

export function createElectronVideo(): VideoPlatform {
  return {
    async getCachedThumbnail(source, signal) {
      signal?.throwIfAborted()
      const requestId = crypto.randomUUID()
      const native = getNativeVideo()
      const pending = native.generateThumbnailBytes({ source, maxSize: 320, cache: true, requestId })
      const cancel = (): void => { void native.cancelThumbnail(requestId).catch(() => {}) }
      signal?.addEventListener('abort', cancel, { once: true })
      try { const result = await pending; signal?.throwIfAborted(); if (!result.cachePath) throw new Error('视频缩略图未返回缓存位置。'); return { path: result.cachePath } } finally { signal?.removeEventListener('abort', cancel) }
    },
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
