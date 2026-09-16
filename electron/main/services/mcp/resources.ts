import { parseApplicationResourceUri } from '../../../../src/core/application-control/resourceReferences'
import type { ApplicationToolDispatcher } from '../application-runtime/applicationToolDispatcher'

export const APPLICATION_RESOURCE_TEMPLATES = ['entity', 'text', 'media'].map(format => ({
  uriTemplate: `henji://${format}/{kind}/{id}`, name: `application_${format}`,
  description: format === 'media' ? '业务引用关联的媒体元数据，二进制通过受控分块工具读取。' : format === 'text' ? '工程或文档实体的文本表示。' : '实体的授权属性快照。',
  mimeType: format === 'text' ? 'text/plain' : 'application/json',
}))

/** 资源只投影正式读取结果，本机文件地址不会成为资源内容或 URI。 */
function resourceValue(value: unknown): unknown {
  if (typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\|file:|henji-media:|\/)/i.test(value)) return '[关联媒体：请使用业务引用读取]'
  if (Array.isArray(value)) return value.map(resourceValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resourceValue(item)]))
  return value
}

export async function readApplicationResource(dispatcher: ApplicationToolDispatcher, callerId: string, uri: string, signal: AbortSignal) {
  const { ref, format } = parseApplicationResourceUri(uri)
  const result = format === 'media'
    ? await dispatcher.call(callerId, 'read_application_media', { ref, length: 1 }, signal)
    : await dispatcher.call(callerId, 'read_application_entity', { ref }, signal)
  if (!result.ok) throw new Error(result.error?.message ?? '资源读取未完成，请查询原目标状态。')
  let value: unknown = result.data
  if (format === 'media') {
    const media = result.data ?? {}
    value = { ref, mimeType: media.mimeType, totalBytes: media.totalBytes }
  }
  const text = JSON.stringify(resourceValue(value), null, 2)
  return { contents: [{ uri, mimeType: format === 'text' ? 'text/plain' : 'application/json', text }] }
}
