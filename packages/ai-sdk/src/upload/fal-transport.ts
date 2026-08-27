import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type { Transport } from '../runtime/Transport'
import type { JsonValue } from '../types/runtime'

import type { PreparedMediaBinary } from './prepared-media'

const FAL_UPLOAD_INITIATE_URL = 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3'
const FAL_UPLOAD_TIMEOUT_MS = 120_000

interface FalUploadInitiation {
  uploadUrl: string
  fileUrl: string
}

/**
 * Fal CDN 单文件 REST 上传。协议与官方客户端的 initiate + signed PUT 路径一致，但全部网络
 * 都经宿主 Transport，且直接传递编码后的字节，不依赖 File/Blob 或全局 fetch。
 */
export async function uploadToFalWithTransport(
  apiKey: string,
  prepared: PreparedMediaBinary,
  transport: Transport,
  signal?: AbortSignal
): Promise<string> {
  const deadline = createDeadlineSignal(signal, FAL_UPLOAD_TIMEOUT_MS)
  try {
    const initiateResponse = await transport.fetch(FAL_UPLOAD_INITIATE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content_type: prepared.mimeType,
        file_name: prepared.filename,
      }),
      signal: deadline.signal,
    })
    const initiation = await readInitiation(initiateResponse)
    assertHttpsUrl(initiation.uploadUrl, 'upload_url')
    assertHttpsUrl(initiation.fileUrl, 'file_url')

    const uploadResponse = await transport.fetch(initiation.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': prepared.mimeType },
      body: prepared.bytes.slice().buffer,
      signal: deadline.signal,
    })
    if (!uploadResponse.ok) {
      throw new AiRuntimeError('upload_failed', `Fal signed upload HTTP ${uploadResponse.status}`)
    }
    return initiation.fileUrl
  } catch (error) {
    if (signal?.aborted) {
      throw new AiRuntimeError('cancelled', 'Fal upload cancelled')
    }
    if (deadline.didTimeout()) {
      throw new AiRuntimeError('upload_timeout', `Fal upload exceeded ${FAL_UPLOAD_TIMEOUT_MS}ms`)
    }
    throw error
  } finally {
    deadline.dispose()
  }
}

async function readInitiation(response: Response): Promise<FalUploadInitiation> {
  const payload = await response.json().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new AiRuntimeError('upload_failed', `Fal upload initiation returned invalid JSON: ${message}`)
  }) as JsonValue
  if (!response.ok) {
    throw new AiRuntimeError(
      'upload_failed',
      `Fal upload initiation HTTP ${response.status}: ${JSON.stringify(payload)}`
    )
  }
  if (!isJsonObject(payload)) {
    throw new AiRuntimeError('upload_failed', 'Fal upload initiation returned a non-object response')
  }
  const uploadUrl = typeof payload.upload_url === 'string' ? payload.upload_url : ''
  const fileUrl = typeof payload.file_url === 'string' ? payload.file_url : ''
  if (!uploadUrl || !fileUrl) {
    throw new AiRuntimeError('upload_failed', 'Fal upload initiation response is missing upload_url or file_url')
  }
  return { uploadUrl, fileUrl }
}

function assertHttpsUrl(value: string, field: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new AiRuntimeError('upload_failed', `Fal upload initiation returned an invalid ${field}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new AiRuntimeError('upload_failed', `Fal upload initiation returned a non-HTTPS ${field}`)
  }
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createDeadlineSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal
  didTimeout(): boolean
  dispose(): void
} {
  const controller = new AbortController()
  let timedOut = false
  const abort = (): void => controller.abort()
  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
    },
  }
}
