import type { CapabilityMediaSource } from '../../media'
import { readCapabilityMediaSource } from '../../media'
import { assertMediaSize, rethrowMediaError } from '../../../runtime/MediaReader'
import type { CapabilityExecutionContext } from '../../types'
import { AiRuntimeError } from '../../../runtime/AiRuntimeError'
import type { SpeechRecognitionEvent } from '..'

type Context = CapabilityExecutionContext<SpeechRecognitionEvent>
type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function requiredString(record: UnknownRecord | undefined, key: string): string {
  const value = record?.[key]
  if (typeof value !== 'string' || !value) {
    throw new AiRuntimeError('invalid_response', `Bailian upload policy has no ${key}`)
  }
  return value
}

async function json(response: Response, operation: string): Promise<unknown> {
  const body = await response.text()
  if (!response.ok) {
    throw new AiRuntimeError('provider_http_error', `Bailian ${operation} failed with HTTP ${response.status}`)
  }
  try { return JSON.parse(body) } catch {
    throw new AiRuntimeError('invalid_response', `Bailian ${operation} returned invalid JSON`)
  }
}

export async function resolveAsyncAudioUrl(
  source: CapabilityMediaSource,
  modelId: string,
  apiKey: string,
  apiBaseUrl: string,
  context: Context
): Promise<{ url: string; usesOss: boolean }> {
  if (source.kind === 'remote-url') {
    const value = source.url.trim()
    if (value.startsWith('oss://')) return { url: value, usesOss: true }
    let parsed: URL
    try { parsed = new URL(value) } catch {
      throw new AiRuntimeError('invalid_media_url', 'Bailian ASR media URL is invalid')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new AiRuntimeError('invalid_media_url', 'Bailian ASR media URL must use HTTP(S) or oss://')
    }
    return { url: parsed.toString(), usesOss: false }
  }

  if (source.kind === 'media-ref' && !context.runtime.transport.uploadFile) {
    throw new AiRuntimeError('native_upload_unsupported', '长音频上传需要宿主接入原生文件直传；请升级宿主适配器')
  }
  const policyResponse = await context.runtime.transport.fetch(
    `${apiBaseUrl}/uploads?action=getPolicy&model=${encodeURIComponent(modelId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` }, signal: context.signal }
  )
  const policyPayload = asRecord(await json(policyResponse, 'upload policy'))
  const policy = asRecord(policyPayload?.data)
  const uploadHost = requiredString(policy, 'upload_host')
  let host: URL
  try { host = new URL(uploadHost) } catch {
    throw new AiRuntimeError('invalid_response', 'Bailian upload_host is invalid')
  }
  if (host.protocol !== 'https:') throw new AiRuntimeError('invalid_response', 'Bailian upload_host must use HTTPS')
  const uploadDir = requiredString(policy, 'upload_dir').replace(/^\/+|\/+$/g, '')
  const rawLimit = policy?.max_file_size_mb
  const maxFileSizeMb = typeof rawLimit === 'number' || typeof rawLimit === 'string' ? Number(rawLimit) : NaN
  if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) {
    throw new AiRuntimeError('invalid_response', 'Bailian upload policy has invalid max_file_size_mb')
  }
  // Official temporary storage ceiling is 1 GB; use decimal bytes conservatively.
  const maxBytes = Math.min(1_000_000_000, Math.floor(maxFileSizeMb * 1_000_000))
  const objectKey = `${uploadDir}/${context.requestId.replace(/[^A-Za-z0-9._-]/g, '_')}-${Date.now()}-audio`
  const fields: [string, string][] = []
  const form = { append: (key: string, value: string): void => { fields.push([key, value]) } }
  form.append('OSSAccessKeyId', requiredString(policy, 'oss_access_key_id'))
  form.append('Signature', requiredString(policy, 'signature'))
  form.append('policy', requiredString(policy, 'policy'))
  form.append('x-oss-object-acl', requiredString(policy, 'x_oss_object_acl'))
  form.append('x-oss-forbid-overwrite', requiredString(policy, 'x_oss_forbid_overwrite'))
  form.append('key', objectKey)
  form.append('success_action_status', '200')
  context.runtime.logger.info('百炼音频上传开始', {
    event: 'capability.bailian_asr.upload.start', requestId: context.requestId, providerId: 'bailian', modelId,
  })
  let uploadResponse: Response
  if (source.kind === 'media-ref') {
    uploadResponse = await context.runtime.transport.uploadFile!(host.toString(), {
      ref: source.ref, fields, fileField: 'file', maxBytes, signal: context.signal,
    }).catch(rethrowMediaError)
  } else {
    const media = await readCapabilityMediaSource(source, context.runtime.media)
    assertMediaSize({ size: media.bytes.byteLength, mimeType: media.mimeType, filename: media.filename }, maxBytes)
    const multipart = new FormData()
    for (const [key, value] of fields) multipart.append(key, value)
    multipart.append('file', new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }), media.filename)
    uploadResponse = await context.runtime.transport.fetch(host.toString(), {
      method: 'POST', body: multipart, signal: context.signal,
    })
  }
  if (!uploadResponse.ok) {
    throw new AiRuntimeError('upload_failed', `Bailian OSS upload failed with HTTP ${uploadResponse.status}`)
  }
  context.runtime.logger.info('百炼音频上传完成', {
    event: 'capability.bailian_asr.upload.completed', requestId: context.requestId,
    providerId: 'bailian', modelId,
  })
  return { url: `oss://${objectKey}`, usesOss: true }
}
