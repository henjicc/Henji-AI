import { codeSourcesSchema, rememberCodeSource, componentFileReferences, type CodeSourceResolver } from './codeMaterial/sources'
import { z } from 'zod'
import { codeMaterialInstanceSchema, codeMaterialVersionSchema } from './codeMaterialPersistence'
import { isCodeImageReference } from './codeMaterial/contract'
import { codeElementOverridesSchema } from './codeElementOverrides'
import { formatMigrations } from '../persistence/formatMigrations'
import { PersistenceError, upgradePersistenceContent, type PersistenceContract } from '../persistence/migrations'

/** Bytes bound a serialized source manifest; image dependency count has no product ceiling. */
export const CODE_ASSET_LIMITS = Object.freeze({ bytes: 512 * 1024 })
export const CODE_ASSET_MIME = 'application/x-henji-code'
export const CODE_ASSET_VERSION = 1
export const codeAssetContentSchema = z.object({ sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), fileModifiedAt: z.number().finite().nonnegative(), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const image = z.object({
  id: z.string().min(1).max(100), path: z.string().min(1).max(4096).refine(value => !value.includes('\0') && /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value), '图片依赖需要原文件绝对路径。'),
  content: codeAssetContentSchema, assetId: z.string().min(1).max(100).optional(),
}).strict()
export const codeAssetSchema = z.object({
  format: z.literal('henji-code-asset'), version: z.literal(CODE_ASSET_VERSION), name: z.string().trim().min(1).max(200),
  sourceVersion: z.object({ apiVersion: codeMaterialVersionSchema.shape.apiVersion, languageVersion: codeMaterialVersionSchema.shape.languageVersion, entry: codeMaterialVersionSchema.shape.entry, files: codeMaterialVersionSchema.shape.files, imports: codeMaterialVersionSchema.shape.imports }).strict(),
  codeSources: codeSourcesSchema,
  parameters: codeMaterialInstanceSchema.shape.parameters,
  curves: codeMaterialInstanceSchema.shape.curves,
  elementOverrides: codeElementOverridesSchema.optional(),
  images: z.array(image),
}).strict().superRefine((value, context) => {
  const hashes = new Set(value.codeSources.map(source => source.hash))
  if ([...value.sourceVersion.files, ...componentFileReferences(value.sourceVersion.imports)].some(file => !hashes.has(file.hash))) context.addIssue({ code: 'custom', message: '代码资产的源码或固定组件依赖缺失。' })
  try { codeMaterialVersionSchema.parse({ ...value.sourceVersion, id: 'asset-version' }) } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '代码素材文件无效。' }) }
  const ids = value.images.map(image => image.id)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: '代码素材图片依赖标识重复。' })
  const references = Object.values(value.parameters).flatMap(value => isCodeImageReference(value) ? [value.mediaId] : [])
  if (references.some(id => !ids.includes(id)) || ids.some(id => !references.includes(id))) context.addIssue({ code: 'custom', message: '图片参数与固定依赖清单不一致。' })
})
export type CodeAsset = z.infer<typeof codeAssetSchema>
/** Archive payloads carry text; ordinary documents never do. Verification precedes import publication. */
export function assetCodeSourceResolver(asset: CodeAsset): CodeSourceResolver {
  const sources = new Map(asset.codeSources.map(value => [value.hash, value.source]))
  return { read(hash, _location, path): string { const source = sources.get(hash); if (source === undefined) throw new Error(`${path ?? '代码文件'} 的资产源码缺失。`); return source } }
}
export function rememberCodeAssetSources(asset: CodeAsset): void { for (const source of asset.codeSources) rememberCodeSource(source.hash, source.source) }

/** A file owns source and raw instance values; executable IR is never accepted. */
export function codeAssetContract(): PersistenceContract { return { id: 'code-asset', name: '可编辑代码资产', version: CODE_ASSET_VERSION, schema: codeAssetSchema, migrations: formatMigrations('code-asset') } }
export function parseCodeAssetBytes(bytes: Uint8Array, backupPath?: string): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch (cause) { throw new PersistenceError('corrupt', 'code-asset', '可编辑代码资产', 0, CODE_ASSET_VERSION, [], backupPath, { cause }) }
}
export function decodeCodeAsset(bytes: Uint8Array, backupPath?: string): CodeAsset {
  if (!bytes.byteLength || bytes.byteLength > CODE_ASSET_LIMITS.bytes) throw new Error('代码素材清单不能为空且最多512KiB。')
  const raw = parseCodeAssetBytes(bytes, backupPath)
  const version = raw && typeof raw === 'object' && 'version' in raw && typeof raw.version === 'number' ? raw.version : 0
  return codeAssetSchema.parse(upgradePersistenceContent(codeAssetContract(), raw, version, backupPath))
}
export function encodeCodeAsset(input: CodeAsset): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(codeAssetSchema.parse(input)))
  if (bytes.byteLength > CODE_ASSET_LIMITS.bytes) throw new Error('代码素材清单最多512KiB。')
  return bytes
}
