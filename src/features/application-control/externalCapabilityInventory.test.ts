import { describe, expect, it } from 'vitest'
import { ApplicationReflectionRegistry } from '@/core/application-control'
import { externalWritable, externalWritableEntityTypes } from '@/core/application-control/localHostContracts'
import { buildExternalCapabilityInventory } from './externalCapabilityInventory'

/**
 * 外部能力清单核对表——**机器执行的那一份**。
 *
 * 3.1 要求逐项比对"1.1 确定的外部能力边界"与当前真实注册表，并且未完成的不能伪装成有意排除。
 * 写成文档只在有人去读的时候成立，所以边界本身在这里被钉死：八个业务写域必须都可写、有意
 * 只读的域必须带得住理由、助手内部运行目录必须一个都不出现。
 */
const BUSINESS_WRITE_DOMAINS = ['assets', 'camera_stage', 'canvas', 'generation', 'image_edit', 'image_mark', 'models', 'settings'] as const
const INTENTIONAL_READ_ONLY_DOMAINS = ['storyboard', 'toolbox'] as const
const NEVER_EXPOSED_DOMAINS = ['assistant_runtime', 'artifacts'] as const

describe('外部能力面派生自真实注册表', () => {
  const domains = buildExternalCapabilityInventory()
  const byId = new Map(domains.map((domain) => [domain.id, domain]))

  it('八个业务写域全部可读可写，且各自至少有一个真正能写的实体', () => {
    for (const id of BUSINESS_WRITE_DOMAINS) {
      const domain = byId.get(id)
      expect(domain, `业务写域 ${id} 没有出现在外部能力面里`).toBeDefined()
      expect(domain!.readable, id).toBe(true)
      expect(domain!.writable, id).toBe(true)
      expect(domain!.entities.filter(externalWritable).length, id).toBeGreaterThan(0)
    }
  })

  it('有意只读的域带得住理由，不是"还没做"', () => {
    for (const id of INTENTIONAL_READ_ONLY_DOMAINS) {
      const domain = byId.get(id)!
      expect(domain.writable, id).toBe(false)
      for (const entity of domain.entities) {
        expect(entity.readOnlyReason, `${id}/${entity.id} 不可写却没有说明由谁维护`).toBeTruthy()
        expect(entity.readOnlyReason!.length, entity.id).toBeGreaterThan(10)
        expect(entity.readOnlyReason!, entity.id).not.toMatch(/暂时|暂不|以后再|待定/)
      }
    }
  })

  /**
   * 全域不变量：**每个实体要么外部可写，要么写明为什么不可写**，没有第三种状态。
   *
   * 这条是"未完成不能伪装成有意排除"的执行形式：漏接执行器的实体会落进"既不可写也没理由"
   * 这个空档，当场变红，而不是安静地以只读面貌对外呈现。
   */
  it('每个对外实体要么可写，要么写明只读原因', () => {
    const ambiguous = domains.flatMap((domain) => domain.entities
      .filter((entity) => !externalWritable(entity) && !entity.readOnlyReason)
      .map((entity) => `${domain.id}/${entity.id}`))
    expect(ambiguous, '以下实体既不可写也没有只读原因：要么补写入执行器，要么在实体声明里写明由谁维护').toEqual([])
  })

  it('助手内部运行目录不透传给外部', () => {
    for (const id of NEVER_EXPOSED_DOMAINS) expect(byId.has(id), `${id} 不应出现在外部能力面`).toBe(false)
    expect(externalWritableEntityTypes(domains).some((type) => type.startsWith('assistant.'))).toBe(false)
  })

  it('公开写入范围与 writeExclusion 声明一致，排除项一个都不放行', () => {
    const writable = new Set(externalWritableEntityTypes(domains))
    // 真实写过的目标（2.1／2.2 的四域与后台链路）必须在范围内。
    for (const type of ['settings.registry', 'generation.model', 'asset', 'asset.library', 'canvas.node', 'canvas.project', 'camera_stage.object', 'camera_stage.state_keyframe', 'image_edit.layer', 'image_mark.annotation']) {
      expect(writable.has(type), `${type} 应属于公开业务写入范围`).toBe(true)
    }
    // 声明了 writeExclusion 的实体一律在范围外，通用读改增删不能落到它们身上。
    for (const type of ['generation.task', 'generation.result', 'generation.record', 'image_edit.document', 'image_edit.preview', 'image_edit.resource', 'asset.catalog', 'storyboard.card', 'storyboard.project', 'toolbox.tool']) {
      expect(writable.has(type), `${type} 已声明有意只读，不能出现在公开写入范围`).toBe(false)
    }
  })

  it('按域发现的载荷足够小，不会在初始发现阶段注入全部属性', () => {
    expect(Buffer.byteLength(JSON.stringify(domains))).toBeLessThan(64 * 1024)
    // 只投影结构，不投影任何属性值或属性 ID 清单。
    expect(JSON.stringify(domains)).not.toContain('interface.theme_tone')
  })
})

/**
 * 验收线：**新增一个已登记的业务实体和属性，不需要回到 MCP 侧补任何字段表。**
 *
 * 这里往一个干净的注册表里登记一个全新的域，然后用同一段派生函数看它的外部面。派生通过就说明
 * 领域声明是唯一入口；如果哪天有人在 MCP 侧重新引入白名单，这条会留下那个实体拿不到可写身份。
 */
describe('新登记的业务实体自动进入外部能力面', () => {
  const catalogVersion = 'application-capabilities/v2'
  const digest = `sha256:${'a'.repeat(64)}`
  const schemaRef = (kind: 'entity' | 'property', id: string) => ({ catalogVersion, kind, id, version: 1, digest } as const)

  const registry = new ApplicationReflectionRegistry(catalogVersion)
  registry.register({
    entity: {
      id: 'sample.widget', domain: 'sample', version: 1, title: '样例部件', description: '用于验证外部能力面派生。',
      refKind: 'sample.widget', dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
      parentTypes: [], revisionScopes: ['sample'], queryCapabilityIds: ['read_application_entity'],
      schemaRef: schemaRef('entity', 'sample.widget'),
      collectionWrite: { creatable: true, removable: true, requiredPropertyIds: [], maxItemsPerChange: 8 },
    },
    properties: [{
      id: 'sample.widget.name', entityType: 'sample.widget', version: 1, title: '名称', description: '部件名称。',
      value: { kind: 'string' }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
      requiredPermissions: { read: ['sample:read'], write: ['sample:write'] },
      revisionScopes: ['sample'], schemaRef: schemaRef('property', 'sample.widget.name'),
    }],
  })
  registry.register({
    entity: {
      id: 'sample.snapshot', domain: 'sample', version: 1, title: '样例快照', description: '有意只读的投影。',
      refKind: 'sample.snapshot', dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
      parentTypes: [], revisionScopes: ['sample'], queryCapabilityIds: ['read_application_entity'],
      schemaRef: schemaRef('entity', 'sample.snapshot'),
      writeExclusion: { reason: '快照由样例领域的正式写入链路维护，外部只读取。' },
    },
    properties: [{
      id: 'sample.snapshot.value', entityType: 'sample.snapshot', version: 1, title: '值', description: '快照值。',
      value: { kind: 'string' }, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
      requiredPermissions: { read: ['sample:read'], write: [] },
      revisionScopes: ['sample'], schemaRef: schemaRef('property', 'sample.snapshot.value'),
    }],
  })

  it('登记实体与属性即刻可写，MCP 侧无需登记', () => {
    const domains = buildExternalCapabilityInventory(registry)
    expect(domains.map((domain) => domain.id)).toEqual(['sample'])
    const widget = domains[0].entities.find((entity) => entity.id === 'sample.widget')!
    expect(widget).toMatchObject({ title: '样例部件', writableProperties: 1, creatable: true, removable: true })
    expect(externalWritableEntityTypes(domains)).toContain('sample.widget')
  })

  it('声明了排除原因的实体自动变成带理由的只读', () => {
    const domains = buildExternalCapabilityInventory(registry)
    const snapshot = domains[0].entities.find((entity) => entity.id === 'sample.snapshot')!
    expect(snapshot.readOnlyReason).toContain('正式写入链路')
    expect(externalWritable(snapshot)).toBe(false)
    expect(externalWritableEntityTypes(domains)).not.toContain('sample.snapshot')
  })
})
