import type { VideoDecoderPlatform } from '@/platform/contracts/videoDecoder'

const DOMAIN = 'videoDecoder'

function getNativeVideoDecoder(): NonNullable<typeof window.henjiNative>['videoDecoder'] {
  const native = window.henjiNative
  if (!native?.videoDecoder) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.videoDecoder is not available`)
  }
  return native.videoDecoder
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('探测已取消。', 'AbortError')
}

/** 中止时立即拒绝并通知主进程取消原生请求；主进程随后返回的结果被忽略。 */
export function createElectronVideoDecoder(): VideoDecoderPlatform {
  return {
    probe: (path, signal) => {
      if (signal?.aborted) return Promise.reject(abortReason(signal))
      const native = getNativeVideoDecoder()
      const requestId = crypto.randomUUID()
      const pending = native.probe(requestId, path)
      if (!signal) return pending
      return new Promise((resolve, reject) => {
        const onAbort = (): void => {
          void native.cancelProbe(requestId).catch(() => undefined)
          reject(abortReason(signal))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
      })
    },
    status: () => getNativeVideoDecoder().status(),
  }
}
