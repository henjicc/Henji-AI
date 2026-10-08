import { backupPersistenceSnapshot } from '@/core/persistence/backup'
import { PersistenceError } from '@/core/persistence/migrations'
import { componentFileReferences, documentCodeSourceResolver, loadCodeSourceReferences, type CodeComponentPin } from '@/core/videoEdit/codeMaterial/sources'
import { createLogger } from '@/core/logging'
import { CODE_ASSET_LIMITS, codeAssetSchema, codeAssetContract, parseCodeAssetBytes, decodeCodeAsset, encodeCodeAsset, type CodeAsset } from '@/core/videoEdit/codeAsset'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { codeMaterialImageIds } from '@/core/videoEdit/codeMaterialResources'
import { prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import type { VideoEditDocument, VideoEditMedia, VideoEditClip } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import type { AssetFileContent, AssetRecord } from '@/platform/contracts/assetLibrary'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { sameVideoEditAssetContent, videoEditAssetContentSnapshot } from './videoEditAssetReferences'
import { inspectVideoEditMedia, sameVideoEditMediaPath } from './videoEditMedia'
import { requireVideoEditInstance, listVideoEditInstances, type VideoEditInstance } from './videoEditService'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { createVideoEditCodeAssetInstance } from './videoEditCodeService'
import { collectVideoEditOutput, publishVideoEditOutput, verifyVideoEditOutput, type VideoEditOutputReceipt } from './videoEditOutputs'
import { verifyVideoEditMediaContent } from '../videoEditMediaContent'

const logger = createLogger('features.videoEdit.codeAssets')
export type VideoEditCodeAssetTarget = { kind: 'item'; itemId: string } | { kind: 'definition'; definitionId: string } | { kind: 'clip'; sequenceId: string; clipId: string; effectId?: string }
const assetPins = (pins: readonly CodeComponentPin[] = []): CodeComponentPin[] => pins.map(pin => ({ ...pin, location: `asset:${pin.hash}`, imports: assetPins(pin.imports) }))
const collecting = new WeakSet<VideoEditInstance>()
const latest = new WeakMap<VideoEditInstance, { document: VideoEditDocument; target: string; receipt: VideoEditOutputReceipt }>()
function assertOwner(owner: VideoEditInstance, baseline: VideoEditDocument, signal?: AbortSignal): void {
  signal?.throwIfAborted()
  if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) throw new Error('原剪辑已关闭或检查期间已有修改，请重新引用代码素材。')
}
function sameContent(left: AssetFileContent, right: AssetFileContent): boolean { return left.contentIdentity === right.contentIdentity && left.sizeBytes === right.sizeBytes && left.fileModifiedAt === right.fileModifiedAt }
async function checkImage(image: CodeAsset['images'][number], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const actual = await getPlatform().assetLibrary.inspectFileContent(image.path, 'image')
  signal?.throwIfAborted()
  if (!sameContent(actual, image.content)) throw new Error('代码素材引用的原图片已改变，请恢复原图片后重新导入。')
}
function binding(owner: VideoEditInstance, target: VideoEditCodeAssetTarget): { code: CodeMaterialInstance; name: string; sequenceId: string; elementOverrides?: VideoEditClip['elementOverrides'] } {
  const document = owner.document
  if (target.kind === 'item') { const item = document.items.find(item => item.id === target.itemId); if (item?.code) return { code: item.code, name: item.name, sequenceId: owner.activeSequenceId, ...(item.elementOverrides ? { elementOverrides: item.elementOverrides } : {}) } }
  if (target.kind === 'definition') {
    const definition = document.codeMaterials?.find(definition => definition.id === target.definitionId)
    if (definition) return { code: { definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} }, name: definition.name, sequenceId: owner.activeSequenceId }
  }
  if (target.kind === 'clip') {
    const clip = document.sequences.find(sequence => sequence.id === target.sequenceId)?.clips.find(clip => clip.id === target.clipId)
    const effect = target.effectId ? clip?.effects?.find(effect => effect.id === target.effectId) : undefined
    const code = target.effectId ? effect?.code : clip?.code
    if (code && clip) return { code, name: effect?.name ?? clip.name, sequenceId: target.sequenceId, ...(!target.effectId && clip.elementOverrides ? { elementOverrides: clip.elementOverrides } : {}) }
  }
  throw new Error('请选择原剪辑中的代码素材或代码效果。')
}

/** Native asset inspection validates structure only. Source runs only in its compiler. */
export async function readVideoEditCodeAsset(assetId: string, signal?: AbortSignal): Promise<{ asset: AssetRecord; manifest: CodeAsset }> {
  signal?.throwIfAborted()
  const asset = await assetApplicationService.inspect(assetId)
  if (asset.mediaType !== 'code' || asset.inspectionStatus !== 'ready' || !asset.contentIdentity || asset.sizeBytes === null || asset.sizeBytes > CODE_ASSET_LIMITS.bytes) throw new Error('此素材不是可用的可编辑代码资产，请在资产库检查原文件。')
  const bytes = await getPlatform().system.fs.readFile(asset.filePath, { maxBytes: CODE_ASSET_LIMITS.bytes })
  signal?.throwIfAborted()
  let manifest: CodeAsset
  try {
    const raw = parseCodeAssetBytes(bytes)
    const version = raw && typeof raw === 'object' && 'version' in raw && typeof raw.version === 'number' ? raw.version : 0
    const backup = await backupPersistenceSnapshot(asset.filePath, codeAssetContract(), version, bytes, getPlatform().system.fs)
    manifest = decodeCodeAsset(bytes, backup)
  }
  catch (error) { logger.warn('代码资产清单校验失败', { event: 'video_edit.code_asset.read.failed', error, context: { assetId } }); if (error instanceof PersistenceError) throw error; throw new Error('代码素材清单不完整或格式无效，请检查原文件后重试。') }
  if (!sameVideoEditAssetContent(asset, await assetApplicationService.inspect(assetId))) throw new Error('代码资产文件在读取期间已改变，请重新导入。')
  signal?.throwIfAborted()
  return { asset, manifest }
}

/** Save the raw fixed instance, never the currently evaluated animation values. */
export async function collectVideoEditCodeAsset(projectId: string, target: VideoEditCodeAssetTarget, options: { libraryId?: string; path?: string } = {}, signal?: AbortSignal): Promise<AssetRecord | null> {
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document; const targetKey = JSON.stringify(target)
  if (collecting.has(owner)) throw new Error('原剪辑正在收录代码素材，请等待完成。')
  collecting.add(owner)
  try {
    assertOwner(owner, baseline, signal)
    const selected = binding(owner, target)
    const fixed = baseline.codeMaterials!.find(definition => definition.id === selected.code.definitionId)!.versions.find(version => version.id === selected.code.versionId)!
    await loadCodeSourceReferences(fixed)
    const source = codeMaterialSource(baseline, selected.code)
    prepareCodeMaterialParameters(readVideoEditCodeMetadata(owner, baseline)(selected.code), selected.code)
    const cached = latest.get(owner)
    if (!options.path && cached?.document === baseline && cached.target === targetKey) {
      await verifyVideoEditOutput(cached.receipt); assertOwner(owner, baseline, signal)
      return await collectVideoEditOutput(cached.receipt, options, signal)
    }
    if (options.libraryId) await assetApplicationService.inspectLibrary(options.libraryId)
    const images: CodeAsset['images'] = []
    for (const id of codeMaterialImageIds(selected.code)) {
      const media = baseline.media.find(media => media.id === id && media.kind === 'image')
      if (!media) throw new Error('代码素材图片引用已失效，请恢复原图片。')
      await verifyVideoEditMediaContent(media, signal)
      const content = await getPlatform().assetLibrary.inspectFileContent(media.path, 'image')
      assertOwner(owner, baseline, signal)
      images.push({ id, path: media.path, content, ...(media.assetId ? { assetId: media.assetId } : {}) })
    }
    const manifest = codeAssetSchema.parse({ format: 'henji-code-asset', version: 1, name: selected.name, sourceVersion: { apiVersion: source.apiVersion, languageVersion: source.languageVersion, entry: source.entry, files: source.files.map(file => ({ ...file, location: `asset:${file.hash}` })), ...(source.imports ? { imports: assetPins(source.imports) } : {}) }, codeSources: [...new Map([...source.files, ...componentFileReferences(source.imports)].map(file => [file.hash, { hash: file.hash, source: documentCodeSourceResolver().read(file.hash, file.location, file.path) }])).values()], parameters: structuredClone(selected.code.parameters), ...(selected.code.curves ? { curves: structuredClone(selected.code.curves) } : {}), ...(selected.elementOverrides ? { elementOverrides: structuredClone(selected.elementOverrides) } : {}), images })
    const bytes = encodeCodeAsset(manifest); const platform = getPlatform()
    const path = options.path ?? await platform.system.dialog.save({ defaultPath: `${selected.name}.henji-code`, filters: [{ name: '可编辑代码素材', extensions: ['henji-code'] }] })
    assertOwner(owner, baseline, signal)
    if (!path) return null
    if (await platform.system.fs.exists(path)) throw new Error('请选择新文件名保存代码素材，避免覆盖原文件。')
    for (const image of images) await checkImage(image, signal)
    assertOwner(owner, baseline, signal)
    await platform.system.fs.writeFile(path, bytes, { exclusive: true })
    const receipt = await publishVideoEditOutput({ owner, sequenceId: selected.sequenceId, revision: baseline.revision, path, name: manifest.name, kind: 'code' })
    latest.set(owner, { document: baseline, target: targetKey, receipt })
    assertOwner(owner, baseline, signal)
    return await collectVideoEditOutput(receipt, options, signal)
  } catch (error) { logger.warn('可编辑代码素材未完成收录', { event: 'video_edit.code_asset.collect.failed', error, context: { projectId } }); throw error }
  finally { collecting.delete(owner) }
}

export async function importVideoEditCodeAsset(projectId: string, assetId: string, options: { binId?: string; filterTarget?: { sequenceId: string; clipId: string }; afterImport?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument } = {}, signal?: AbortSignal): Promise<{ definitionId: string; itemId?: string }> {
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document
  assertOwner(owner, baseline, signal)
  const { asset, manifest } = await readVideoEditCodeAsset(assetId, signal)
  assertOwner(owner, baseline, signal)
  const media: VideoEditMedia[] = []; const mediaIds = new Map<string, string>()
  for (const image of manifest.images) {
    // This check must precede inspectVideoEditMedia, which may authorize a path.
    await checkImage(image, signal); assertOwner(owner, baseline, signal)
    let inspected = baseline.media.find(media => sameVideoEditMediaPath(media.path, image.path)) ?? media.find(media => sameVideoEditMediaPath(media.path, image.path))
    if (inspected?.assetContent?.contentIdentity) await verifyVideoEditMediaContent(inspected, signal)
    else if (inspected) {
      const current = await inspectVideoEditMedia(image.path, signal)
      if (current.kind !== inspected.kind || current.width !== inspected.width || current.height !== inspected.height) throw new Error('原剪辑中的图片信息已改变，请先重新定位源素材。')
      inspected = { ...current, id: inspected.id, name: inspected.name, ...(inspected.assetId ? { assetId: inspected.assetId } : {}), sourceRevision: crypto.randomUUID() }
    } else inspected = await inspectVideoEditMedia(image.path, signal)
    if (inspected.kind !== 'image') throw new Error('代码素材图片依赖必须是真实图片。')
    await checkImage(image, signal); assertOwner(owner, baseline, signal)
    const fixed = { ...inspected, path: image.path, assetContent: { ...image.content }, sourceRevision: inspected.sourceRevision ?? crypto.randomUUID() }
    if (!media.some(media => media.id === fixed.id)) media.push(fixed)
    mediaIds.set(image.id, fixed.id)
  }
  const beforePublish = async (): Promise<void> => {
    assertOwner(owner, baseline, signal)
    for (const image of manifest.images) await checkImage(image, signal)
    if (!sameVideoEditAssetContent(asset, await assetApplicationService.inspect(assetId))) throw new Error('代码资产在导入检查期间已改变，请重新导入。')
    assertOwner(owner, baseline, signal)
  }
  const result = await createVideoEditCodeAssetInstance(projectId, { asset: manifest, media, mediaIds, origin: { assetId, contentIdentity: videoEditAssetContentSnapshot(asset).contentIdentity }, beforePublish, ...options }, options.binId, signal)
  logger.info('可编辑代码资产已导入原剪辑', { event: 'video_edit.code_asset.import.completed', context: { projectId, assetId, ...result } })
  return result
}
