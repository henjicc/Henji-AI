import { z } from 'zod'

export const WORKSPACE_LAYOUT_VERSION = 1
// Dockview 的扩展字段保留原样；面板引用和几何由注册工作区的严格校验器检查。
export const workspaceLayoutSchema = z.object({
  grid: z.object({ width: z.number().nonnegative(), height: z.number().nonnegative(), orientation: z.enum(['HORIZONTAL', 'VERTICAL']), root: z.json() }).passthrough(),
  panels: z.record(z.string(), z.object({ id: z.string(), contentComponent: z.string() }).passthrough()),
}).passthrough()
export const workspaceLayoutStateSchema = z.object({
  activeId: z.string().min(1),
  current: workspaceLayoutSchema,
  users: z.array(z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(80), layout: workspaceLayoutSchema }).passthrough()),
}).passthrough()
export const workspaceLayoutEnvelopeSchema = z.object({
  version: z.number().int().positive(), minReaderVersion: z.number().int().positive(),
  content: workspaceLayoutStateSchema,
}).passthrough()

/** 正式配置序列化入口，同时供黄金样本构造使用。 */
export function createWorkspaceLayoutEnvelope(content: unknown): z.infer<typeof workspaceLayoutEnvelopeSchema> {
  return workspaceLayoutEnvelopeSchema.parse({ version: WORKSPACE_LAYOUT_VERSION, minReaderVersion: WORKSPACE_LAYOUT_VERSION, content })
}
