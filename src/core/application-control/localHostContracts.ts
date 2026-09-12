import { z } from 'zod'
import { applicationVerificationConditionSchema, applicationEvidenceSchema } from './transactions'

export const MCP_READ_CAPABILITY_IDS = ['describe_application_entities', 'list_application_entities', 'read_application_entity', 'search_models', 'get_model_schema', 'prepare_generation_task', 'get_generation_task', 'get_camera_stage_render_task'] as const
export const MCP_WRITE_CAPABILITY_IDS = ['change_application_entities', 'create_visible_generation_task', 'cancel_generation_task', 'render_camera_stage_output', 'cancel_camera_stage_render_task', 'add_generation_result_to_canvas'] as const
export const MCP_CAPABILITY_IDS = [...MCP_READ_CAPABILITY_IDS, ...MCP_WRITE_CAPABILITY_IDS, 'retry_canvas_project_save', 'retry_image_edit_document_save'] as const
export const MCP_WRITE_PERMISSIONS = ['application:write', 'settings:write', 'models:write', 'model_catalog:write', 'assets:write', 'canvas:write', 'canvas:project_write', 'generation:write', 'generation:create', 'generation:cancel', 'camera_stage:write', 'image_edit:write', 'image_mark:write'] as const
export const MCP_READ_PERMISSIONS = ['application:read', 'settings:read', 'models:read', 'model_catalog:read', 'assets:read', 'canvas:read', 'generation:read', 'generation:prepare', 'image_edit:read', 'image_mark:read', 'camera_stage:read', 'toolbox:read', 'navigation:read', 'storyboard:read'] as const
export const localHostRequestSchema = z.object({
  requestId: z.string().uuid(), sessionId: z.string().uuid(), callerId: z.string().uuid(),
  capabilityId: z.enum(MCP_CAPABILITY_IDS), input: z.record(z.string(), z.unknown()),
  allowWrites: z.boolean().optional(), allowDestructive: z.boolean().optional(), allowPaid: z.boolean().optional(), operationId: z.string().uuid().optional(),
  expectedRevisions: z.record(z.string(), z.number()).optional(),
  recoveryVerification: z.object({ conditions: z.array(applicationVerificationConditionSchema).max(256), evidence: z.array(applicationEvidenceSchema).max(256) }).optional(),
}).strict()
export type LocalHostRequest = z.infer<typeof localHostRequestSchema>
export const localHostReplySchema = z.object({
  requestId: z.string().uuid(), sessionId: z.string().uuid(),
  result: z.record(z.string(), z.unknown()),
}).strict()
export type LocalHostReply = z.infer<typeof localHostReplySchema>
export const localToolSchema = z.object({
  id: z.enum(MCP_CAPABILITY_IDS), version: z.number().int().positive(),
  title: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()),
}).strict()
export type LocalTool = z.infer<typeof localToolSchema>

/**
 * 外部可见的实体面。**全部字段都从反射注册表的真实声明派生**，不在这里维护第二份业务清单。
 *
 * `readOnlyReason` 直接来自实体的 `writeExclusion.reason`——门禁（collectionCoverage.test.ts）
 * 已经保证「要么能写，要么写明由谁维护」，所以外部看到的"有意排除"不可能是"忘了实现"。
 */
export const localEntitySurfaceSchema = z.object({
  id: z.string().min(1).max(128), title: z.string().min(1).max(120),
  writableProperties: z.number().int().nonnegative(),
  creatable: z.boolean(), removable: z.boolean(),
  readOnlyReason: z.string().min(1).max(500).optional(),
}).strict()
export type LocalEntitySurface = z.infer<typeof localEntitySurfaceSchema>
export const localDomainSurfaceSchema = z.object({
  id: z.string().min(1).max(128), readable: z.boolean(), writable: z.boolean(),
  entities: z.array(localEntitySurfaceSchema).max(128),
}).strict()
export type LocalDomainSurface = z.infer<typeof localDomainSurfaceSchema>

export const localHostRegistrationSchema = z.object({
  sessionId: z.string().uuid(), generation: z.number().nonnegative(), ready: z.boolean(), tools: z.array(localToolSchema).max(32),
  // 新增可选字段：旧宿主注册（1.2／2.x 形状）仍然通过校验，只是没有按域发现与派生写入范围。
  domains: z.array(localDomainSurfaceSchema).max(32).default([]),
}).strict()
export type LocalHostRegistration = z.infer<typeof localHostRegistrationSchema>
/** 注册方视角：`domains` 可省略，旧形状的宿主注册仍然合法。 */
export type LocalHostRegistrationInput = z.input<typeof localHostRegistrationSchema>

/** 通用读改增删真正能落到这个实体上的条件；`change_application_entities` 的写入范围由它决定。 */
export function externalWritable(entity: LocalEntitySurface): boolean {
  return entity.writableProperties > 0 || entity.creatable || entity.removable
}
/** 主进程据此判定"这个实体属不属于公开业务写入范围"，不再维护 entityType 前缀白名单。 */
export function externalWritableEntityTypes(domains: readonly LocalDomainSurface[]): string[] {
  return domains.flatMap((domain) => domain.entities.filter(externalWritable).map((entity) => entity.id))
}

/**
 * 对外契约版本。协议版本、SDK 版本与应用能力目录版本三者分开管理，客户端按本字段判断兼容性，
 * **不要按工具数量、顺序或名称前缀判断**。
 *
 * 弃用规则：同一主版本内不删除对外工具名、不新增必填参数、不改变已公布错误码含义；新增字段
 * 一律可选。破坏性变更提升主版本，并在至少一个次版本内保留旧工具名且在 description 标注弃用。
 */
export const EXTERNAL_CONTRACT_VERSION = '1.0.0' as const
/** 实测握手通过的协议版本；未列出的版本由 SDK 回落到本服务支持的最新版本，不会直接失败。 */
export const EXTERNAL_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const EXTERNAL_SDK_VERSION = '1.30.0' as const
export const EXTERNAL_SERVER_INFO = { name: 'henji', version: '1.0.0' } as const
export const EXTERNAL_LIMITS = {
  requestBytes: 256 * 1024, resultBytes: 2 * 1024 * 1024, mediaChunkBytes: 256 * 1024,
  concurrentRequests: 8, sessions: 16, idleSessionMs: 30 * 60_000, requestTimeoutMs: 30_000,
} as const
export const EXTERNAL_DEPRECATION_POLICY = '同一 externalContractVersion 主版本内不删除工具名、不新增必填参数、不改变已公布错误码含义；新增字段一律可选。破坏性变更提升主版本，并在至少一个次版本内保留旧工具名并在 description 标注弃用。'

export interface McpConnectionInfo { id: string; name: string; expiresAt: number; allowWrites?: boolean; allowDestructive?: boolean; allowPaid?: boolean }
export interface McpStatus { enabled: boolean; ready: boolean; port: number; connections: McpConnectionInfo[] }
export interface McpPlatform {
  status(): Promise<McpStatus>
  configure(input: { enabled: boolean; port: number }): Promise<McpStatus>
  authorize(input: { name: string; allowWrites?: boolean; allowDestructive?: boolean; allowPaid?: boolean }): Promise<McpConnectionInfo>
  revoke(input: { id: string }): Promise<void>
  connectionConfig(input: { id: string }): Promise<string>
  registerHost(input: LocalHostRegistrationInput): Promise<void>
  complete(input: LocalHostReply): Promise<void>
  onRequest(handler: (request: LocalHostRequest) => void): () => void
  onCancel(handler: (requestId: string) => void): () => void
  onRevoke(handler: (callerId: string) => void): () => void
}
