import { buildApiMartEndpoints } from '../providers/endpoints/apimart'
import { fetchProvider } from '../providers/provider-fetch'
import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type { Transport } from '../runtime/Transport'
import type { PreparedMediaBinary } from './prepared-media'
import { readUploadJson, readUploadString } from './upload-response'

const APIMART_MAX_IMAGE_BYTES = 20 * 1024 * 1024
const APIMART_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export async function uploadToApiMart(
  apiKey: string,
  prepared: PreparedMediaBinary,
  transport: Transport
): Promise<string> {
  if (!APIMART_IMAGE_MIME_TYPES.has(prepared.mimeType)) {
    throw new AiRuntimeError(
      'unsupported_media_type',
      `APIMart 图片上传仅支持 JPEG、PNG、WebP、GIF，当前类型为 ${prepared.mimeType}。`
    )
  }
  if (prepared.bytes.byteLength > APIMART_MAX_IMAGE_BYTES) {
    throw new AiRuntimeError(
      'upload_too_large',
      `APIMart 图片上传上限为 20 MB，当前文件为 ${prepared.bytes.byteLength} bytes。`
    )
  }
  const form = new FormData()
  form.append('file', new Blob([prepared.bytes as BlobPart], { type: prepared.mimeType }), prepared.filename)
  const endpoints = buildApiMartEndpoints('/v1/uploads/images')
  const response = await fetchProvider('APIMart image upload', endpoints[0], {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, {
    transport,
    retryPreconnectOnce: true,
    fallbackEndpoints: endpoints.slice(1),
  })
  const payload = await readUploadJson(response, 'APIMart image upload')
  const fileUrl = readUploadString(payload, '/url') ?? readUploadString(payload, '/data/url')
  if (!fileUrl) {
    throw new AiRuntimeError('upload_failed', `APIMart image upload missing file URL: ${JSON.stringify(payload)}`)
  }
  return fileUrl
}
