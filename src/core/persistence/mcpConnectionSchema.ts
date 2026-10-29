import { z } from 'zod'

/** keystore 中的解密后契约；登记和样本只使用合成值，绝不读取真实凭据。v2 起连接永久有效，直到用户撤销。 */
export const MCP_CONNECTION_STORAGE_VERSION = 3
export const mcpConnectionRecordSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(80),
  token: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export const mcpConnectionStorageSchema = z.object({ version: z.literal(MCP_CONNECTION_STORAGE_VERSION), connections: z.array(mcpConnectionRecordSchema) }).strict()

/** 1 → 2：去掉到期时间与到期提醒，已有连接保留令牌与权限，变为永久有效。 */
export function migrateMcpConnectionStorageV1(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const connections = (content as { connections?: unknown }).connections
  return { ...content, version: 2, connections: Array.isArray(connections) ? connections.map((record: unknown) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record
    const { expiresAt: _expiresAt, reminders: _reminders, ...rest } = record as Record<string, unknown>
    return rest
  }) : connections }
}

/** 2 → 3：连接只保存身份与令牌，删除已退役的权限位；原令牌继续有效。 */
export function migrateMcpConnectionIdentity(content: unknown): unknown {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return content
  const { connections } = content as { connections?: unknown }
  return { ...content, version: 3, connections: Array.isArray(connections) ? connections.map((record: unknown) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record
    const { allowWrites: _writes, allowDestructive: _destructive, allowPaid: _paid, ...identity } = record as Record<string, unknown>
    return identity
  }) : connections }
}
