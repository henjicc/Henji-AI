import type { CapabilityMediaSource } from '../../media'
import { readCapabilityMediaSource } from '../../media'
import { assertMediaSize, rethrowMediaError } from '../../../runtime/MediaReader'
import type { CapabilityExecutionContext } from '../../types'
import { AiRuntimeError } from '../../../runtime/AiRuntimeError'
import { requestBailianUploadTarget } from '../../../upload/bailian-oss-upload'
import type { SpeechRecognitionEvent } from '..'

type Context = CapabilityExecutionContext<SpeechRecognitionEvent>

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
    throw new AiRuntimeError('native_upload_unsupported', '宿主未提供本地文件直传；请升级宿主适配器', {
      retryable: false, billing: 'not_charged', execution: { notExecuted: true },
    })
  }
  const target = await requestBailianUploadTarget({
    transport: context.runtime.transport, apiKey, modelId, apiBaseUrl,
    objectName: `${context.requestId}-${Date.now()}-audio`, signal: context.signal,
  })
  const { fields, maxBytes, objectKey } = target
  context.runtime.logger.info('百炼音频上传开始', {
    event: 'capability.bailian_asr.upload.start', requestId: context.requestId, providerId: 'bailian', modelId,
  })
  let uploadResponse: Response
  if (source.kind === 'media-ref') {
    uploadResponse = await context.runtime.transport.uploadFile!(target.uploadUrl, {
      ref: source.ref, fields, fileField: 'file', maxBytes, signal: context.signal,
    }).catch(rethrowMediaError)
  } else {
    const media = await readCapabilityMediaSource(source, context.runtime.media)
    assertMediaSize({ size: media.bytes.byteLength, mimeType: media.mimeType, filename: media.filename }, maxBytes)
    const multipart = new FormData()
    for (const [key, value] of fields) multipart.append(key, value)
    multipart.append('file', new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }), media.filename)
    uploadResponse = await context.runtime.transport.fetch(target.uploadUrl, {
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
