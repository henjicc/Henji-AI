import { resolvePpioMediaRewriteMode } from '../../providers/ppio-media'
import { AiRuntimeError } from '../../runtime/AiRuntimeError'
import { toBase64, toDataUri } from '../base64'
import { uploadToKie } from '../kie-upload'
import type { ProviderMediaRewriteInput } from '../preprocess-core'
import { createGenerationPreprocessor } from './factory'

export const strategy = {
  async rewrite(input) {
    const mode = resolvePpioMediaRewriteMode(
      input.route,
      input.fieldName,
      input.mediaKind === 'video'
    )
    if (mode === 'raw-base64') return toBase64(input.prepared.bytes)
    if (mode === 'data-uri') return toDataUri(input.prepared.bytes, input.prepared.mimeType)
    return await uploadPublicUrl(input)
  },
  async preprocessObject({ route, object, rewrite }) {
    if (route !== '/async/wan2.7-r2v') return
    const type = typeof object.type === 'string' ? object.type : ''
    const kind = type === 'reference_video'
      ? 'video'
      : (type === 'reference_image' || type === 'first_frame' ? 'image' : undefined)
    if (kind && typeof object.url === 'string') {
      object.url = await rewrite(kind, 'url', object.url)
    }
    if (typeof object.reference_voice === 'string') {
      object.reference_voice = await rewrite('audio', 'reference_voice', object.reference_voice)
    }
  },
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)

async function uploadPublicUrl(input: ProviderMediaRewriteInput): Promise<string> {
  const primary = typeof input.params.__upload_provider === 'string'
    ? input.params.__upload_provider.trim()
    : ''
  const fallback = typeof input.params.__upload_fallback === 'boolean'
    ? input.params.__upload_fallback
    : true
  const allowKie = primary === 'kie' || (!primary && fallback) || (primary !== 'kie' && fallback)
  const failures: string[] = []
  if (allowKie) {
    const apiKey = await input.runtime.credentials.get('generation', 'kie')
    if (apiKey) {
      try {
        return await uploadToKie(apiKey, input.prepared, input.runtime.transport)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`KIE 上传失败: ${message}`)
      }
    } else {
      failures.push('KIE 未配置')
    }
  }
  throw new AiRuntimeError(
    'public_media_url_required',
    `当前 PPIO 模型字段要求公网 HTTP/HTTPS 媒体 URL。请直接传入公网 URL，或配置 KIE API Key。${failures.join('；')}`
  )
}
