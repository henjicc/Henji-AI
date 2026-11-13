import { describe, expect, it } from 'vitest'

import type { ApplicationRef, JsonValue } from '../identifiers'
import { unrestrictedCollectionAvailability, type ApplicationPropertyDescriptor } from '../reflection'
import { ApplicationReflectionRegistry } from './registry'
import { readApplicationSnapshot } from './snapshot'
import type { ApplicationEntityProvider, ApplicationEntityRegistration } from './types'

const catalogVersion = 'application-capabilities/v2'
const digest = `sha256:${'a'.repeat(64)}`
const schemaRef = (kind: 'entity' | 'property', id: string) => ({ catalogVersion, kind, id, version: 1, digest }) as const
const context = { exposure: 'assistant' as const, acceptedDataClasses: new Set(['C0', 'C1'] as const) }

interface Row { id: string; parent?: string; values: Record<string, JsonValue> }

/** 可注入的故障：读某个实体时抛错、列某一类成员时抛错。 */
interface Faults { read?: Record<string, string>; list?: Record<string, string> }

/** 一个小世界：文档 → 序列 → 片段（→ 效果）、标记；另有目录型与没法按父列出的子类型。 */
function world(rows: Record<string, Row[]>, faults: Faults = {}) {
  const registry = new ApplicationReflectionRegistry(catalogVersion)
  const property = (entityType: string, key: string, value: ApplicationPropertyDescriptor['value'], extra: Partial<ApplicationPropertyDescriptor> = {}): ApplicationPropertyDescriptor => ({
    id: `${entityType}.${key}`, entityType, version: 1, title: `${key} 标题`, description: `${key}。`, value, nullable: false, dataClass: 'C1',
    exposures: ['ui', 'assistant'], requiredPermissions: { read: ['demo:read'], write: ['demo:write'] }, revisionScopes: ['demo'], schemaRef: schemaRef('property', `${entityType}.${key}`), ...extra,
  })
  const provider = (entityType: string, listsByParent: boolean): ApplicationEntityProvider => ({
    entityType, ...(listsByParent ? { listsByParent: true as const } : {}),
    async listEntities(request) {
      if (faults.list?.[entityType]) throw new Error(faults.list[entityType])
      const all = (rows[entityType] ?? []).filter(row => !request.parent || row.parent === request.parent.id)
      const start = Number(request.cursor ?? 0), end = start + request.limit
      return { refs: all.slice(start, end).map(row => ({ kind: entityType, id: row.id, label: String(row.values[`${entityType}.name`] ?? row.id) })), nextCursor: end < all.length ? String(end) : null, revisions: { demo: 1 } }
    },
    async readEntity(ref, request) {
      const row = (rows[entityType] ?? []).find(item => item.id === ref.id)
      if (faults.read?.[ref.id]) throw new Error(faults.read[ref.id])
      if (!row) throw new Error('NOT_FOUND')
      const selected = new Set(request.propertyIds ?? Object.keys(row.values))
      return { ref, entityType, revisions: { demo: 1 }, properties: Object.fromEntries(Object.entries(row.values).filter(([id]) => selected.has(id))), capturedAt: '2026-08-01T00:00:00.000Z' }
    },
    async getPropertyAvailability(_ref, propertyIds) { return propertyIds.map(propertyId => ({ propertyId, readable: true, writable: true, reasons: [], requiredPermissions: [], revisions: { demo: 1 } })) },
    async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(entityType, parent, { demo: 1 }) },
  })
  const register = (entityType: string, parentTypes: string[], properties: ApplicationPropertyDescriptor[], options: { listsByParent?: boolean; entity?: Partial<ApplicationEntityRegistration['entity']> } = {}): void => {
    registry.register({
      entity: { id: entityType, domain: 'demo', version: 1, title: entityType, description: '演示实体。', refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant'],
        parentTypes, revisionScopes: ['demo'], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', entityType), ...options.entity },
      properties, provider: provider(entityType, options.listsByParent ?? true),
    })
  }
  register('demo.document', [], [property('demo.document', 'name', { kind: 'string' }), property('demo.document', 'zoom', { kind: 'number' }, { viewState: true })])
  register('demo.sequence', ['demo.document'], [property('demo.sequence', 'name', { kind: 'string' })], { entity: { collectionWrite: { creatable: true, removable: true, requiredPropertyIds: ['demo.sequence.name'] } } })
  register('demo.clip', ['demo.sequence'], [
    property('demo.clip', 'name', { kind: 'string' }),
    property('demo.clip', 'start', { kind: 'integer', hardRange: { min: 0 } }, { unit: '帧' }),
    property('demo.clip', 'opacity', { kind: 'number', hardRange: { min: 0, max: 1 } }),
    property('demo.clip', 'note', { kind: 'string' }),
    property('demo.clip', 'kind', { kind: 'enum', values: [{ value: 'video', label: '视频' }, { value: 'text', label: '文字' }] }, { requiredPermissions: { read: ['demo:read'], write: [] }, readOnlyReason: '由素材决定。' }),
  ], { entity: { description: '时间线上的一段素材。', collectionWrite: { creatable: true, removable: true, requiredPropertyIds: ['demo.clip.start'] } } })
  register('demo.effect', ['demo.clip'], [property('demo.effect', 'name', { kind: 'string' })])
  register('demo.marker', ['demo.sequence'], [property('demo.marker', 'frame', { kind: 'integer' })], { entity: { collectionWrite: { creatable: true, removable: true, requiredPropertyIds: ['demo.marker.frame'] } } })
  register('demo.preset', ['demo.document'], [property('demo.preset', 'name', { kind: 'string' })], { entity: { omitFromDefaultSnapshot: true } })
  register('demo.loose', ['demo.document'], [property('demo.loose', 'name', { kind: 'string' })], { listsByParent: false })
  return registry
}

const clip = (id: string, start: number, opacity = 1, name = '片段'): Row => ({ id, parent: 's1', values: { 'demo.clip.name': name, 'demo.clip.start': start, 'demo.clip.opacity': opacity, 'demo.clip.note': '', 'demo.clip.kind': 'video' } })
const base = (clips: Row[]): Record<string, Row[]> => ({
  'demo.document': [{ id: 'd1', values: { 'demo.document.name': '演示', 'demo.document.zoom': 2 } }],
  'demo.sequence': [{ id: 's1', parent: 'd1', values: { 'demo.sequence.name': '序列 1' } }, { id: 's-other', parent: 'd-other', values: { 'demo.sequence.name': '别的文档' } }],
  'demo.clip': clips,
  'demo.preset': [{ id: 'p1', parent: 'd1', values: { 'demo.preset.name': '预设' } }],
  'demo.loose': [{ id: 'l1', values: { 'demo.loose.name': '散件' } }],
})
const root: ApplicationRef = { kind: 'demo.document', id: 'd1' }

describe('readApplicationSnapshot', () => {
  it('一次读回只属于根实体的层级：相同的值提到 shared，空值与界面状态不带，并给出新建必填项', async () => {
    const registry = world(base([clip('c1', 0), clip('c2', 30, 0.5), clip('c3', 60)]))
    const result = await readApplicationSnapshot(registry, { root, limit: 300 }, context)

    expect(result.root).toEqual({
      ref: root, properties: { name: '演示' },
      children: { 'demo.sequence': [{ ref: { kind: 'demo.sequence', id: 's1' }, properties: { name: '序列 1' }, children: { 'demo.clip': [
        { ref: { kind: 'demo.clip', id: 'c1' }, properties: { start: 0, opacity: 1 } },
        { ref: { kind: 'demo.clip', id: 'c2' }, properties: { start: 30, opacity: 0.5 } },
        { ref: { kind: 'demo.clip', id: 'c3' }, properties: { start: 60, opacity: 1 } },
      ] } }] },
    })
    expect(result.entityCount).toBe(5)
    expect(result.types['demo.clip']).toEqual({
      title: 'demo.clip', description: '时间线上的一段素材。', removable: true,
      create: { under: ['demo.sequence'], required: { start: 'integer ≥0 帧' } },
      properties: { name: 'name 标题｜string', start: 'start 标题｜integer ≥0 帧', opacity: 'opacity 标题｜number 0–1', kind: 'kind 标题｜"video" | "text"｜只读' },
      shared: { name: '片段', kind: 'video' }, unset: ['note'],
    })
    // 这次没有实例的类型只说怎么新建；界面状态要点名才返回
    expect(result.types['demo.marker']).toEqual({ title: 'demo.marker', removable: true, create: { under: ['demo.sequence'], required: { frame: 'integer' } } })
    expect(result.types['demo.document'].onRequest).toEqual(['zoom'])
    // 目录型与没法按父列出的类型默认不展开，但让调用方知道它们存在
    expect(result.notExpanded).toEqual(['demo.preset', 'demo.loose'])
    expect(result.incomplete).toBeUndefined()
  })

  it('点名类型与属性时按点名返回；点名了没法按父列出的类型就如实不展开', async () => {
    const registry = world(base([clip('c1', 0), clip('c2', 30)]))
    const named = await readApplicationSnapshot(registry, { root, limit: 300, entityTypes: ['demo.clip', 'demo.preset'], properties: { 'demo.clip': ['start', 'demo.clip.note'], 'demo.document': ['zoom'] } }, context)
    expect(named.root.properties).toEqual({ zoom: 2 })
    expect(named.root.children?.['demo.preset']).toEqual([{ ref: { kind: 'demo.preset', id: 'p1' }, properties: { name: '预设' } }])
    // 通往片段的序列照常展开，点名的属性原样返回（含空值），不做 shared 归并
    expect(named.root.children?.['demo.sequence'][0].children?.['demo.clip']).toEqual([
      { ref: { kind: 'demo.clip', id: 'c1' }, properties: { start: 0, note: '' } },
      { ref: { kind: 'demo.clip', id: 'c2' }, properties: { start: 30, note: '' } },
    ])
    expect(named.types['demo.clip'].shared).toBeUndefined()

    const loose = await readApplicationSnapshot(registry, { root, limit: 300, entityTypes: ['demo.loose'] }, context)
    expect(loose.root.children).toBeUndefined()
    expect(loose.notExpanded).toContain('demo.loose')
    await expect(readApplicationSnapshot(registry, { root, limit: 300, entityTypes: ['demo.clips'] }, context)).rejects.toThrow('demo.clip')
  })

  it('成员超过 limit 时小集合先读全，没读完的在所属节点给出续读参数，续读接上且不重不漏', async () => {
    const clips = Array.from({ length: 7 }, (_, index) => clip(`c${index}`, index * 10))
    const rows = { ...base(clips), 'demo.marker': [{ id: 'm1', parent: 's1', values: { 'demo.marker.frame': 5 } }] }
    const registry = world(rows)
    // 根、序列各占一个，剩 4 个名额：标记只有一个先读全，片段读 3 个
    const first = await readApplicationSnapshot(registry, { root, limit: 6 }, context)
    const sequence = first.root.children!['demo.sequence'][0]
    expect(sequence.children!['demo.marker']).toHaveLength(1)
    expect(sequence.children!['demo.clip'].map(node => node.ref.id)).toEqual(['c0', 'c1', 'c2'])
    expect(sequence.more).toEqual([{ root: { kind: 'demo.sequence', id: 's1' }, cursor: 'demo.clip@3' }])
    expect(first.incomplete).toContain('more')

    const rest = await readApplicationSnapshot(registry, { ...sequence.more![0], limit: 300 }, context)
    expect(rest.root.children!['demo.clip'].map(node => node.ref.id)).toEqual(['c3', 'c4', 'c5', 'c6'])
    expect(rest.root.more).toBeUndefined()
    // 游标只认 more 给出的形态，且那一类必须是根实体的直接成员
    await expect(readApplicationSnapshot(registry, { root, limit: 300, cursor: '3' }, context)).rejects.toThrow('INVALID_CURSOR')
    await expect(readApplicationSnapshot(registry, { root, limit: 300, cursor: 'demo.clip@3' }, context)).rejects.toThrow('INVALID_CURSOR')
  })

  it('续读只接着读 more 指的那一类并照常展开它的子层，根下其余类型不重读；额度再小游标也前进', async () => {
    const clips = Array.from({ length: 5 }, (_, index) => clip(`c${index}`, index * 10))
    const rows = { ...base(clips),
      'demo.effect': clips.map(item => ({ id: `e-${item.id}`, parent: item.id, values: { 'demo.effect.name': `效果 ${item.id}` } })),
      'demo.marker': [{ id: 'm1', parent: 's1', values: { 'demo.marker.frame': 5 } }] }
    const registry = world(rows)
    // 根、序列、标记各一个，片段只读到 c0，它的效果没有额度
    const first = await readApplicationSnapshot(registry, { root, limit: 4 }, context)
    const sequence = first.root.children!['demo.sequence'][0]
    expect(sequence.more).toEqual([{ root: sequence.ref, cursor: 'demo.clip@1' }])
    expect(sequence.children!['demo.clip'][0].more).toEqual([{ root: { kind: 'demo.clip', id: 'c0' }, cursor: 'demo.effect@0' }])

    const rest = await readApplicationSnapshot(registry, { ...sequence.more![0], limit: 300 }, context)
    expect(Object.keys(rest.root.children!)).toEqual(['demo.clip'])
    expect(rest.root.children!['demo.clip'].map(node => [node.ref.id, node.children!['demo.effect'][0].ref.id])).toEqual(
      ['c1', 'c2', 'c3', 'c4'].map(id => [id, `e-${id}`]))

    // 额度只够根实体自己：续读的那一类仍读一个，游标从 1 走到 2
    const tight = await readApplicationSnapshot(registry, { ...sequence.more![0], limit: 1 }, context)
    expect(tight.root.children!['demo.clip'].map(node => node.ref.id)).toEqual(['c1'])
    expect(tight.root.more).toEqual([{ root: sequence.ref, cursor: 'demo.clip@2' }])

    // 首次限了层数时，续读参数带上从该节点起还剩的层数，续读不会比首次多展开一层
    const shallow = await readApplicationSnapshot(registry, { root, limit: 4, depth: 2 }, context)
    const more = shallow.root.children!['demo.sequence'][0].more![0]
    expect(more).toEqual({ root: sequence.ref, cursor: 'demo.clip@1', depth: 1 })
    const shallowRest = await readApplicationSnapshot(registry, { ...more, limit: 300 }, context)
    expect(shallowRest.root.children!['demo.clip'].every(node => node.children === undefined)).toBe(true)
  })

  it('个别实体读不到、某一类成员列不出时标在所在节点上，其余照常返回；根实体读不到整体失败', async () => {
    const rows = { ...base([clip('c1', 0), clip('c2', 30), clip('c3', 60)]),
      'demo.effect': [{ id: 'e1', parent: 'c1', values: { 'demo.effect.name': '效果' } }],
      'demo.marker': [{ id: 'm1', parent: 's1', values: { 'demo.marker.frame': 5 } }] }
    // c2 在列出之后被删；标记整类读取出错；预设的 provider 自己说不能按这个父类型列
    const registry = world(rows, { read: { c2: 'NOT_FOUND' }, list: { 'demo.marker': '磁盘读取失败', 'demo.preset': 'PARENT_FILTER_UNSUPPORTED:demo.preset 不能按 demo.document 列出。' } })
    const result = await readApplicationSnapshot(registry, { root, limit: 300, entityTypes: ['demo.clip', 'demo.effect', 'demo.marker', 'demo.preset'] }, context)
    const sequence = result.root.children!['demo.sequence'][0]
    expect(sequence.failed).toEqual({ 'demo.marker': '磁盘读取失败' })
    const [c1, c2, c3] = sequence.children!['demo.clip']
    expect(c2).toEqual({ ref: { kind: 'demo.clip', id: 'c2' }, error: expect.stringContaining('ENTITY_NOT_FOUND') })
    expect(c1.children!['demo.effect']).toHaveLength(1)
    expect(c3.properties).toEqual({ start: 60 })
    // 读不到的那个不参与“都相同的值”的归并
    expect(result.types['demo.clip'].shared).toMatchObject({ name: '片段' })
    expect(result.notExpanded).toContain('demo.preset')
    expect(result.root.failed).toBeUndefined()

    await expect(readApplicationSnapshot(world(rows, { read: { d1: 'NOT_FOUND' } }), { root, limit: 300 }, context)).rejects.toThrow('ENTITY_NOT_FOUND')
  })

  it('depth 限制展开层数', async () => {
    const registry = world(base([clip('c1', 0)]))
    const shallow = await readApplicationSnapshot(registry, { root, limit: 300, depth: 1 }, context)
    expect(shallow.root.children!['demo.sequence'][0].children).toBeUndefined()
    expect(shallow.types['demo.clip']).toBeUndefined()
  })
})
