import { z } from 'zod'

export const codeAssetContentSchema = z.object({ sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), fileModifiedAt: z.number().finite().nonnegative(), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const codeMediaDependencySchema = z.object({
  id: z.string().min(1).max(100), path: z.string().min(1).max(4096).refine(value => !value.includes('\0') && /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value), '媒体依赖需要原文件绝对路径。'),
  kind: z.enum(['image', 'video', 'audio']), content: codeAssetContentSchema, assetId: z.string().min(1).max(100).optional(),
}).strict()
export type CodeMediaDependency = z.infer<typeof codeMediaDependencySchema>
