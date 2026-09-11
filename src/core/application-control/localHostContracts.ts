import { z } from 'zod'

export const MCP_READ_CAPABILITY_IDS = ['describe_application_entities', 'list_application_entities', 'read_application_entity'] as const
export const MCP_READ_PERMISSIONS = ['application:read', 'settings:read', 'models:read', 'model_catalog:read', 'assets:read', 'canvas:read', 'generation:read', 'image_edit:read', 'image_mark:read', 'camera_stage:read', 'toolbox:read', 'navigation:read', 'storyboard:read'] as const
export const localHostRequestSchema = z.object({
  requestId: z.string().uuid(), sessionId: z.string().uuid(), callerId: z.string().uuid(),
  capabilityId: z.enum(MCP_READ_CAPABILITY_IDS), input: z.record(z.string(), z.unknown()),
}).strict()
export type LocalHostRequest = z.infer<typeof localHostRequestSchema>
export const localHostReplySchema = z.object({
  requestId: z.string().uuid(), sessionId: z.string().uuid(),
  result: z.record(z.string(), z.unknown()),
}).strict()
export type LocalHostReply = z.infer<typeof localHostReplySchema>
export const localToolSchema = z.object({
  id: z.enum(MCP_READ_CAPABILITY_IDS), version: z.number().int().positive(),
  title: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()),
}).strict()
export type LocalTool = z.infer<typeof localToolSchema>
export const localHostRegistrationSchema = z.object({
  sessionId: z.string().uuid(), generation: z.number().nonnegative(), ready: z.boolean(), tools: z.array(localToolSchema).max(3),
}).strict()
export type LocalHostRegistration = z.infer<typeof localHostRegistrationSchema>
export interface McpConnectionInfo { id: string; name: string; expiresAt: number }
export interface McpStatus { enabled: boolean; ready: boolean; port: number; connections: McpConnectionInfo[] }
export interface McpPlatform {
  status(): Promise<McpStatus>
  configure(input: { enabled: boolean; port: number }): Promise<McpStatus>
  authorize(input: { name: string }): Promise<McpConnectionInfo>
  revoke(input: { id: string }): Promise<void>
  connectionConfig(input: { id: string }): Promise<string>
  registerHost(input: LocalHostRegistration): Promise<void>
  complete(input: LocalHostReply): Promise<void>
  onRequest(handler: (request: LocalHostRequest) => void): () => void
  onCancel(handler: (requestId: string) => void): () => void
  onRevoke(handler: (callerId: string) => void): () => void
}
