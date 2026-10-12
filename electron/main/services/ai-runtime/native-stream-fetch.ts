import { Readable } from 'node:stream'
import { AiRuntimeError, type Transport } from '@henjicc/ai-sdk'

/** Node/undici requires duplex for a streamed body; Readable.from owns iterator cleanup/backpressure. */
export function createNativeStreamFetch(send: Transport['fetch']): NonNullable<Transport['fetchStream']> {
  return async (url, init) => {
    init.signal?.throwIfAborted()
    if (!Number.isSafeInteger(init.contentLength) || init.contentLength < 0) {
      throw new AiRuntimeError('invalid_parameter', '流式请求长度无效')
    }
    const { body, contentLength, ...request } = init
    const headers = new Headers(request.headers)
    headers.set('Content-Length', String(contentLength))
    const stream = Readable.from(body, { objectMode: false, highWaterMark: 64 * 1024 })
    // Native fetch receives the same signal. Destroy also releases a source blocked on backpressure.
    const onAbort = (): void => { stream.destroy() }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      request.signal?.throwIfAborted()
      const nativeRequest: RequestInit & { duplex: 'half' } = {
        ...request, headers, body: stream as unknown as NonNullable<RequestInit['body']>, duplex: 'half',
      }
      return await send(url, nativeRequest)
    } finally {
      request.signal?.removeEventListener('abort', onAbort)
      stream.destroy()
    }
  }
}
