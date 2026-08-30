import http, { type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'
import type { Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'

export interface PinnedHttpFetchContext {
  resolvedAddresses: readonly string[]
  connectTimeoutMs: number
  responseHeadersTimeoutMs: number
}

type RequestFactory = (
  url: URL,
  options: RequestOptions,
  listener: (response: IncomingMessage) => void,
) => ClientRequest

export interface PinnedHttpFetchDependencies {
  requestHttp?: RequestFactory
  requestHttps?: RequestFactory
}

function timeoutError(phase: 'connection' | 'response headers', timeoutMs: number): Error {
  const error = new Error(`Remote image ${phase} timed out after ${timeoutMs}ms`)
  error.name = 'TimeoutError'
  return error
}

function positiveTimeout(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
  return value
}

function selectPinnedAddress(addresses: readonly string[]): { address: string; family: 4 | 6 } {
  const address = addresses[0]
  const family = address ? isIP(address) : 0
  if (!address || (family !== 4 && family !== 6)) {
    throw new Error('Pinned HTTP request requires a validated IP address')
  }
  return { address, family }
}

export function createPinnedLookup(addresses: readonly string[]): LookupFunction {
  const pinned = selectPinnedAddress(addresses)
  return (_hostname, options, callback): void => {
    const wantsAll = typeof options === 'object' && options.all === true
    if (wantsAll) {
      callback(null, [{ address: pinned.address, family: pinned.family }])
      return
    }
    callback(null, pinned.address, pinned.family)
  }
}

function appendResponseHeaders(target: Headers, source: http.IncomingHttpHeaders): void {
  for (const [name, raw] of Object.entries(source)) {
    if (Array.isArray(raw)) {
      for (const value of raw) target.append(name, value)
    } else if (raw !== undefined) {
      target.set(name, raw)
    }
  }
}

/**
 * 使用已经通过公网校验的地址完成连接。URL hostname 仍交给 HTTP Host/TLS SNI，
 * 因而证书验证不降级，同时消除“校验后再次 DNS 解析”的重绑定窗口。
 */
export async function fetchPinnedHttpSource(
  input: string,
  init: RequestInit,
  context: PinnedHttpFetchContext,
  dependencies: PinnedHttpFetchDependencies = {},
): Promise<Response> {
  const url = new URL(input)
  const requestHttp = dependencies.requestHttp ?? http.request.bind(http)
  const requestHttps = dependencies.requestHttps ?? https.request.bind(https)
  const requestSource = url.protocol === 'https:' ? requestHttps : requestHttp
  const lookup = createPinnedLookup(context.resolvedAddresses)
  const connectTimeoutMs = positiveTimeout(context.connectTimeoutMs, 'connectTimeoutMs')
  const responseHeadersTimeoutMs = positiveTimeout(
    context.responseHeadersTimeoutMs,
    'responseHeadersTimeoutMs',
  )
  return new Promise<Response>((resolve, reject) => {
    let connectTimer: NodeJS.Timeout | undefined
    let responseHeadersTimer: NodeJS.Timeout | undefined
    let settled = false

    const clearTimers = (): void => {
      if (connectTimer) clearTimeout(connectTimer)
      if (responseHeadersTimer) clearTimeout(responseHeadersTimer)
      connectTimer = undefined
      responseHeadersTimer = undefined
    }
    const rejectRequest = (error: unknown): void => {
      if (settled) return
      settled = true
      clearTimers()
      reject(error)
    }
    const resolveRequest = (response: Response): void => {
      if (settled) return
      settled = true
      clearTimers()
      resolve(response)
    }

    const request = requestSource(url, {
      method: init.method ?? 'GET',
      headers: init.headers as http.OutgoingHttpHeaders,
      signal: init.signal ?? undefined,
      lookup,
      family: selectPinnedAddress(context.resolvedAddresses).family,
    }, (incoming) => {
      clearTimers()
      const status = incoming.statusCode ?? 0
      if (status < 200 || status > 599) {
        incoming.destroy()
        rejectRequest(new Error(`Remote image returned an unsupported HTTP status: ${status}`))
        return
      }
      try {
        const headers = new Headers()
        appendResponseHeaders(headers, incoming.headers)
        const hasBody = init.method !== 'HEAD' && status !== 204 && status !== 205 && status !== 304
        const body = hasBody
          ? Readable.toWeb(incoming) as ReadableStream<Uint8Array>
          : null
        resolveRequest(new Response(body, {
          status,
          statusText: incoming.statusMessage,
          headers,
        }))
      } catch (error) {
        incoming.destroy()
        rejectRequest(error)
      }
    })

    const onConnected = (): void => {
      if (settled || responseHeadersTimer) return
      if (connectTimer) clearTimeout(connectTimer)
      connectTimer = undefined
      responseHeadersTimer = setTimeout(() => {
        const error = timeoutError('response headers', responseHeadersTimeoutMs)
        request.destroy(error)
        rejectRequest(error)
      }, responseHeadersTimeoutMs)
      responseHeadersTimer.unref?.()
    }
    request.once('socket', (socket: Socket) => {
      const connectionEvent = url.protocol === 'https:' ? 'secureConnect' : 'connect'
      if (!socket.connecting && (url.protocol !== 'https:' || (socket as TLSSocket).encrypted)) {
        onConnected()
        return
      }
      socket.once(connectionEvent, onConnected)
    })
    request.once('error', rejectRequest)
    request.once('close', clearTimers)
    connectTimer = setTimeout(() => {
      const error = timeoutError('connection', connectTimeoutMs)
      request.destroy(error)
      rejectRequest(error)
    }, connectTimeoutMs)
    connectTimer.unref?.()
    request.end()
  })
}
