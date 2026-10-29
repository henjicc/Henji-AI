import { codeSourcesSchema, rememberCodeSource, componentFileReferences, type CodeSourceResolver } from './codeMaterial/sources'
import { z } from 'zod'
import { codeMaterialInstanceSchema, codeMaterialVersionSchema } from './codeMaterialPersistence'
import { isCodeImageReference, isCodeAudioReference, isCodeSceneReference } from './codeMaterial/contract'
import { codeElementOverridesSchema } from './codeElementOverrides'
import { formatMigrations } from '../persistence/formatMigrations'
import { PersistenceError, upgradePersistenceContent, type PersistenceContract } from '../persistence/migrations'

export const CODE_ASSET_MIME = 'application/x-henji-code'
export const CODE_ASSET_VERSION = 12
/** v10 可携带作者接口 v6；旧程序不能正确执行排版库，必须明确要求升级。 */
export const CODE_ASSET_MIN_READER_VERSION = 10
export const codeAssetContentSchema = z.object({ sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), fileModifiedAt: z.number().finite().nonnegative(), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const image = z.object({
  id: z.string().min(1).max(100), path: z.string().min(1).max(4096).refine(value => !value.includes('\0') && /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value), '媒体依赖需要原文件绝对路径。'),
  kind: z.enum(['image', 'video', 'audio']), content: codeAssetContentSchema, assetId: z.string().min(1).max(100).optional(),
}).strict()
export const codeAssetSchema = z.object({
  format: z.literal('henji-code-asset'), version: z.literal(CODE_ASSET_VERSION), minReaderVersion: z.number().int().positive().optional(), name: z.string().trim().min(1).max(200),
  sourceVersion: z.object({ apiVersion: codeMaterialVersionSchema.shape.apiVersion, languageVersion: codeMaterialVersionSchema.shape.languageVersion, entry: codeMaterialVersionSchema.shape.entry, files: codeMaterialVersionSchema.shape.files, imports: codeMaterialVersionSchema.shape.imports, libraries: codeMaterialVersionSchema.shape.libraries }).strict(),
  codeSources: codeSourcesSchema,
  parameters: codeMaterialInstanceSchema.shape.parameters,
  curves: codeMaterialInstanceSchema.shape.curves,
  elementOverrides: codeElementOverridesSchema.optional(),
  images: z.array(image),
}).strict().superRefine((value, context) => {
  const hashes = new Set(value.codeSources.map(source => source.hash))
  if ([...value.sourceVersion.files, ...componentFileReferences(value.sourceVersion.imports)].some(file => !hashes.has(file.hash))) context.addIssue({ code: 'custom', message: '代码资产的源码或固定组件依赖缺失。' })
  try { codeMaterialVersionSchema.parse({ ...value.sourceVersion, id: 'asset-version' }) } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '代码素材文件无效。' }) }
  // 片子数据存在剪辑里，资产不携带它，片子数据参数在资产里只能是 null。
  if (Object.values(value.parameters).some(isCodeSceneReference)) context.addIssue({ code: 'custom', message: '代码资产不携带片子数据，片子数据参数须为空。' })
  const ids = value.images.map(image => image.id)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: '代码素材媒体依赖标识重复。' })
  const references = Object.values(value.parameters).flatMap(value => (isCodeImageReference(value) && (value.kind === 'image' || value.kind === 'video') || isCodeAudioReference(value)) ? [value.mediaId] : [])
  if (references.some(id => !ids.includes(id)) || ids.some(id => !references.includes(id))) context.addIssue({ code: 'custom', message: '媒体参数与固定依赖清单不一致。' })
  for (const parameter of Object.values(value.parameters)) {
    if (!isCodeAudioReference(parameter) && !isCodeImageReference(parameter) || parameter.kind === 'sequence' || parameter.kind === 'web') continue
    const dependency = value.images.find(media => media.id === parameter.mediaId)
    if (dependency && (parameter.kind === 'audio' ? !['audio', 'video'].includes(dependency.kind) : parameter.kind !== dependency.kind)) context.addIssue({ code: 'custom', message: '媒体参数与依赖种类不一致。' })
  }
})
export type CodeAsset = z.infer<typeof codeAssetSchema>
/** 片子数据存在剪辑里，不随资产带走：收录时把片子数据参数置空，返回置空后的参数与被置空的参数名。 */
export function detachCodeAssetScenes(parameters: CodeAsset['parameters']): { parameters: CodeAsset['parameters']; detached: string[] } {
  const detached = Object.keys(parameters).filter(key => isCodeSceneReference(parameters[key]))
  return { parameters: { ...parameters, ...Object.fromEntries(detached.map(key => [key, null])) }, detached }
}
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
  if (!bytes.byteLength) throw new Error('代码素材清单不能为空。')
  const raw = parseCodeAssetBytes(bytes, backupPath)
  const version = raw && typeof raw === 'object' && 'version' in raw && typeof raw.version === 'number' ? raw.version : 0
  const minReaderVersion = raw && typeof raw === 'object' && 'minReaderVersion' in raw && typeof raw.minReaderVersion === 'number' ? raw.minReaderVersion : undefined
  // 最低可读版本只是文件版本戳，不进入内存值；写出时总按本程序版本重新盖戳。
  const { minReaderVersion: _stamp, ...asset } = codeAssetSchema.parse(upgradePersistenceContent(codeAssetContract(), raw, version, backupPath, minReaderVersion))
  return asset
}
export function encodeCodeAsset(input: CodeAsset): Uint8Array {
  const { format, version, minReaderVersion: _minReaderVersion, ...rest } = codeAssetSchema.parse(input)
  const bytes = new TextEncoder().encode(JSON.stringify({ format, version, minReaderVersion: CODE_ASSET_MIN_READER_VERSION, ...rest }))
  return bytes
}
