import { z } from 'zod'
import type { HostContextSnapshot } from './hostContracts'
import { applicationVerificationConditionSchema, applicationEvidenceSchema } from './transactions'
import { EXTERNAL_APPLICATION_CAPABILITIES } from './externalCapabilityPolicy'

export const APPLICATION_READ_CAPABILITY_IDS = EXTERNAL_APPLICATION_CAPABILITIES.read.map(definition => definition.id)
export const APPLICATION_WRITE_CAPABILITY_IDS = EXTERNAL_APPLICATION_CAPABILITIES.write.map(definition => definition.id)
export const APPLICATION_CAPABILITY_IDS = EXTERNAL_APPLICATION_CAPABILITIES.all.map(definition => definition.id)
export const APPLICATION_WRITE_PERMISSIONS = [...new Set(EXTERNAL_APPLICATION_CAPABILITIES.write.map(definition => definition.permission))]
export const APPLICATION_READ_PERMISSIONS = [...new Set(EXTERNAL_APPLICATION_CAPABILITIES.read.map(definition => definition.permission))]
export const localHostRequestSchema = z.object({
  requestId: z.string().uuid(), rendererEpoch: z.string().uuid(), callerId: z.string().uuid(),
  capabilityId: z.enum(APPLICATION_CAPABILITY_IDS), input: z.record(z.string(), z.unknown()),
  allowWrites: z.boolean().optional(), allowDestructive: z.boolean().optional(), allowPaid: z.boolean().optional(), operationId: z.string().uuid().optional(),
  expectedRevisions: z.record(z.string(), z.number()).optional(),
  recoveryVerification: z.object({ conditions: z.array(applicationVerificationConditionSchema).max(256), evidence: z.array(applicationEvidenceSchema).max(256) }).optional(),
}).strict()
export type LocalHostRequest = z.infer<typeof localHostRequestSchema>
export const localHostReplySchema = z.object({
  requestId: z.string().uuid(), rendererEpoch: z.string().uuid(),
  result: z.record(z.string(), z.unknown()),
}).strict()
export type LocalHostReply = z.infer<typeof localHostReplySchema>
export const localToolSchema = z.object({
  id: z.enum(APPLICATION_CAPABILITY_IDS), version: z.number().int().positive(),
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
  rendererEpoch: z.string().uuid(), attachmentSequence: z.number().nonnegative(), ready: z.boolean(), tools: z.array(localToolSchema).max(256),
  domains: z.array(localDomainSurfaceSchema).max(32),
}).strict()
export type LocalHostRegistration = z.infer<typeof localHostRegistrationSchema>
/** 可信宿主必须提交完整注册信息。 */
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
 * 当前只支持新应用契约，不提供旧工具或旧协议兼容入口。
 */
export const EXTERNAL_CONTRACT_VERSION = '2.0.0' as const
/** 正式支持的现代协议；旧握手和其他版本拒绝，不降级。 */
export const EXTERNAL_PROTOCOL_VERSIONS = ['2026-07-28'] as const
export const EXTERNAL_SDK_VERSION = '2.0.0' as const
export const EXTERNAL_SERVER_INFO = { name: 'henji', version: '2.0.0' } as const
export const EXTERNAL_LIMITS = {
  requestBytes: 256 * 1024, resultBytes: 2 * 1024 * 1024, mediaChunkBytes: 256 * 1024,
  concurrentRequests: 8, requestTimeoutMs: 30_000,
} as const
export const EXTERNAL_DEPRECATION_POLICY = '当前仅支持 application contract 2 与 MCP 2026-07-28；旧工具接口和旧协议不兼容，客户端需按当前声明调用。'

export interface McpConnectionInfo { id: string; name: string; expiresAt: number; allowWrites?: boolean; allowDestructive?: boolean; allowPaid?: boolean }
export const mcpDefaultAccessSchema = z.object({ allowWrites: z.boolean(), allowDestructive: z.boolean(), allowPaid: z.boolean() }).strict()
export const mcpPreferencesSchema = z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535), defaultAccess: mcpDefaultAccessSchema }).strict()
export type McpPreferences = z.infer<typeof mcpPreferencesSchema>
export const DEFAULT_MCP_PREFERENCES: McpPreferences = { enabled: true, port: 43821, defaultAccess: { allowWrites: true, allowDestructive: true, allowPaid: true } }
export interface McpStatus { enabled: boolean; ready: boolean; port: number; connections: McpConnectionInfo[]; defaultAccess?: McpPreferences['defaultAccess'] }
export interface McpPlatform {
  status(): Promise<McpStatus>
  configure(input: { enabled: boolean; port: number; defaultAccess?: McpPreferences['defaultAccess'] }): Promise<McpStatus>
  authorize(input: { name: string; allowWrites?: boolean; allowDestructive?: boolean; allowPaid?: boolean }): Promise<McpConnectionInfo>
  revoke(input: { id: string }): Promise<void>
  connectionConfig(input: { id: string }): Promise<string>
}
export interface ApplicationHostPlatform {
  publishContext(snapshot: HostContextSnapshot): Promise<void>
  registerHost(input: LocalHostRegistrationInput): Promise<void>
  complete(input: LocalHostReply): Promise<void>
  onRequest(handler: (request: LocalHostRequest) => void): () => void
  onCancel(handler: (requestId: string) => void): () => void
  onRevoke(handler: (callerId: string) => void): () => void
}
