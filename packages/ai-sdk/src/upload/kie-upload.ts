import type { Transport } from '../runtime/Transport'
import { fetchProvider } from '../providers/provider-fetch'
import type { PreparedMediaBinary } from './prepared-media'
import { readUploadJson, readUploadString } from './upload-response'
import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { createDeadlineSignal } from './fal-transport'

const KIE_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload'
const KIE_UPLOAD_TIMEOUT_MS = 120_000

export async function uploadToKie(
  apiKey: string,
  prepared: PreparedMediaBinary,
  transport: Transport,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new AiRuntimeError('cancelled', 'KIE upload cancelled')
  const form = new FormData()
  form.append('uploadPath', 'henji-uploads')
  form.append('file', new Blob([prepared.bytes as BlobPart], {
    type: inferUploadMime(prepared.filename),
  }), prepared.filename)

  const deadline = createDeadlineSignal(signal, KIE_UPLOAD_TIMEOUT_MS)
  try {
    deadline.signal.throwIfAborted()
    const response = await fetchProvider('KIE upload', KIE_UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: deadline.signal,
    }, { transport, retryPreconnectOnce: true })
    const payload = await readUploadJson(response, 'KIE upload')
    deadline.signal.throwIfAborted()
    const fileUrl = readUploadString(payload, '/data/fileUrl')
      ?? readUploadString(payload, '/data/downloadUrl')
    if (!fileUrl) {
      throw new AiRuntimeError('upload_failed', `KIE upload missing file URL: ${JSON.stringify(payload)}`)
    }
    return fileUrl
  } catch (error) {
    if (signal?.aborted) throw new AiRuntimeError('cancelled', 'KIE upload cancelled')
    if (deadline.didTimeout()) throw new AiRuntimeError('upload_timeout', `KIE upload exceeded ${KIE_UPLOAD_TIMEOUT_MS}ms`)
    if (error instanceof Error && error.name === 'AbortError') throw new AiRuntimeError('cancelled', 'KIE upload cancelled')
    throw error
  } finally {
    deadline.dispose()
  }
}

function inferUploadMime(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  return 'application/octet-stream'
}
