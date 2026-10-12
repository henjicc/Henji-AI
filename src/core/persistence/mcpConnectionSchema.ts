import { z } from 'zod'

/** keystore 中的解密后契约；登记和样本只使用合成值，绝不读取真实凭据。 */
export const MCP_CONNECTION_STORAGE_VERSION = 1
export const mcpConnectionRecordSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(80), expiresAt: z.number().finite(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  allowWrites: z.boolean().default(false), allowDestructive: z.boolean().default(false), allowPaid: z.boolean().default(false),
  reminders: z.object({ expiresAt: z.number().finite(), states: z.array(z.enum(['expiring', 'expired'])) }).strict().optional(),
}).strict()
export const mcpConnectionStorageSchema = z.object({ version: z.literal(MCP_CONNECTION_STORAGE_VERSION), connections: z.array(mcpConnectionRecordSchema) }).strict()
