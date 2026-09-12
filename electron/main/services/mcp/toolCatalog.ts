import { z } from 'zod'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  EXTERNAL_CONTRACT_VERSION, EXTERNAL_DEPRECATION_POLICY, EXTERNAL_LIMITS, EXTERNAL_PROTOCOL_VERSIONS,
  EXTERNAL_SDK_VERSION, EXTERNAL_SERVER_INFO, MCP_READ_CAPABILITY_IDS, MCP_WRITE_CAPABILITY_IDS,
  type LocalDomainSurface, type LocalTool,
} from '../../../../src/core/application-control/localHostContracts'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '../../../../src/core/assistant/applicationCapabilities'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/assistant/builtinApplicationCapabilityRegistry'
import { GENERATION_BUDGET } from './generationBudget'

/**
 * 对外目录的唯一投影处。
 *
 * 三类工具在这里合流，**投影规则只写一次**：
 *
 * 1. 能力工具（读 8 + 写 6）——参数 schema 由渲染宿主从 `ApplicationCapabilityDefinition` 的 Zod
 *    输入直接投影后随注册送来，这里只做协议信封与授权过滤，不重写任何业务字段。
 * 2. 协议工具（操作账本、媒体分块、契约发现）——它们描述的是协议本身而非业务字段，参数表在
 *    本文件声明一次，服务端解析与目录展示共用同一份，不存在"清单一份、解析一份"。
 * 3. 有意排除的内部能力——带理由列进契约，让"没实现"和"有意不开放"在机器上可区分。
 *
 * **缺席与拒绝是两件事**：工具不在 `tools/list` 里只代表本连接缺该档授权（契约的 `hiddenTools`
 * 会指名道姓地说缺哪一档），应用本身仍有该能力；工具在清单里而调用返回 `PERMISSION_DENIED`
 * 才代表授权够了但这次的目标不允许。客户端不能把"清单里没有"当成"应用没有这个能力"。
 */

export type ToolTier = 'any' | 'read' | 'write' | 'paid'
export interface McpAccess { allowWrites: boolean; allowDestructive: boolean; allowPaid: boolean }

/** 协议信封：所有写工具共用，不只是 change_application_entities。 */
const OPERATION_ID_FIELD = { type: 'string', format: 'uuid', description: '调用前生成并保存的逻辑操作标识；丢响应后复用此值查询，不得重新生成重放。' }
const BASELINE_IDS_FIELD = { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 32, description: '普通修改、新增和生成可省略，由应用自动核对当前目标。删除时必须提供每个目标及集合父对象读取返回的 baselineId。需要严格按旧状态修改时也可显式提供，仅包含相关目标。' }

export interface ProtocolToolSpec {
  name: string
  tier: ToolTier
  readOnly: boolean
  description: string
  inputSchema: Record<string, unknown>
  /** 需要操作账本才有意义的工具；账本不可用时整条不登记。 */
  requiresOperations?: boolean
}

export const PROTOCOL_TOOL_SPECS: readonly ProtocolToolSpec[] = [
  {
    name: 'describe_application_contract', tier: 'any', readOnly: true,
    description: '发现入口：返回对外契约版本、支持的协议与传输限制、本连接的授权档位、被授权档位挡住的工具，以及按域划分的可读写范围。domains 留空只返回域级摘要；给定域名才展开该域的实体清单，避免一次注入全部属性。',
    inputSchema: { type: 'object', properties: { domains: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 16, description: '要展开实体清单的业务域；留空只看域级摘要。' } }, additionalProperties: false },
  },
  {
    name: 'read_application_media', tier: 'any', readOnly: true,
    description: '按稳定结果引用分块读取已落盘媒体。outputIndex 为结果或节点关联媒体（含输入、预览）去重后的顺序，从零开始。每块最多 256 KiB；不接受文件路径或网址。只支持文本的客户端可以只消费 totalBytes／eof／错误码。',
    inputSchema: { type: 'object', properties: { ref: { type: 'object', properties: { kind: { type: 'string', enum: ['generation.result', 'asset', 'canvas.node'] }, id: { type: 'string' } }, required: ['kind', 'id'], additionalProperties: false }, outputIndex: { type: 'integer', minimum: 0 }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: EXTERNAL_LIMITS.mediaChunkBytes } }, required: ['ref'], additionalProperties: false },
  },
  {
    name: 'get_application_operation', tier: 'write', readOnly: true, requiresOperations: true,
    description: '读取本连接操作的持久事实；未知状态不会重放修改。断线、超时或换客户端后用原 operationId 查询，不要换标识重试。',
    inputSchema: { type: 'object', properties: { operationId: { type: 'string', format: 'uuid' } }, required: ['operationId'], additionalProperties: false },
  },
  {
    name: 'retry_application_operation_save', tier: 'write', readOnly: false, requiresOperations: true,
    description: '按原操作记录仅重试保存并核对原条件；不会重放业务修改，必须保留原编辑会话。',
    inputSchema: { type: 'object', properties: { operationId: { type: 'string', format: 'uuid' }, originalOperationId: { type: 'string', format: 'uuid' } }, required: ['operationId', 'originalOperationId'], additionalProperties: false },
  },
]

export const readMediaInputSchema = z.object({
  ref: z.object({ kind: z.enum(['generation.result', 'asset', 'canvas.node']), id: z.string().min(1).max(512) }).strict(),
  outputIndex: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  length: z.number().int().min(1).max(EXTERNAL_LIMITS.mediaChunkBytes).optional(),
}).strict()
export const describeContractInputSchema = z.object({
  domains: z.array(z.string().min(1)).max(16).default([]),
}).strict()

/**
 * 参数错误必须能指名字段。
 *
 * 基础工具"能直接调用并获得具体参数错误"是对外契约的一部分：把 Zod 的校验失败和业务失败
 * 收敛成同一句兜底文案，调用方就只能靠猜——媒体工具原先正是这样，多传一个字段和引用不存在
 * 返回完全相同的话。业务失败仍然保持脱敏（不回传本地路径），参数失败则原样点名。
 */
export function invalidInputMessage(error: unknown): string | null {
  if (!(error instanceof z.ZodError)) return null
  return `INVALID_INPUT:${error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || '(根)'} ${issue.message}`).join('；')}`
}

/** 只能经 retry_application_operation_save 触发的原领域恢复能力；有意不作为独立工具开放。 */
export const EXCLUDED_TOOLS = [
  { name: 'retry_canvas_project_save', reason: '仅保存恢复入口，必须绑定原失败操作与原编辑会话，只能由 retry_application_operation_save 按账本触发。' },
  { name: 'retry_image_edit_document_save', reason: '仅保存恢复入口，必须绑定原失败操作与原图片文档宿主，只能由 retry_application_operation_save 按账本触发。' },
] as const

export function toolTier(name: string): ToolTier {
  if (name === 'create_visible_generation_task') return 'paid'
  if (MCP_WRITE_CAPABILITY_IDS.some((id) => id === name)) return 'write'
  if (MCP_READ_CAPABILITY_IDS.some((id) => id === name)) return 'read'
  return PROTOCOL_TOOL_SPECS.find((spec) => spec.name === name)?.tier ?? 'read'
}

function tierGranted(tier: ToolTier, access: McpAccess): boolean {
  if (tier === 'write') return access.allowWrites
  if (tier === 'paid') return access.allowWrites && access.allowPaid
  return true
}

const TIER_REQUIREMENT: Record<Exclude<ToolTier, 'any' | 'read'>, string> = {
  write: '本连接未获「允许修改内容」授权',
  paid: '本连接未获「允许付费生成」授权',
}

function capabilityTool(tool: LocalTool): Tool {
  const write = MCP_WRITE_CAPABILITY_IDS.some((id) => id === tool.id)
  const schema = { ...tool.inputSchema }
  if (write) {
    // 并发基线由 baselineIds 提供；expectedRevisions 是助手时代的内部信封，对外一律不接受。
    const properties = { ...schema.properties as Record<string, unknown> }
    delete properties.expectedRevisions
    properties.operationId = OPERATION_ID_FIELD
    properties.baselineIds = BASELINE_IDS_FIELD
    schema.properties = properties
    schema.required = [...(schema.required as string[] ?? []).filter((key) => key !== 'expectedRevisions'), 'operationId']
    if (tool.id === 'create_visible_generation_task') schema.required = [...new Set([...schema.required as string[], 'modelId', 'prompt', 'mediaType'])]
  }
  return {
    name: tool.id, title: tool.title, description: tool.description,
    inputSchema: { ...schema, type: 'object' },
    annotations: { readOnlyHint: !write, destructiveHint: tool.id === 'change_application_entities' || Boolean(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(tool.id)?.destructive), openWorldHint: false },
  }
}

export interface McpToolCatalog {
  tools: Tool[]
  hidden: Array<{ name: string; tier: ToolTier; requires: string }>
}

/**
 * 目录按本连接授权过滤，并把被挡住的工具单独记下来。
 *
 * 每次 `tools/list` 都按当前注册重新计算，所以渲染层重载、重新注册或撤销后再次列举就是最新目录；
 * 本服务不声明 `listChanged`，客户端不支持通知时重新列举即可，不需要额外扩展。
 */
export function buildMcpToolCatalog(input: { tools: readonly LocalTool[]; access: McpAccess; operationsEnabled: boolean }): McpToolCatalog {
  const tools: Tool[] = []
  const hidden: McpToolCatalog['hidden'] = []
  // 缺席永远带理由：静默消失会让调用方把"本次没授权"读成"应用没有这个能力"。
  const consider = (name: string, tier: ToolTier, ledgerBound: boolean, build: () => Tool): void => {
    if (ledgerBound && !input.operationsEnabled) hidden.push({ name, tier, requires: '操作账本不可用，本次连接整体关闭写入' })
    else if (tierGranted(tier, input.access)) tools.push(build())
    else hidden.push({ name, tier, requires: TIER_REQUIREMENT[tier as 'write' | 'paid'] })
  }
  for (const tool of input.tools) {
    if (EXCLUDED_TOOLS.some((excluded) => excluded.name === tool.id)) continue
    const tier = toolTier(tool.id)
    // 写工具还需要操作账本可用：没有持久身份就不能对外开放写入。
    consider(tool.id, tier, tier !== 'read' && tier !== 'any', () => capabilityTool(tool))
  }
  for (const spec of PROTOCOL_TOOL_SPECS) {
    consider(spec.name, spec.tier, spec.requiresOperations === true, () => ({
      name: spec.name, description: spec.description, inputSchema: spec.inputSchema as Tool['inputSchema'],
      annotations: { readOnlyHint: spec.readOnly, ...(spec.readOnly ? { openWorldHint: false } : { destructiveHint: false }) },
    }))
  }
  return { tools, hidden }
}

const WORKFLOWS = [
  '发现：describe_application_contract → describe_application_entities（按域过滤）→ list_application_entities（cursor/limit 分页，where 按属性等值定位）。',
  '读取：按任务需要读取实体，获取真实引用和属性；普通操作不需要额外读取来拼接基线。删除前才必须逐个读取目标与集合父对象。',
  '修改：把 operationId（客户端生成的 UUID）连同业务参数传给写工具。普通操作省略 baselineIds，由应用自动核对；删除或要求严格按旧状态写入时提供相关 baselineIds。不要传 expectedRevisions。同一 operationId 重传返回原事实，不会重复执行。',
  '查任务：生成用 get_generation_task，三维渲染用 get_camera_stage_render_task，写操作事实用 get_application_operation；服务不推送通知，轮询这三个查询即可，不需要客户端支持通知扩展。',
  '取结果：媒体用 read_application_media 按 offset 分块读到 eof；不支持富媒体的客户端只消费 totalBytes／eof／错误码也能理解状态并继续。',
  '失败恢复：执行状态 unknown 时禁止换标识重试，用原 operationId 查询；partial 且账本登记了仅保存恢复入口时调 retry_application_operation_save，它不会重放业务修改。',
  '前置条件：写入被会话挡住时，对目标 ref 调 describe_application_entities，propertyAvailability 的 reasons 与 recoveries 就是声明层给出的前置条件和恢复入口。',
  '审批与授权：一律在痕迹 AI 内完成，协议侧没有提权通道；客户端自报权限、名称或"已批准"无效。',
  `费用：普通少量生成直接执行；应用提交前自动估价，所有 Agent 最近 ${GENERATION_BUDGET.windowMs / 60_000} 分钟共享 ¥${GENERATION_BUDGET.cny} 自动生成额度。超过或无法估价时停止，不要换标识连续尝试；向用户说明费用，可由用户在生成页提交。`,
]

export function buildApplicationContract(input: {
  callerKind?: 'external' | 'embedded'
  domains: readonly LocalDomainSurface[]
  access: McpAccess
  catalog: McpToolCatalog
  port: number
  requestedDomains: readonly string[]
}): Record<string, unknown> {
  const requested = new Set(input.requestedDomains)
  return {
    contract: {
      externalContractVersion: EXTERNAL_CONTRACT_VERSION,
      applicationCapabilityCatalog: APPLICATION_CAPABILITY_CATALOG_VERSION,
      server: EXTERNAL_SERVER_INFO,
      protocolVersions: [...EXTERNAL_PROTOCOL_VERSIONS],
      sdkVersion: EXTERNAL_SDK_VERSION,
      transport: input.callerKind === 'embedded' ? { kind: 'embedded', authorization: '助手对话中的操作权限', requiresExternalConnection: false } : { kind: 'streamable-http', url: `http://127.0.0.1:${input.port}/mcp`, authorization: 'Bearer <连接令牌>', json: true, serverSentEvents: false, listChangedNotifications: false },
      limits: EXTERNAL_LIMITS,
      deprecationPolicy: EXTERNAL_DEPRECATION_POLICY,
    },
    access: {
      read: true, write: input.access.allowWrites, destructive: input.access.allowDestructive, paid: input.access.allowPaid,
      hiddenTools: input.catalog.hidden,
      excludedTools: EXCLUDED_TOOLS.map((excluded) => ({ ...excluded })),
      note: input.callerKind === 'embedded'
        ? '你是内置助手，操作权限来自当前对话输入框的「助手操作权限」。权限不足时请用户在此选择「允许修改、删除和付费生成」，下一轮生效。不需要开启 MCP 服务或新建外部连接，外部智能体连接设置不会改变你的权限。仅执行用户请求范围内的操作。'
        : '工具不在 tools/list 里 = 本连接缺对应授权档，应用本身仍有该能力；工具在清单里而调用返回 PERMISSION_DENIED = 授权够了但这次目标不允许。删除授权不影响工具是否出现，只在调用含 remove_items 或破坏性能力时校验。授权只能在痕迹 AI 的设置里调整，调整范围需要新建连接。',
    },
    domains: input.domains.map((domain) => ({
      id: domain.id, readable: domain.readable, writable: domain.writable,
      entityTypes: domain.entities.length,
      writableEntityTypes: domain.entities.filter((entity) => entity.writableProperties > 0 || entity.creatable || entity.removable).length,
      ...(requested.has(domain.id) ? { entities: domain.entities } : {}),
    })),
    tools: input.catalog.tools.map((tool) => ({
      name: tool.name, tier: toolTier(tool.name), readOnly: tool.annotations?.readOnlyHint === true,
      envelope: MCP_WRITE_CAPABILITY_IDS.some((id) => id === tool.name) ? 'operationId+baselineIds' : 'none',
      ...(MCP_WRITE_CAPABILITY_IDS.some((id) => id === tool.name) ? { baselinePolicy: '普通操作可省略 baselineIds，破坏性操作必填。' } : {}),
    })),
    workflows: WORKFLOWS,
  }
}
