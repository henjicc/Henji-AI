import { AiRuntimeError } from '../runtime/AiRuntimeError'
import { uploadToFalWithTransport } from './fal-transport'
import { uploadToKie } from './kie-upload'
import type { ProviderMediaRewriteInput } from './preprocess-core'

type PublicHostId = 'kie' | 'fal'

const HOSTS: Readonly<Record<PublicHostId, { label: string; upload: typeof uploadToKie }>> = {
  kie: { label: 'KIE', upload: uploadToKie },
  fal: { label: 'Fal', upload: uploadToFalWithTransport },
}

const MEDIA_LABEL = { image: '图片', video: '视频', audio: '音频', file: '文件' } as const

function isCancelled(error: unknown, signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted)
    || (error instanceof AiRuntimeError && error.code === 'cancelled')
    || (error instanceof Error && error.name === 'AbortError')
}

/**
 * 供应商自己不收本地文件时，借“通用文件上传服务”把文件托管成公网地址。
 * 首选服务来自宿主设置（`__upload_provider`），失败或未配置时按 `__upload_fallback` 换用另一家；
 * 一家都没配置就提示用户去设置里配，不发出生成请求。
 */
export async function uploadToPublicHost(input: ProviderMediaRewriteInput, providerLabel: string): Promise<string> {
  const preferred = input.params.__upload_provider === 'fal' ? 'fal' : 'kie'
  const fallback = typeof input.params.__upload_fallback === 'boolean' ? input.params.__upload_fallback : true
  const order: PublicHostId[] = fallback ? [preferred, preferred === 'kie' ? 'fal' : 'kie'] : [preferred]
  const failures: string[] = []
  const context = { route: input.route, mediaKind: input.mediaKind, mimeType: input.prepared.mimeType, bytes: input.prepared.bytes.byteLength }
  for (const hostId of order) {
    const host = HOSTS[hostId]
    const apiKey = await input.runtime.credentials.get('generation', hostId)
    if (!apiKey) {
      failures.push(`${host.label} 未配置`)
      continue
    }
    input.runtime.logger.info('通用上传服务开始上传本地文件', {
      event: 'ai_runtime.upload.public_host_started', requestId: input.requestId, providerId: input.providerId, context: { ...context, host: hostId },
    })
    try {
      const url = await host.upload(apiKey, input.prepared, input.runtime.transport, input.signal)
      input.runtime.logger.info('通用上传服务上传完成', {
        event: 'ai_runtime.upload.public_host_completed', requestId: input.requestId, providerId: input.providerId, context: { ...context, host: hostId },
      })
      return url
    } catch (error) {
      if (isCancelled(error, input.signal)) throw new AiRuntimeError('cancelled', `${providerLabel} 媒体上传已取消`)
      input.runtime.logger.warn('通用上传服务上传失败', {
        event: 'ai_runtime.upload.public_host_failed', requestId: input.requestId, providerId: input.providerId, context: { ...context, host: hostId }, error,
      })
      failures.push(`${host.label} 上传失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const configured = failures.some((item) => !item.endsWith('未配置'))
  throw new AiRuntimeError(
    'public_media_url_required',
    configured
      ? `${providerLabel} 需要把本地${MEDIA_LABEL[input.mediaKind]}先上传成公网链接，但通用文件上传服务没能完成：${failures.join('；')}`
      : `${providerLabel} 需要把本地${MEDIA_LABEL[input.mediaKind]}先上传成公网链接。请在 设置 → 通用文件上传服务 配置 KIE 或 Fal 的密钥后再试。`,
    { retryable: false, billing: 'not_charged', execution: { notExecuted: true } },
  )
}
