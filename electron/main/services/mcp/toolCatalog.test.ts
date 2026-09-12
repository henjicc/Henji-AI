// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildApplicationContract, buildMcpToolCatalog, EXCLUDED_TOOLS, PROTOCOL_TOOL_SPECS, toolTier } from './toolCatalog'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/assistant/builtinApplicationCapabilityRegistry'
import {
  EXTERNAL_CONTRACT_VERSION, MCP_CAPABILITY_IDS, MCP_READ_CAPABILITY_IDS, MCP_WRITE_CAPABILITY_IDS,
  type LocalDomainSurface, type LocalTool,
} from '../../../../src/core/application-control/localHostContracts'

/**
 * 宿主注册的工具正是渲染层的投影结果；这里用同一段投影重建，保证本测试盯的是真实声明，
 * 而不是测试里另写的一份假 schema。
 */
const hostTools: LocalTool[] = MCP_CAPABILITY_IDS.map((id) => {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)
  if (!definition) throw new Error(`能力目录缺少对外登记的能力：${id}`)
  return {
    id, version: definition.version, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }) as Record<string, unknown>,
  }
})

const READ_ONLY = { allowWrites: false, allowDestructive: false, allowPaid: false }
const WRITE = { allowWrites: true, allowDestructive: false, allowPaid: false }
const PAID = { allowWrites: true, allowDestructive: true, allowPaid: true }
const catalog = (access: typeof READ_ONLY, operationsEnabled = true) => buildMcpToolCatalog({ tools: hostTools, access, operationsEnabled })
const names = (access: typeof READ_ONLY, operationsEnabled = true) => catalog(access, operationsEnabled).tools.map((tool) => tool.name)

const domains: LocalDomainSurface[] = [
  { id: 'settings', readable: true, writable: true, entities: [{ id: 'settings.registry', title: '应用设置', writableProperties: 53, creatable: false, removable: false }] },
  { id: 'storyboard', readable: true, writable: false, entities: [{ id: 'storyboard.card', title: '分镜卡', writableProperties: 0, creatable: false, removable: false, readOnlyReason: '分镜是画布工程的只读摘要投影。' }] },
]

describe('对外工具目录的投影与授权过滤', () => {
  it('公开语义写入均有持久目标声明，创建图片能力节点无需付费权限', () => {
    for (const id of MCP_WRITE_CAPABILITY_IDS) {
      if (id === 'change_application_entities') continue
      expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)?.resolveOperationTargets, id).toBeTypeOf('function')
    }
    expect(names(WRITE)).toContain('apply_canvas_image_capability')
    expect(names(READ_ONLY)).not.toContain('apply_canvas_image_capability')
  })
  /**
   * 验收线：**工具 schema 与领域约束同源**。
   *
   * 这条红了就说明有人在 MCP 侧手抄了一份参数表——那正是"新增一个已登记业务字段还要回来改
   * MCP"的开始。读取工具必须逐字节等于能力定义的 Zod 输入投影；写入工具只允许多出协议信封。
   */
  it('能力工具的参数表逐字节来自能力定义，MCP 侧不存在第二份字段表', () => {
    const listed = new Map(catalog(PAID).tools.map((tool) => [tool.name, tool]))
    for (const tool of hostTools) {
      if (EXCLUDED_TOOLS.some((excluded) => excluded.name === tool.id)) continue
      const projected = listed.get(tool.id)
      expect(projected, tool.id).toBeDefined()
      if (MCP_READ_CAPABILITY_IDS.some((id) => id === tool.id)) {
        expect(projected!.inputSchema, tool.id).toEqual({ ...tool.inputSchema, type: 'object' })
        continue
      }
      const properties = projected!.inputSchema.properties as Record<string, unknown>
      const declared = tool.inputSchema.properties as Record<string, unknown>
      const withoutEnvelope = { ...properties }
      delete withoutEnvelope.operationId
      delete withoutEnvelope.baselineIds
      const declaredWithoutCompat = { ...declared }
      delete declaredWithoutCompat.expectedRevisions
      expect(withoutEnvelope, tool.id).toEqual(declaredWithoutCompat)
    }
  })

  it('operationId 必填、普通操作基线可省略，expectedRevisions 一律不对外', () => {
    const listed = catalog(PAID).tools.filter((tool) => MCP_WRITE_CAPABILITY_IDS.some((id) => id === tool.name))
    expect(listed.map((tool) => tool.name).sort()).toEqual([...MCP_WRITE_CAPABILITY_IDS].sort())
    for (const tool of listed) {
      const required = tool.inputSchema.required as string[]
      expect(required, tool.name).toContain('operationId')
      expect(required, tool.name).not.toContain('baselineIds')
      expect(required, tool.name).not.toContain('expectedRevisions')
      expect(Object.keys(tool.inputSchema.properties as object), tool.name).not.toContain('expectedRevisions')
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(false)
    }
  })

  it('目录按授权档过滤，被挡住的工具指名道姓说明缺哪一档', () => {
    expect(names(READ_ONLY).filter((name) => MCP_WRITE_CAPABILITY_IDS.some((id) => id === name))).toEqual([])
    expect(names(READ_ONLY)).not.toContain('get_application_operation')
    expect(catalog(READ_ONLY).hidden.map((item) => item.name).sort())
      .toEqual([...MCP_WRITE_CAPABILITY_IDS, 'get_application_operation', 'retry_application_operation_save'].sort())
    expect(catalog(READ_ONLY).hidden.find((item) => item.name === 'create_visible_generation_task')?.tier).toBe('paid')

    // 改权限：写工具出现，付费工具仍然缺席，并且缺席原因写明缺付费档而不是缺修改档。
    expect(names(WRITE)).toEqual(expect.arrayContaining(['change_application_entities', 'get_application_operation', 'retry_application_operation_save']))
    expect(names(WRITE)).not.toContain('create_visible_generation_task')
    expect(catalog(WRITE).hidden).toEqual([{ name: 'create_visible_generation_task', tier: 'paid', requires: '本连接未获「允许付费生成」授权' }])
    expect(names(PAID)).toContain('create_visible_generation_task')
    expect(catalog(PAID).hidden).toEqual([])
  })

  it('删除授权不改变目录，只在调用时校验；两条恢复能力任何档位都不作为独立工具出现', () => {
    expect(names({ allowWrites: true, allowDestructive: true, allowPaid: false })).toEqual(names(WRITE))
    for (const access of [READ_ONLY, WRITE, PAID]) {
      for (const excluded of EXCLUDED_TOOLS) expect(names(access), excluded.name).not.toContain(excluded.name)
    }
  })

  it('没有操作账本时写入与账本工具整体缺席，只读工具不受影响', () => {
    expect(names(PAID, false).filter((name) => MCP_WRITE_CAPABILITY_IDS.some((id) => id === name))).toEqual([])
    expect(names(PAID, false)).not.toContain('get_application_operation')
    expect(names(PAID, false)).toEqual(expect.arrayContaining([...MCP_READ_CAPABILITY_IDS, 'read_application_media', 'describe_application_contract']))
  })

  it('协议工具的参数表在服务端只声明一次，目录与解析共用', () => {
    const listed = new Map(catalog(PAID).tools.map((tool) => [tool.name, tool]))
    for (const spec of PROTOCOL_TOOL_SPECS) {
      expect(listed.get(spec.name)?.inputSchema, spec.name).toBe(spec.inputSchema)
      expect(toolTier(spec.name), spec.name).toBe(spec.tier)
    }
  })
})

describe('契约发现的投影', () => {
  it('域级摘要默认不展开实体；点名的域才展开，避免一次注入全部属性', () => {
    const summary = buildApplicationContract({ domains, access: PAID, catalog: catalog(PAID), port: 43821, requestedDomains: [] })
    const listed = summary.domains as Array<Record<string, unknown>>
    expect(listed.every((domain) => !('entities' in domain))).toBe(true)
    expect(listed.find((domain) => domain.id === 'settings')).toMatchObject({ readable: true, writable: true, entityTypes: 1, writableEntityTypes: 1 })
    expect(listed.find((domain) => domain.id === 'storyboard')).toMatchObject({ writable: false, writableEntityTypes: 0 })

    const expanded = buildApplicationContract({ domains, access: PAID, catalog: catalog(PAID), port: 43821, requestedDomains: ['storyboard'] })
    const storyboard = (expanded.domains as Array<Record<string, unknown>>).find((domain) => domain.id === 'storyboard')!
    expect((storyboard.entities as Array<{ readOnlyReason?: string }>)[0].readOnlyReason).toContain('只读摘要投影')
    expect((expanded.domains as Array<Record<string, unknown>>).find((domain) => domain.id === 'settings')).not.toHaveProperty('entities')
  })

  it('契约固定版本矩阵，并把"清单里没有"与"调用被拒"讲清楚', () => {
    const contract = buildApplicationContract({ domains, access: WRITE, catalog: catalog(WRITE), port: 43821, requestedDomains: [] })
    expect(contract.contract).toMatchObject({
      externalContractVersion: EXTERNAL_CONTRACT_VERSION,
      applicationCapabilityCatalog: 'application-capabilities/v2',
      sdkVersion: '1.30.0',
      protocolVersions: ['2025-11-25', '2025-06-18', '2025-03-26'],
      server: { name: 'henji', version: '1.0.0' },
    })
    expect((contract.contract as { transport: { url: string } }).transport.url).toBe('http://127.0.0.1:43821/mcp')
    const access = contract.access as { paid: boolean; note: string; hiddenTools: Array<{ name: string }>; excludedTools: Array<{ reason: string }> }
    expect(access.paid).toBe(false)
    expect(access.hiddenTools.map((item) => item.name)).toEqual(['create_visible_generation_task'])
    expect(access.note).toContain('PERMISSION_DENIED')
    expect(access.excludedTools).toHaveLength(EXCLUDED_TOOLS.length)
    expect(access.excludedTools.every((item) => item.reason.length > 10)).toBe(true)
    // 降级路径必须写在契约里：通知改轮询、资源读取保留工具入口、审批留在应用内。
    const workflows = (contract.workflows as string[]).join('\n')
    expect(workflows).toContain('不需要客户端支持通知扩展')
    expect(workflows).toContain('read_application_media')
    expect(workflows).toContain('痕迹 AI')
    expect((contract.tools as Array<{ name: string; envelope: string }>).filter((tool) => tool.envelope === 'operationId+baselineIds').map((tool) => tool.name))
      .toEqual(names(WRITE).filter((name) => MCP_WRITE_CAPABILITY_IDS.some((id) => id === name)))
  })

  it('契约本身足够小，不会挤占单次结果上限', () => {
    const contract = buildApplicationContract({ domains, access: PAID, catalog: catalog(PAID), port: 43821, requestedDomains: domains.map((domain) => domain.id) })
    expect(Buffer.byteLength(JSON.stringify(contract))).toBeLessThan(64 * 1024)
  })
  it('内置助手契约指向对话权限，不让用户创建 MCP 连接；全权限可发现付费生成', () => {
    const contract = buildApplicationContract({ domains, access: PAID, catalog: catalog(PAID), port: 0, requestedDomains: [], callerKind: 'embedded' })
    expect(contract.contract).toMatchObject({ transport: { kind: 'embedded', requiresExternalConnection: false } })
    expect(contract.access).toMatchObject({ paid: true, destructive: true, note: expect.stringContaining('助手操作权限') })
    expect(contract.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'create_visible_generation_task' })]))
  })
})
