import type { ApplicationCollectionExecutor, ApplicationEntityProvider, ApplicationEntityRegistration, ApplicationPlannedStep, ApplicationCompletedStepResult, ApplicationPropertyDescriptor, ApplicationRef } from '@/core/application-control'
import { unrestrictedCollectionAvailability } from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { MEDIA_CACHE_CATEGORIES, type MediaCacheCategory, type MediaCacheUsage } from '@/core/media/mediaCache'
import { getPlatform } from '@/platform/runtime'

const ENTITY = 'settings.media_cache'
const scope = 'media_cache'
const NAMES: Record<MediaCacheCategory, string> = { render: '预渲染', proxy: '代理', analysis: '智能分析', preview: '缩略图与波形', audio_edit: '音频编辑' }
let revision = 0
let signature = ''
/** 只列出眼下有文件的类别：清空的一类就不再存在，移除后的验证与读回一致。 */
async function present(): Promise<MediaCacheUsage['categories']> {
  const value = await getPlatform().mediaCache.usage()
  const items = MEDIA_CACHE_CATEGORIES.flatMap(category => value.categories.filter(item => item.category === category && (item.files > 0 || item.bytes > 0)))
  // 修订号只随“有哪些类别”变：播放、生成代理时缓存字节一直在变，按字节递增会让清除动不动撞上修订冲突。
  const next = items.map(item => item.category).join(',')
  if (next !== signature) { signature = next; revision++ }
  return items
}
const isCategory = (id: string): id is MediaCacheCategory => (MEDIA_CACHE_CATEGORIES as readonly string[]).includes(id)
const schemaRef = (kind: 'entity' | 'property', id: string): ApplicationPropertyDescriptor['schemaRef'] => ({
  catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1,
  digest: `sha256:${[...id].reduce((value, character) => (value * 33 + character.charCodeAt(0)) >>> 0, 5381).toString(16).padEnd(64, '0')}`,
})
const readOnlyReason = '占用由缓存服务统计；从本集合移除某一类即清除这类缓存，容量上限与自动清理在 settings.registry 的 storage.cache_* 设置里改。'
const properties: ApplicationPropertyDescriptor[] = [
  { suffix: 'name', title: '名称', kind: 'string' as const },
  { suffix: 'bytes', title: '占用字节', kind: 'number' as const },
  { suffix: 'files', title: '文件数', kind: 'number' as const },
].map(({ suffix, title, kind }) => ({
  id: `${ENTITY}.${suffix}`, entityType: ENTITY, version: 1, title, description: title,
  value: { kind }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
  requiredPermissions: { read: ['settings:read'], write: [] }, revisionScopes: [scope],
  schemaRef: schemaRef('property', `${ENTITY}.${suffix}`), readOnlyReason,
}))

class MediaCacheProvider implements ApplicationEntityProvider {
  readonly entityType = ENTITY
  async listEntities(request: { cursor?: string; limit: number }) {
    const items = await present(), offset = Number(request.cursor ?? 0), page = items.slice(offset, offset + request.limit)
    return { refs: page.map(item => ({ kind: ENTITY, id: item.category, label: NAMES[item.category] })), nextCursor: offset + page.length < items.length ? String(offset + page.length) : null, revisions: { [scope]: revision } }
  }
  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    const item = ref.kind === ENTITY ? (await present()).find(entry => entry.category === ref.id) : undefined
    if (!item) throw new Error('NOT_FOUND')
    const values = { [`${ENTITY}.name`]: NAMES[item.category], [`${ENTITY}.bytes`]: item.bytes, [`${ENTITY}.files`]: item.files }
    return { ref, entityType: ENTITY, revisions: { [scope]: revision }, properties: Object.fromEntries(Object.entries(values).filter(([id]) => !request.propertyIds || request.propertyIds.includes(id))), capturedAt: new Date().toISOString() }
  }
  async getPropertyAvailability(ref: ApplicationRef, ids: string[]) {
    await this.readEntity(ref, {})
    return ids.map(propertyId => ({ propertyId, readable: true, writable: false, reasons: [readOnlyReason], requiredPermissions: ['settings:read'], revisions: { [scope]: revision } }))
  }
  async getCollectionAvailability(parent: ApplicationRef) {
    return unrestrictedCollectionAvailability(ENTITY, parent, { [scope]: revision }, ['settings:write'])
  }
}

export function createMediaCacheReflectionRegistration(): ApplicationEntityRegistration {
  return {
    entity: { id: ENTITY, domain: 'settings', version: 1, title: '缓存', description: '数据目录下可重建的缓存（预渲染、代理、智能分析、缩略图与波形、音频编辑处理结果），只列出眼下有文件的类别（清空的一类不出现）。remove 某一类即清除它，作品不受影响，之后用到时自动重新生成（期间播放可能不够流畅）；不进回收区。正在使用的文件会跳过，这一类就仍然存在，稍后可再移除一次。', refKind: ENTITY,
      dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: ['settings.registry'], revisionScopes: [scope], queryCapabilityIds: ['list_application_entities'], schemaRef: schemaRef('entity', ENTITY),
      collectionWrite: { creatable: false, removable: true, requiredPropertyIds: [] } },
    properties, provider: new MediaCacheProvider(),
  }
}

export class MediaCacheCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = ENTITY
  readonly effectContract = { direct: [], cascades: [] }
  async apply(step: Extract<ApplicationPlannedStep, { kind: 'collection' }>): Promise<ApplicationCompletedStepResult> {
    if (step.operation.kind !== 'remove') throw new Error('缓存只支持移除（清除这一类）；新增由用到时自动生成。')
    const categories = step.operation.targets.map(target => {
      if (target.kind !== ENTITY || !isCategory(target.id)) throw new Error(`没有这类缓存：${target.id}。可用：${MEDIA_CACHE_CATEGORIES.join('、')}`)
      return target.id
    })
    const all = (await present()).every(item => categories.includes(item.category))
    const results = []
    for (const category of all ? ['all' as const] : [...new Set(categories)]) results.push(await getPlatform().mediaCache.clear(category))
    const total = results.reduce((sum, item) => ({ removedFiles: sum.removedFiles + item.removedFiles, removedBytes: sum.removedBytes + item.removedBytes, skippedFiles: sum.skippedFiles + item.skippedFiles }), { removedFiles: 0, removedBytes: 0, skippedFiles: 0 })
    await present()
    const fact = total.skippedFiles ? `已清除 ${total.removedFiles} 个文件；${total.skippedFiles} 个正在使用，已跳过，稍后可再清一次。` : `已清除 ${total.removedFiles} 个文件。`
    return { status: 'completed', resultingRevisions: { [scope]: revision }, directRefs: step.operation.targets,
      evidence: [{ kind: 'operation_result', target: step.parent, fact, data: total, capturedAt: new Date().toISOString() }] }
  }
}
