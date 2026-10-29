// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { applicationCatalogSchemaHash, applicationToolSchemaHash, buildApplicationContract, buildApplicationToolCatalog, EXCLUDED_TOOLS, PROTOCOL_TOOL_SPECS } from './toolCatalog'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { RESULT_DETAIL_FIELDS, resultDetailFields } from './resultProjection'
import {
  EXTERNAL_CONTRACT_VERSION, APPLICATION_CAPABILITY_IDS, APPLICATION_READ_CAPABILITY_IDS, APPLICATION_WRITE_CAPABILITY_IDS,
  type LocalDomainSurface, type LocalTool,
} from '../../../../src/core/application-control/localHostContracts'

/**
 * 宿主注册的工具正是渲染层的投影结果；这里用同一段投影重建，保证本测试盯的是真实声明，
 * 而不是测试里另写的一份假 schema。
 */
const hostTools: LocalTool[] = APPLICATION_CAPABILITY_IDS.map((id) => {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)
  if (!definition) throw new Error(`能力目录缺少对外登记的能力：${id}`)
  return {
    id, version: definition.version, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input', reused: 'ref' }) as Record<string, unknown>,
  }
})

const catalog = () => buildApplicationToolCatalog({ tools: hostTools })
const names = () => catalog().tools.map((tool) => tool.name)

const domains: LocalDomainSurface[] = [
  { id: 'settings', readable: true, writable: true, entities: [{ id: 'settings.registry', title: '应用设置', writableProperties: 53, creatable: false, removable: false }] },
  { id: 'storyboard', readable: true, writable: false, entities: [{ id: 'storyboard.card', title: '分镜卡', writableProperties: 0, creatable: false, removable: false, readOnlyReason: '分镜是画布工程的只读摘要投影。' }] },
]

describe('对外工具目录的同源投影', () => {
  it('媒体 mode 的枚举与说明经过目录投影仍完整保留', () => {
    {
      const tool = catalog().tools.find(item => item.name === 'read_application_media')!
      expect((tool.inputSchema.properties as Record<string, unknown>).mode).toEqual({ type: 'string', enum: ['chunk', 'image'], description: expect.stringContaining('图片默认 image') })
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(tool.description).toContain('图片默认返回 image')
      expect((tool.inputSchema.properties as Record<string, unknown>).maxEdge).toMatchObject({ default: 1600 })
      expect((tool.inputSchema.properties as Record<string, unknown>).maxBytes).toMatchObject({ default: 614400, maximum: 1572864 })
    }
  })
  it('新增付费入口只需领域声明，目录自动公开并使用统一付费策略', () => {
    const original = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get.bind(BUILTIN_APPLICATION_CAPABILITY_REGISTRY)
    const spy = vi.spyOn(BUILTIN_APPLICATION_CAPABILITY_REGISTRY, 'get').mockImplementation(id => {
      const value = original(id)
      return id === 'apply_canvas_image_capability' && value ? { ...value, paidGenerationPreparation: 'prepare_generation_task' } : value
    })
    try {
      expect(names()).toContain('apply_canvas_image_capability')
    } finally { spy.mockRestore() }
  })
  it('所有公开生成创建能力都有可调用的只读费用准备入口', () => {
    for (const id of APPLICATION_WRITE_CAPABILITY_IDS) {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
      if (definition.control.impacts.some(impact => impact.effect === 'create' && impact.entityTypes.includes('generation.task'))) {
        expect(definition.paidGenerationPreparation, id).toBeTruthy()
      }
      if (!definition.paidGenerationPreparation) continue
      expect(APPLICATION_READ_CAPABILITY_IDS, id).toContain(definition.paidGenerationPreparation)
      expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(definition.paidGenerationPreparation)?.readOnly, id).toBe(true)
    }
  })
  it('公开语义写入均有持久目标声明，创建图片能力节点使用统一付费策略', () => {
    for (const id of APPLICATION_WRITE_CAPABILITY_IDS) {
      if (id === 'change_application_entities') continue
      expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)?.resolveOperationTargets, id).toBeTypeOf('function')
    }
    expect(names()).toContain('apply_canvas_image_capability')
    for (const id of ['create_image_edit_preview', 'commit_image_edit']) {
      expect(names()).toContain(id)
    }
    expect(names()).toContain('resume_canvas_generation_task')
  })
  /**
   * 验收线：**工具 schema 与领域约束同源**。
   *
   * 这条红了就说明有人在 MCP 侧手抄了一份参数表——那正是"新增一个已登记业务字段还要回来改
   * MCP"的开始。读取工具必须逐字节等于能力定义的 Zod 输入投影；写入工具只允许多出协议信封。
   */
  it('能力工具的参数表逐字节来自能力定义，MCP 侧不存在第二份字段表', () => {
    const listed = new Map(catalog().tools.map((tool) => [tool.name, tool]))
    for (const tool of hostTools) {
      if (EXCLUDED_TOOLS.some((excluded) => excluded.name === tool.id)) continue
      const projected = listed.get(tool.id)
      expect(projected, tool.id).toBeDefined()
      if (APPLICATION_READ_CAPABILITY_IDS.some((id) => id === tool.id)) {
        expect(projected!.inputSchema, tool.id).toEqual({ ...tool.inputSchema, properties: { ...tool.inputSchema.properties as object, ...resultDetailFields(tool.id) }, type: 'object' })
        continue
      }
      const properties = projected!.inputSchema.properties as Record<string, unknown>
      const declared = tool.inputSchema.properties as Record<string, unknown>
      const withoutEnvelope = { ...properties }
      delete withoutEnvelope.operationId
      delete withoutEnvelope.baselineIds
      for (const key of Object.keys(RESULT_DETAIL_FIELDS)) delete withoutEnvelope[key]
      const declaredWithoutCompat = { ...declared }
      delete declaredWithoutCompat.expectedRevisions
      expect(withoutEnvelope, tool.id).toEqual(declaredWithoutCompat)
    }
  })

  it('operationId 必填、普通操作基线可省略，expectedRevisions 一律不对外', () => {
    const listed = catalog().tools.filter((tool) => APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === tool.name))
    expect(listed.map((tool) => tool.name).sort()).toEqual([...APPLICATION_WRITE_CAPABILITY_IDS].sort())
    for (const tool of listed) {
      const required = tool.inputSchema.required as string[]
      expect(required, tool.name).toContain('operationId')
      expect(required, tool.name).not.toContain('baselineIds')
      expect(required, tool.name).not.toContain('expectedRevisions')
      expect(Object.keys(tool.inputSchema.properties as object), tool.name).not.toContain('expectedRevisions')
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(false)
    }
  })



  it('恢复能力沿原操作执行，不作为独立工具出现', () => {
    {
      for (const excluded of EXCLUDED_TOOLS) expect(names(), excluded.name).not.toContain(excluded.name)
    }
  })



  it('协议工具的参数表在服务端只声明一次，目录与解析共用', () => {
    const listed = new Map(catalog().tools.map((tool) => [tool.name, tool]))
    for (const spec of PROTOCOL_TOOL_SPECS) {
      expect(listed.get(spec.name)?.inputSchema, spec.name).toEqual({ ...spec.inputSchema, properties: { ...spec.inputSchema.properties as Record<string, unknown>, ...RESULT_DETAIL_FIELDS } })
    }
  })
})

describe('契约发现的投影', () => {
  it('schema 哈希不受对象键和目录顺序影响，变化可按 names 取服务端完整 schema', () => {
    const current = catalog()
    const tool = current.tools.find(item => item.name === 'get_video_edit_clip_pauses')!
    const reordered = (value: unknown): unknown => Array.isArray(value) ? value.map(reordered)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reordered(item)])) : value
    expect(applicationToolSchemaHash({ ...tool, inputSchema: reordered(tool.inputSchema) as typeof tool.inputSchema })).toBe(applicationToolSchemaHash(tool))
    expect(applicationCatalogSchemaHash({ ...current, tools: [...current.tools].reverse() })).toBe(applicationCatalogSchemaHash(current))
    for (const changed of [{ ...tool, name: `${tool.name}_new` }, { ...tool, description: `${tool.description}变更` }, { ...tool, inputSchema: { ...tool.inputSchema, required: [] } }]) {
      expect(applicationToolSchemaHash(changed)).not.toBe(applicationToolSchemaHash(tool))
    }
    // 只改返回结构时，客户端也必须能从目录哈希察觉缓存过期。
    expect(tool.outputSchema).toBeDefined()
    const outputOnly = { ...current, tools: current.tools.map(item => item === tool ? { ...item, outputSchema: { ...item.outputSchema!, required: ['changed'] } } : item) }
    expect(applicationCatalogSchemaHash(outputOnly)).not.toBe(applicationCatalogSchemaHash(current))
    const contract = buildApplicationContract({ domains, catalog: current, port: 0, requestedDomains: [], names: [tool.name], includeSchemas: true })
    expect(contract.toolSchemas).toEqual([{ name: tool.name, schemaHash: applicationToolSchemaHash(tool), description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema ?? null, annotations: tool.annotations ?? null }])
    // 客户端只凭 describe 返回的字段就能按声明的算法重算出同一个 schemaHash。
    const [described] = contract.toolSchemas as Array<Parameters<typeof applicationToolSchemaHash>[0] & { schemaHash: string }>
    expect(applicationToolSchemaHash(described)).toBe(described.schemaHash)
    expect(contract.catalogSchemaHash).toBe(applicationCatalogSchemaHash(current))
    expect(buildApplicationContract({ domains, catalog: catalog(), port: 0, requestedDomains: [], names: ['change_application_entities'], includeSchemas: true }).toolSchemas).toHaveLength(1)
  })
  it('域级摘要默认不展开实体；点名的域才展开，避免一次注入全部属性', () => {
    const summary = buildApplicationContract({ domains, catalog: catalog(), port: 43821, requestedDomains: [] })
    const listed = summary.domains as Array<Record<string, unknown>>
    expect(listed.every((domain) => !('entities' in domain))).toBe(true)
    expect(listed.find((domain) => domain.id === 'settings')).toMatchObject({ readable: true, writable: true, entityTypes: 1, writableEntityTypes: 1 })
    expect(listed.find((domain) => domain.id === 'storyboard')).toMatchObject({ writable: false, writableEntityTypes: 0 })

    const expanded = buildApplicationContract({ domains, catalog: catalog(), port: 43821, requestedDomains: ['storyboard'] })
    const storyboard = (expanded.domains as Array<Record<string, unknown>>).find((domain) => domain.id === 'storyboard')!
    expect(expanded.access).toHaveProperty('alternativeRoutes')
    expect((storyboard.entities as Array<{ readOnlyReason?: string }>)[0].readOnlyReason).toContain('只读摘要投影')
    expect((expanded.domains as Array<Record<string, unknown>>).find((domain) => domain.id === 'settings')).not.toHaveProperty('entities')
  })

  it('契约固定版本矩阵，并把"清单里没有"与"调用被拒"讲清楚', () => {
    const contract = buildApplicationContract({ domains, catalog: catalog(), port: 43821, requestedDomains: [], detail: 'full' })
    expect(contract.contract).toMatchObject({
      externalContractVersion: EXTERNAL_CONTRACT_VERSION,
      applicationCapabilityCatalog: 'application-capabilities/v2',
      sdkVersion: '2.0.0',
      protocolVersions: ['2026-07-28'],
      server: { name: 'henji', version: '2.0.0' },
    })
    expect((contract.contract as { transport: { url: string } }).transport.url).toBe('http://127.0.0.1:43821/mcp')
    const access = contract.access as { excludedTools: Array<{ reason: string }> }
    expect(access.excludedTools).toHaveLength(EXCLUDED_TOOLS.length)
    expect(access.excludedTools.every((item) => item.reason.length > 10)).toBe(true)
    // 降级路径必须写在契约里：通知改轮询、资源读取保留工具入口、审批留在应用内。
    const workflows = (contract.workflows as string[]).join('\n')
    expect(workflows).toContain('不需要客户端支持通知扩展')
    expect(workflows).toContain('read_application_media')
    expect((contract.tools as Array<{ name: string; envelope: string }>).filter((tool) => tool.envelope === 'operationId+baselineIds').map((tool) => tool.name))
      .toEqual(names().filter((name) => APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === name)))
  })

  it('契约本身足够小，不会挤占单次结果上限', () => {
    const contract = buildApplicationContract({ domains, catalog: catalog(), port: 43821, requestedDomains: domains.map((domain) => domain.id) })
    expect(Buffer.byteLength(JSON.stringify(contract))).toBeLessThan(64 * 1024)
  })
  it('内置助手契约无需 MCP 连接，可发现付费生成', () => {
    const contract = buildApplicationContract({ domains, catalog: catalog(), port: 0, requestedDomains: [], callerKind: 'embedded', detail: 'full' })
    expect(contract.contract).toMatchObject({ transport: { kind: 'embedded', requiresExternalConnection: false } })
    expect(contract.access).not.toHaveProperty('paid')
    expect(contract.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'create_visible_generation_task' })]))
  })
})
