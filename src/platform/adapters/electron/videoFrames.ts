import {
  VIDEO_FRAMES_PORT_MESSAGE_TYPE,
  type VideoFramesPlatform,
  type VideoFramesPortWindowMessage,
} from '@/platform/contracts/videoFrames'

const DOMAIN = 'videoFrames'
const CONNECT_TIMEOUT_MS = 5_000

function getNativeVideoFrames(): NonNullable<typeof window.henjiNative>['videoFrames'] {
  const native = window.henjiNative
  if (!native?.videoFrames) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.videoFrames is not available`)
  }
  return native.videoFrames
}

/** preload 用 window message 交付端口；按通道标识认领，避免并发建立的通道互相拿错。 */
export function createElectronVideoFrames(): VideoFramesPlatform {
  return {
    connect: () => new Promise((resolve, reject) => {
      const native = getNativeVideoFrames()
      let route: string | null = null
      const cleanup = (): void => {
        window.removeEventListener('message', onMessage)
        clearTimeout(timer)
      }
      const onMessage = (event: MessageEvent): void => {
        const data = event.data as Partial<VideoFramesPortWindowMessage> | null
        const port = event.ports[0]
        if (data?.type !== VIDEO_FRAMES_PORT_MESSAGE_TYPE || route === null || data.route !== route || !port) return
        cleanup()
        resolve({ route, port })
      }
      const timer = setTimeout(() => {
        cleanup()
        if (route) native.disconnect(route)
        reject(new Error('显卡帧通道建立超时。'))
      }, CONNECT_TIMEOUT_MS)
      window.addEventListener('message', onMessage)
      try {
        route = native.connect()
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }),
    disconnect: (route) => getNativeVideoFrames().disconnect(route),
    openTestStream: (request) => getNativeVideoFrames().openTestStream(request),
    closeStream: (streamId) => getNativeVideoFrames().closeStream(streamId),
    stats: () => getNativeVideoFrames().stats(),
    onStreamEnded: (listener) => getNativeVideoFrames().onStreamEnded(listener),
  }
}
