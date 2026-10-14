import { z } from 'zod'
import { createHash } from 'node:crypto'
export { invalidInputMessage } from '../../../../src/core/application-control/inputValidation'
import type { ApplicationToolDescriptor as Tool } from '../../../../src/core/application-control/capabilityMetadata'
import {
  EXTERNAL_CONTRACT_VERSION, EXTERNAL_DEPRECATION_POLICY, EXTERNAL_LIMITS, EXTERNAL_PROTOCOL_VERSIONS,
  EXTERNAL_SDK_VERSION, EXTERNAL_SERVER_INFO, APPLICATION_READ_CAPABILITY_IDS, APPLICATION_WRITE_CAPABILITY_IDS,
  type LocalDomainSurface, type LocalTool,
} from '../../../../src/core/application-control/localHostContracts'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '../../../../src/core/application-control/applicationCapabilities'
import { APPLICATION_READABLE_MEDIA_KINDS } from '../../../../src/core/application-control/mediaReferenceKinds'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { loadAssistantSkillCapability } from '../../../../src/core/application-control/domains/assistantSkill/assistantSkillApplicationCapabilities'
import { projectToolOutputSchema, RESULT_DETAIL_FIELDS, resultDetailFields } from './resultProjection'
import { capabilityPublicOutputSchema } from '../../../../src/core/application-control/capabilityVerification'
import { applicationUserConfirmationSchema } from '../../../../src/core/application-control/userConfirmation'

const confirmationGuidance = '付费操作按用户的 AI 付费授权自动放行或请求确认；返回 awaiting_user_confirmation 时请用户在痕迹AI确认对话框核对，确认后自动继续，用原 operationId 查 get_application_operation，勿重复提交。'
const waitingOutput = z.object({ ok: z.literal(false), operationId: z.string().uuid(), executionState: z.literal('awaiting_user_confirmation'),
  verificationState: z.literal('unresolved'), confirmation: applicationUserConfirmationSchema }).passthrough()

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
export interface ApplicationAccess { allowWrites: boolean; allowDestructive: boolean; allowPaid: boolean }

/** 协议信封：所有写工具共用，不只是 change_application_entities。 */
const OPERATION_ID_FIELD = { type: 'string', format: 'uuid', description: '调用者范围内唯一的幂等键；调用前生成并保存，丢响应后复用此值查询，不得重新生成重放。' }
const BASELINE_IDS_FIELD = { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 32, description: '普通修改、新增和生成可省略，由应用自动核对当前目标。删除时必须提供每个被删除实体经 read_application_entity 读取返回的 baselineId，相关文档或集合父对象的 baselineId 可选。需要严格按旧状态修改时也可显式提供，仅包含相关目标。' }

export interface ProtocolToolSpec {
  name: string
  tier: ToolTier
  readOnly: boolean
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  /** 需要操作账本才有意义的工具；账本不可用时整条不登记。 */
  requiresOperations?: boolean
}

export const operationReadInputSchema = z.object({
  operationId: z.string().uuid(),
  resultField: z.string().min(1).optional().describe('resultCollections 返回的 resultRef.field；只读取该结果数组，不重放操作。'),
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.number().int().min(1).max(100).default(50).describe('单页传输预算，不限制结果总数。'),
}).strict().refine(input => input.resultField !== undefined || input.cursor === undefined, 'cursor 需要 resultField。')

const mediaMetadataShape = {
  mimeType: z.string(), offset: z.number().int().nonnegative(), byteLength: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(), eof: z.boolean(),
}
/** image 的字节进入 MCP content.image，structuredContent 只含元数据；chunk 保留原件 base64。 */
const publicMediaOutputSchema = z.object({ ok: z.literal(true), data: z.union([
  z.object({ ...mediaMetadataShape, mode: z.literal('image'), mimeType: z.literal('image/jpeg'), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  z.object({ ...mediaMetadataShape, base64: z.string() }).strict(),
]) }).passthrough()

export const PROTOCOL_TOOL_SPECS: readonly ProtocolToolSpec[] = [
  {
    name: 'describe_application_contract', tier: 'any', readOnly: true,
    description: '发现协议、授权、限制、业务域与可用技能。domains 点名才展开实体；detail="full" 查询工具授权清单、排除理由与弃用策略。toolSchemas 返回每个工具的 name/schemaHash，可用 names 过滤；names 配合 includeSchemas=true 获取完整 description/inputSchema。本地缓存与 schemaHash 不一致时，以 describe 返回的 schema 为准并按其参数调用。catalogSchemaHash 可与 get_current_application_context 的目录哈希比较。2.6.0 起镜头参考文档与子实体的修订范围为 camera_stage；toolbox 仅保留工具箱自身状态。旧 toolbox 镜头基线已过期，请重新 read_application_entity 获取 baselineId。',
    inputSchema: { type: 'object', properties: { domains: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 16, description: '要展开实体清单的业务域；留空只看域级摘要。' }, detail: { type: 'string', enum: ['compact', 'full'], default: 'compact' }, names: { type: 'array', items: { type: 'string', minLength: 1 }, description: '仅返回这些已授权工具的 schema 摘要；省略时返回全部摘要。' }, includeSchemas: { type: 'boolean', default: false, description: '配合 names 返回完整 description/inputSchema，按需分批查询。' } }, additionalProperties: false },
  },
  {
    name: 'read_application_media', tier: 'any', readOnly: true,
    outputSchema: projectToolOutputSchema(z.toJSONSchema(publicMediaOutputSchema, { io: 'output' }), 'read_application_media'),
    description: '按稳定结果引用读取已落盘媒体。图片默认返回 image（MCP 标准图片，无需拼接 base64），默认长边 1280、JPEG 至多 100 KiB；maxEdge/maxBytes 可缩小查看预算。mode="chunk" 用于读取原件字节；音视频默认分块读取；image_edit.preview 是尚未保存的中间产物，不可直接读取，先 commit_image_edit 落盘。outputIndex 为结果或节点关联媒体（含输入、预览）去重后的顺序，从零开始。每块最多 256 KiB；不接受文件路径或网址。只支持文本的客户端可以只消费 totalBytes／eof／错误码。',
    inputSchema: { type: 'object', properties: { ref: { type: 'object', properties: { kind: { type: 'string', enum: [...APPLICATION_READABLE_MEDIA_KINDS] }, id: { type: 'string' } }, required: ['kind', 'id'], additionalProperties: false }, mode: { type: 'string', enum: ['chunk', 'image'], description: '图片默认 image 直接查看；chunk 读取原件字节，音视频默认 chunk。' }, maxEdge: { type: 'integer', minimum: 1, maximum: 3840, default: 1280, description: '图片预览的长边像素上限。' }, maxBytes: { type: 'integer', minimum: 1024, maximum: 262144, default: 102400, description: 'JPEG 字节上限，自动降低质量或尺寸；不改原件。' }, outputIndex: { type: 'integer', minimum: 0 }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: EXTERNAL_LIMITS.mediaChunkBytes } }, required: ['ref'], additionalProperties: false },
  },
  {
    name: 'get_application_operation', tier: 'write', readOnly: true, requiresOperations: true,
    description: '读取本连接操作的持久事实；未知状态不会重放修改。断线、超时或换客户端后用原 operationId 查询，不要换标识重试。批量结果用 resultRef.operationId、resultRef.field 作为 operationId、resultField，携带 nextCursor 继续分页。',
    inputSchema: { ...z.toJSONSchema(operationReadInputSchema, { io: 'input' }), properties: { ...z.toJSONSchema(operationReadInputSchema, { io: 'input' }).properties, ...RESULT_DETAIL_FIELDS } },
  },
  {
    name: 'retry_application_operation_save', tier: 'write', readOnly: false, requiresOperations: true,
    description: '按原操作记录仅重试保存并核对原条件；不会重放业务修改，必须保留原编辑会话。',
    inputSchema: { type: 'object', properties: { operationId: { type: 'string', format: 'uuid' }, originalOperationId: { type: 'string', format: 'uuid' }, ...RESULT_DETAIL_FIELDS }, required: ['operationId', 'originalOperationId'], additionalProperties: false },
  },
  {
    name: 'review_application_operation', tier: 'write', readOnly: false, requiresOperations: true,
    description: '先自动核对原执行回执与领域读回证明；可判定就直接结案。仍无法确认时，在痕迹AI应用内打开“这次修改生效了吗？”面板并立即返回 awaiting_user_confirmation。用户已收到提示，可在应用中处理；没有生效、已经生效、稍后处理是三个独立选择。待处理项不过期，关闭或稍后处理保留保护。只修正本连接账本，不重放修改；智能体不能代替用户确认。',
    inputSchema: { type: 'object', properties: { operationId: { type: 'string', format: 'uuid' } }, required: ['operationId'], additionalProperties: false },
  },
]

export const readMediaInputSchema = z.object({
  ref: z.object({ kind: z.enum(APPLICATION_READABLE_MEDIA_KINDS), id: z.string().min(1).max(512) }).strict(),
  outputIndex: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  length: z.number().int().min(1).max(EXTERNAL_LIMITS.mediaChunkBytes).optional(),
  mode: z.enum(['chunk', 'image']).optional(),
  maxEdge: z.number().int().min(1).max(3840).optional(),
  maxBytes: z.number().int().min(1024).max(EXTERNAL_LIMITS.mediaChunkBytes).optional(),
}).strict()
export const describeContractInputSchema = z.object({
  domains: z.array(z.string().min(1)).max(16).default([]),
  detail: z.enum(['compact', 'full']).default('compact'),
  names: z.array(z.string().min(1)).optional(),
  includeSchemas: z.boolean().default(false),
}).strict().refine(input => !input.includeSchemas || Boolean(input.names?.length), 'includeSchemas=true 时请用 names 点名工具，按需分批查询。')

/**
 * 参数错误必须能指名字段。
 *
 * 基础工具"能直接调用并获得具体参数错误"是对外契约的一部分：把 Zod 的校验失败和业务失败
 * 收敛成同一句兜底文案，调用方就只能靠猜——媒体工具原先正是这样，多传一个字段和引用不存在
 * 返回完全相同的话。业务失败仍然保持脱敏（不回传本地路径），参数失败则原样点名。
 */

/** 只能经 retry_application_operation_save 触发的原领域恢复能力；有意不作为独立工具开放。 */
export const EXCLUDED_TOOLS = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()
  .filter(definition => definition.external?.kind === 'recovery')
  .map(definition => ({ name: definition.id, reason: definition.external!.reason }))

export function toolTier(name: string): ToolTier {
  if (BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.paidGenerationPreparation) return 'paid'
  if (APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === name)) return 'write'
  if (APPLICATION_READ_CAPABILITY_IDS.some((id) => id === name)) return 'read'
  return PROTOCOL_TOOL_SPECS.find((spec) => spec.name === name)?.tier ?? 'read'
}

function tierGranted(tier: ToolTier, access: ApplicationAccess): boolean {
  if (tier === 'write') return access.allowWrites
  if (tier === 'paid') return access.allowWrites && access.allowPaid
  return true
}

const TIER_REQUIREMENT: Record<Exclude<ToolTier, 'any' | 'read'>, string> = {
  write: '本连接未获「允许修改内容」授权',
  paid: '本连接未获「允许付费生成」授权',
}

function capabilityTool(tool: LocalTool): Tool {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(tool.id)
  const write = APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === tool.id)
  const schema = definition ? z.toJSONSchema(definition.inputSchema, { io: 'input', reused: 'ref' }) as Record<string, unknown> : { ...tool.inputSchema }
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
    name: tool.id, title: tool.title, description: tool.description + (definition && (definition.paidGenerationPreparation || definition.mayRequirePaidConfirmation) ? ' 费用与内容发送确认流程见 describe_application_contract；等待确认后查询原 operationId，不重复提交。' : '') + (tool.id === 'list_application_entities' ? ' items 与 refs 按索引对应，默认不重复 items.ref；includeDetails=true 可读取完整元数据。' : ''),
    inputSchema: { ...schema, properties: { ...schema.properties as Record<string, unknown>, ...resultDetailFields(tool.id) }, type: 'object' },
    ...(definition ? { outputSchema: { type: 'object', ...projectToolOutputSchema(z.toJSONSchema(write
      ? z.union([z.object({ ok: z.literal(true), result: z.object({ ok: z.literal(true), data: capabilityPublicOutputSchema(definition) }).passthrough() }).passthrough(), waitingOutput])
      : z.object({ ok: z.literal(true), data: capabilityPublicOutputSchema(definition) }).passthrough(),
    { io: 'output', reused: 'ref' }), tool.id) } as Tool['inputSchema'] } : {}),
    annotations: { readOnlyHint: !write, destructiveHint: tool.id === 'change_application_entities' || Boolean(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(tool.id)?.destructive), openWorldHint: false },
  }
}

/**
 * 外部连接的技能读取入口。技能是领域操作说明，不是业务能力：只读、不绑定任何实体，
 * 内置 Pi 已通过 skills_index 层拿到同一工具，所以只在外部目录里投影一次。
 * 参数与输出直接取正式能力声明，不在协议层另写 schema；可用技能清单在契约的 skills 中。
 */
export function assistantSkillTool(): Tool {
  const definition = loadAssistantSkillCapability
  return {
    name: definition.id, title: definition.title,
    description: `${definition.description} 外部连接先从 describe_application_contract 的 skills 取得可用技能名和适用条件；不支持读取 references/ 以外的文件。`,
    inputSchema: { ...z.toJSONSchema(definition.inputSchema, { io: 'input' }), properties: { ...z.toJSONSchema(definition.inputSchema, { io: 'input' }).properties, ...RESULT_DETAIL_FIELDS }, type: 'object' } as Tool['inputSchema'],
    // 技能名与路径的 NFC 归一化是输入变换，输出侧按普通字符串描述。
    outputSchema: z.toJSONSchema(z.object({ ok: z.literal(true), data: definition.outputSchema }).passthrough(), { io: 'output', unrepresentable: 'any' }) as Tool['inputSchema'],
    annotations: { readOnlyHint: true, openWorldHint: false },
  }
}

export interface ApplicationToolCatalog {
  tools: Tool[]
  hidden: Array<{ name: string; tier: ToolTier; requires: string }>
}

/** 仅规范化对象键；数组顺序保留，schema 内容变化仍会改变哈希。 */
function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize((item as Record<string, unknown>)[key])])) : item
  return JSON.stringify(normalize(value))
}

/** 客户端可用相同 SHA-256 算法核对本地缓存；不修改工具描述。 */
export function applicationToolSchemaHash(tool: Pick<Tool, 'name' | 'description' | 'inputSchema'>): string {
  return createHash('sha256').update(canonicalJson({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })).digest('hex').slice(0, 16)
}

export function applicationCatalogSchemaHash(catalog: ApplicationToolCatalog): string {
  return createHash('sha256').update(canonicalJson(catalog.tools.map(tool => ({ name: tool.name, schemaHash: applicationToolSchemaHash(tool) }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0))).digest('hex').slice(0, 16)
}

/**
 * 目录按本连接授权过滤，并把被挡住的工具单独记下来。
 *
 * 每次 `tools/list` 都按当前注册重新计算，所以渲染层重载、重新注册或撤销后再次列举就是最新目录；
 * MCP 适配器负责变更通知；Pi 与其他调用面直接消费同一目录。
 */
export function buildApplicationToolCatalog(input: { tools: readonly LocalTool[]; access: ApplicationAccess; operationsEnabled: boolean; includeSkillTool?: boolean }): ApplicationToolCatalog {
  const tools: Tool[] = []
  const hidden: ApplicationToolCatalog['hidden'] = []
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
      name: spec.name, description: spec.description, inputSchema: { ...spec.inputSchema, type: 'object', properties: { ...spec.inputSchema.properties as Record<string, unknown>, ...RESULT_DETAIL_FIELDS } } as Tool['inputSchema'],
      ...(spec.outputSchema ? { outputSchema: spec.outputSchema as Tool['inputSchema'] } : {}),
      annotations: { readOnlyHint: spec.readOnly, ...(spec.readOnly ? { openWorldHint: false } : { destructiveHint: false }) },
    }))
  }
  if (input.includeSkillTool) consider(loadAssistantSkillCapability.id, 'read', false, assistantSkillTool)
  return { tools: tools.sort((a, b) => a.name.localeCompare(b.name, 'en')), hidden }
}

const WORKFLOWS = [
  confirmationGuidance,
  '发现：describe_application_contract → describe_application_entities（按域过滤）→ list_application_entities（cursor/limit 分页，where 按属性等值定位）。',
  '读取：按任务需要读取实体，获取真实引用和属性；普通操作不需要额外读取来拼接基线。删除前才必须逐个读取目标与集合父对象。',
  '修改：把 operationId（客户端生成的 UUID）连同业务参数传给写工具。普通操作省略 baselineIds，由应用自动核对；删除或要求严格按旧状态写入时提供相关 baselineIds。勿传 expectedRevisions。同一 operationId 重传返回原事实，不会重复执行。',
  '镜头参考修订：2.6.0 起文档与子实体的 revisions、resultingRevisions 和宿主 scopeRevisions 使用 camera_stage，toolbox 仅表示工具箱自身状态。旧 toolbox 镜头基线返回 BASELINE_EXPIRED；请重新 read_application_entity 读取原目标，使用新 baselineId 提交。',
  '共享长期记忆：可通过通用实体工具读写 assistant.shared_memory，引用 id 为 singleton。新任务按需读取；有明确偏好或纠正时，带读取返回的 baselineIds 合并更新 content，CONFLICT 则重读重合并，不追加流水账；尊重用户关闭与连接写权限。查任务：生成默认用 wait_generation_task 等待终态，用户主动询问即时进度才用 get_generation_task，三维渲染用 get_camera_stage_render_task，写操作事实用 get_application_operation；等待工具由宿主跟进，其他即时查询按需调用，不需要客户端支持通知扩展。可用 subscriptions/listen 订阅工具目录变更；收到 notifications/tools/list_changed 后重新 tools/list。',
  '取结果：看图用 read_application_media(mode="image") 直接取得图片内容；其他媒体按 offset 分块读到 eof；不支持富媒体的客户端只消费 totalBytes／eof／错误码也能理解状态并继续。',
  '失败恢复：执行状态 unknown 时禁止换标识重试，用原 operationId 查询；partial 且账本登记了仅保存恢复入口时调 retry_application_operation_save，它不会重放业务修改。',
  '前置条件：写入被会话挡住时，对目标 ref 调 describe_application_entities，propertyAvailability 的 reasons 与 recoveries 就是声明层给出的前置条件和恢复入口。',
  '审批与授权：一律在痕迹 AI 内完成，协议侧没有提权通道；客户端自报权限、名称或"已批准"无效。',
]

export function buildApplicationContract(input: {
  callerKind?: 'external' | 'embedded'
  domains: readonly LocalDomainSurface[]
  access: ApplicationAccess
  catalog: ApplicationToolCatalog
  port: number
  requestedDomains: readonly string[]
  detail?: 'compact' | 'full'
  names?: readonly string[]
  includeSchemas?: boolean
  /** 外部连接可读的技能索引（只含名称与适用条件）；内置 Pi 走 skills_index 层，不在契约里重复。 */
  skills?: ReadonlyArray<{ name: string; description: string }>
}): Record<string, unknown> {
  const requested = new Set(input.requestedDomains)
  const names = input.names === undefined ? undefined : new Set(input.names)
  // 不指定 names 时只给目录整体哈希，避免默认响应列出全部工具；需要逐个核对时按 names 查询。
  const toolSchemas = names === undefined ? undefined : input.catalog.tools.filter(tool => names.has(tool.name)).map(tool => ({
    name: tool.name, schemaHash: applicationToolSchemaHash(tool),
    ...(input.includeSchemas && names ? { description: tool.description, inputSchema: tool.inputSchema } : {}),
  }))
  const full = {
    contract: {
      externalContractVersion: EXTERNAL_CONTRACT_VERSION,
      applicationCapabilityCatalog: APPLICATION_CAPABILITY_CATALOG_VERSION,
      server: EXTERNAL_SERVER_INFO,
      protocolVersions: [...EXTERNAL_PROTOCOL_VERSIONS],
      sdkVersion: EXTERNAL_SDK_VERSION,
      transport: input.callerKind === 'embedded' ? { kind: 'embedded', authorization: '助手对话中的操作权限', requiresExternalConnection: false } : { kind: 'streamable-http', url: `http://127.0.0.1:${input.port}/mcp`, authorization: 'Bearer <连接令牌>', json: true, serverSentEvents: true, listChangedNotifications: true, subscriptions: 'subscriptions/listen', listChangedPolicy: '订阅 toolsListChanged 后，仅工具定义或契约版本真实变化才发送 notifications/tools/list_changed，客户端据此重新 tools/list；普通上下文更新与同目录重连不发。连接权限变更时向该连接发送 tools/resources 的 list_changed，需重读目录；撤销连接关闭旧订阅。应用重启关闭旧连接，重连后重新订阅并读取目录。' },
      limits: EXTERNAL_LIMITS,
      deprecationPolicy: EXTERNAL_DEPRECATION_POLICY,
    },
    catalogSchemaHash: applicationCatalogSchemaHash(input.catalog),
    schemaHashAlgorithm: 'SHA-256(键排序 JSON{name,description,inputSchema}) 前16位；目录哈希为按 name 排序的 [{name,schemaHash}] 同算法。',
    ...(toolSchemas ? { toolSchemas } : { toolSchemasHint: '按 names 查询各工具 schemaHash；加 includeSchemas:true 取完整参数。' }),
    access: {
      read: true, write: input.access.allowWrites, destructive: input.access.allowDestructive, paid: input.access.allowPaid,
      hiddenTools: input.catalog.hidden,
      excludedTools: EXCLUDED_TOOLS.map((excluded) => ({ ...excluded })),
      alternativeRoutes: BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()
        .filter(definition => definition.side === 'frontend' && definition.external && requested.has(definition.domain))
        .map(definition => ({ name: definition.id, ...definition.external })),
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
      envelope: APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === tool.name) ? 'operationId+baselineIds' : 'none',
      ...(APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === tool.name) ? { baselinePolicy: '普通操作可省略 baselineIds，破坏性操作必填。' } : {}),
    })),
    ...(input.skills ? { skills: {
      tool: loadAssistantSkillCapability.id,
      usage: '任务匹配某个技能的适用条件时，先不带 path 读取主文件，再按主文件里的表格只读当前步骤需要的一份 references/ 文件；不要预读全部。技能只是操作说明，不改变授权与工具范围。',
      index: input.skills.map(skill => ({ name: skill.name, description: skill.description })),
    } } : {}),
    workflows: input.skills?.length ? [...WORKFLOWS, '技能：部分专业流程有操作说明，见 skills；任务匹配时用 load_assistant_skill 按需读取，不预读全部。'] : WORKFLOWS,
  }
  if (input.detail === 'full') return full
  const { deprecationPolicy: _deprecationPolicy, ...contract } = full.contract
  return {
    contract,
    catalogSchemaHash: full.catalogSchemaHash,
    schemaHashAlgorithm: full.schemaHashAlgorithm,
    toolSchemas,
    access: { read: true, write: input.access.allowWrites, destructive: input.access.allowDestructive, paid: input.access.allowPaid,
      ...(input.requestedDomains.length ? { alternativeRoutes: full.access.alternativeRoutes } : {}),
      note: input.callerKind === 'embedded' ? '授权来自对话框的「助手操作权限」，不需要 MCP 连接。仅执行用户请求范围内的操作。'
        : '授权仅在痕迹 AI 内调整。工具缺席表示缺授权档；PERMISSION_DENIED 表示本次目标不允许。' },
    domains: full.domains,
    ...(full.skills ? { skills: { tool: full.skills.tool, index: full.skills.index } } : {}),
    workflows: [
      '发现：describe_application_entities 按域查属性；list_application_entities 用分页/where 定位；read_application_entity 读属性与 baselineId。tools/list 查工具，契约 detail="full" 查排除与弃用。',
      '写入：生成 UUID operationId，重传同 ID 返回原事实。baselineIds 普通修改/新增可省略，共享记忆和删除须读基线；删除先读目标及集合父对象。勿传 expectedRevisions。includeRevisions/includeEvidence=true 展开修订/证据。',
      '恢复：unknown 查 get_application_operation，沿原 operationId，禁止重放；partial 仅恢复保存。前置拒绝用 describe_application_entities(refs) 查条件。',
      '结果：wait_generation_task 等生成终态；read_application_media(mode="image") 看图，其他媒体读至 eof。load_assistant_skill 按适用条件读主文件和单份参考。',
      confirmationGuidance,
    ],
  }
}
