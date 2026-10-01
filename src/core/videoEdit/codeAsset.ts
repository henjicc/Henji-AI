import { z } from 'zod'
import { codeMaterialInstanceSchema, codeMaterialVersionSchema } from './codeMaterialPersistence'
import { CODE_MATERIAL_LIMITS } from './codeMaterial/contract'

export const CODE_ASSET_LIMITS = Object.freeze({ bytes: 512 * 1024, images: 32 })
export const CODE_ASSET_MIME = 'application/x-henji-code'
export const codeAssetContentSchema = z.object({ sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), fileModifiedAt: z.number().finite().nonnegative(), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const image = z.object({
  id: z.string().min(1).max(100), path: z.string().min(1).max(4096).refine(value => !value.includes('\0') && /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value), '图片依赖需要原文件绝对路径。'),
  content: codeAssetContentSchema, assetId: z.string().min(1).max(100).optional(),
}).strict()
export const codeAssetSchema = z.object({
  format: z.literal('henji-code-asset'), version: z.literal(1), name: z.string().trim().min(1).max(200),
  sourceVersion: codeMaterialVersionSchema.omit({ id: true, assetOrigin: true }),
  parameters: codeMaterialInstanceSchema.shape.parameters,
  curves: codeMaterialInstanceSchema.shape.curves,
  images: z.array(image).max(CODE_ASSET_LIMITS.images),
}).strict().superRefine((value, context) => {
  if (new TextEncoder().encode(value.sourceVersion.source).byteLength > CODE_MATERIAL_LIMITS.sourceBytes) context.addIssue({ code: 'custom', message: '代码素材源码最多64KiB。' })
  const ids = value.images.map(image => image.id)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: '代码素材图片依赖标识重复。' })
  const references = Object.values(value.parameters).flatMap(value => value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'image' ? [value.mediaId] : [])
  if (references.some(id => !ids.includes(id)) || ids.some(id => !references.includes(id))) context.addIssue({ code: 'custom', message: '图片参数与固定依赖清单不一致。' })
})
export type CodeAsset = z.infer<typeof codeAssetSchema>

/** A file owns source and raw instance values; executable IR is never accepted. */
export function decodeCodeAsset(bytes: Uint8Array): CodeAsset {
  if (!bytes.byteLength || bytes.byteLength > CODE_ASSET_LIMITS.bytes) throw new Error('代码素材清单不能为空且最多512KiB。')
  return codeAssetSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
}
export function encodeCodeAsset(input: CodeAsset): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(codeAssetSchema.parse(input)))
  if (bytes.byteLength > CODE_ASSET_LIMITS.bytes) throw new Error('代码素材清单最多512KiB。')
  return bytes
}
