import { z } from 'zod'
import { applicationResourceUri, parseApplicationResourceUri } from '../../../../src/core/application-control/resourceReferences'
import type { LocalDomainSurface } from '../../../../src/core/application-control/localHostContracts'
import type { ApplicationToolDispatcher } from '../application-runtime/applicationToolDispatcher'

export const APPLICATION_RESOURCE_TEMPLATES = ['entity', 'text', 'media'].map(format => ({
  uriTemplate: `henji://${format}/{kind}/{id}`, name: `application_${format}`,
  description: format === 'media' ? '业务引用关联的媒体元数据，二进制通过受控分块工具读取。' : format === 'text' ? '工程或文档实体的文本表示。' : '实体的授权属性快照。',
  mimeType: format === 'text' ? 'text/plain' : 'application/json',
}))

const resourceCursorSchema = z.tuple([z.string(), z.string().nullable()])
const entityPageSchema = z.object({
  refs: z.array(z.object({ kind: z.string(), id: z.string() })),
  nextCursor: z.string().nullable(),
})

/** 目录复用领域声明及授权分页，不为 MCP 维护业务类型名单。 */
export async function listApplicationResources(dispatcher: Pick<ApplicationToolDispatcher, 'call'>, callerId: string,
  domains: readonly LocalDomainSurface[], cursor: string | undefined, signal: AbortSignal) {
  const types = [...new Set(domains.filter(domain => domain.readable).flatMap(domain => domain.entities.map(entity => entity.id)))].sort()
  let after: [string, string | null] | undefined
  try { after = cursor ? resourceCursorSchema.parse(JSON.parse(cursor)) : undefined } catch { throw new Error('INVALID_CURSOR:请重新读取资源目录。') }
  const resources: Array<{ uri: string; name: string; mimeType: string }> = []
  for (const entityType of types) {
    if (after && entityType < after[0]) continue
    const innerCursor = after?.[0] === entityType ? after[1] : null
    const result = await dispatcher.call(callerId, 'list_application_entities', {
      entityType, limit: 50 - resources.length, ...(innerCursor ? { cursor: innerCursor } : {}),
    }, signal)
    if (!result.ok) throw new Error(result.error?.message ?? '资源目录读取未完成，请重试。')
    const page = entityPageSchema.parse(result.data)
    for (const ref of page.refs) resources.push({ uri: applicationResourceUri(ref), name: `${ref.kind}:${ref.id}`, mimeType: 'application/json' })
    if (page.nextCursor === innerCursor && page.nextCursor !== null) throw new Error('资源分页没有前进，请重新读取目录。')
    if (page.nextCursor) return { resources, nextCursor: JSON.stringify([entityType, page.nextCursor]) }
    if (resources.length >= 50) {
      const nextType = types[types.indexOf(entityType) + 1]
      return { resources, ...(nextType ? { nextCursor: JSON.stringify([nextType, null]) } : {}) }
    }
  }
  return { resources }
}

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
    ? await dispatcher.readMedia(callerId, { ref }, signal, true)
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
