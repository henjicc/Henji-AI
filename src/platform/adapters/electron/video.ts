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
    readVideoInfo: (source) => getNativeVideo().readVideoInfo(source),
    trimVideoSource: (payload) => getNativeVideo().trimVideoSource(payload),
    compressVideoToFit: (payload) => getNativeVideo().compressVideoToFit(payload),
    startFrameExport: (payload) => getNativeVideo().startFrameExport(payload),
    appendFrameExport: (payload) => getNativeVideo().appendFrameExport(payload),
    finishFrameExport: (payload) => getNativeVideo().finishFrameExport(payload),
    cancelFrameExport: (sessionId) => getNativeVideo().cancelFrameExport(sessionId),
  }
}
