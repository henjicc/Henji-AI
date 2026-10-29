import { addMediaReferenceToLibrary } from '@/features/assets'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { backupPersistenceSnapshot } from '@/core/persistence/backup'
import { PersistenceError } from '@/core/persistence/migrations'
import { componentFileReferences, documentCodeSourceResolver, loadCodeSourceReferences, type CodeComponentPin } from '@/core/videoEdit/codeMaterial/sources'
import { createLogger } from '@/core/logging'
import { CODE_ASSET_VERSION, codeAssetSchema, codeAssetContract, parseCodeAssetBytes, decodeCodeAsset, detachCodeAssetScenes, codeAssetWebParameters, encodeCodeAsset, type CodeAsset } from '@/core/videoEdit/codeAsset'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { codeMaterialMediaIds } from '@/core/videoEdit/codeMaterialResources'
import { prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import type { VideoEditDocument, VideoEditMedia, VideoEditClip } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import type { AssetFileContent, AssetRecord } from '@/platform/contracts/assetLibrary'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { sameVideoEditAssetContent, videoEditAssetContentSnapshot } from './videoEditAssetReferences'
import { inspectVideoEditMedia, sameVideoEditMediaPath } from './videoEditMedia'
import { requireVideoEditInstance, type VideoEditInstance } from './videoEditService'
import { ensureVideoEditCodeParameterMetadata, readVideoEditCodeMetadata } from './videoEditCodeState'
import { createVideoEditCodeAssetInstance } from './videoEditCodeService'
import { collectVideoEditOutput, publishVideoEditOutput, verifyVideoEditOutput, type VideoEditOutputReceipt } from './videoEditOutputs'
import { verifyVideoEditMediaContent } from '../videoEditMediaContent'

const logger = createLogger('features.videoEdit.codeAssets')
export type VideoEditCodeAssetTarget = { kind: 'item'; itemId: string } | { kind: 'definition'; definitionId: string } | { kind: 'clip'; sequenceId: string; clipId: string; effectId?: string }
const assetPins = (pins: readonly CodeComponentPin[] = []): CodeComponentPin[] => pins.map(pin => ({ ...pin, location: `asset:${pin.hash}`, imports: assetPins(pin.imports) }))
const collecting = new WeakSet<VideoEditInstance>()
const latest = new WeakMap<VideoEditInstance, { document: VideoEditDocument; target: string; receipt: VideoEditOutputReceipt }>()
function assertOwner(owner: VideoEditInstance, contentVersion: number, signal?: AbortSignal): void {
  signal?.throwIfAborted()
  if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('原剪辑已关闭或检查期间已有修改，请重新引用代码素材。')
}
function sameContent(left: AssetFileContent, right: AssetFileContent): boolean { return left.contentIdentity === right.contentIdentity && left.sizeBytes === right.sizeBytes && left.fileModifiedAt === right.fileModifiedAt }
async function checkImage(image: CodeAsset['images'][number], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const actual = await getPlatform().assetLibrary.inspectFileContent(image.path, image.kind)
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
  if (asset.mediaType !== 'code' || asset.inspectionStatus !== 'ready' || !asset.contentIdentity || asset.sizeBytes === null) throw new Error('此素材不是可用的可编辑代码资产，请在资产库检查原文件。')
  const bytes = await getPlatform().system.fs.readFile(asset.filePath)
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

/**
 * `detachedSceneParameters`：片子数据没有随资产带走、在资产里被置空的参数名。
 * `webParameters`：网页画面参数，资产里仍指向本机的网页文件夹，文件夹本身没有带走。
 */
export interface VideoEditCodeAssetCollection { asset: AssetRecord; detachedSceneParameters: string[]; webParameters: string[] }
/** Save the raw fixed instance, never the currently evaluated animation values. */
export async function collectVideoEditCodeAsset(projectId: string, target: VideoEditCodeAssetTarget, options: { libraryId?: string; path?: string | (() => Promise<string>) } = {}, signal?: AbortSignal): Promise<VideoEditCodeAssetCollection | null> {
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document; const contentVersion = owner.contentVersion; const targetKey = JSON.stringify(target)
  if (collecting.has(owner)) throw new Error('原剪辑正在收录代码素材，请等待完成。')
  collecting.add(owner)
  try {
    assertOwner(owner, contentVersion, signal)
    const selected = binding(owner, target)
    const fixed = baseline.codeMaterials!.find(definition => definition.id === selected.code.definitionId)!.versions.find(version => version.id === selected.code.versionId)!
    await loadCodeSourceReferences(fixed)
    await ensureVideoEditCodeParameterMetadata(owner, baseline, selected.code.definitionId, selected.code.versionId, signal)
    const source = codeMaterialSource(baseline, selected.code)
    prepareCodeMaterialParameters(readVideoEditCodeMetadata(owner, baseline)(selected.code), selected.code)
    const { parameters, detached } = detachCodeAssetScenes(structuredClone(selected.code.parameters))
    if (detached.length) logger.info('片子数据不随代码资产带走，资产里的片子数据参数置空', { event: 'video_edit.code_asset.scenes_detached', context: { projectId, parameters: detached } })
    const webParameters = codeAssetWebParameters(parameters)
    if (webParameters.length) logger.info('网页文件夹不随代码资产带走，资产里的网页参数仍指向本机位置', { event: 'video_edit.code_asset.web_not_carried', context: { projectId, parameters: webParameters } })
    const cached = latest.get(owner)
    if (typeof options.path !== 'string' && cached?.document === baseline && cached.target === targetKey) {
      await verifyVideoEditOutput(cached.receipt); assertOwner(owner, contentVersion, signal)
      if (source.foreign) await addMediaReferenceToLibrary({ filePath: cached.receipt.path, mediaType: 'code', source: 'video-edit', foreign: source.foreign, displayName: selected.name })
      return { asset: await collectVideoEditOutput(cached.receipt, options, signal), detachedSceneParameters: detached, webParameters }
    }
    if (options.libraryId) await assetApplicationService.inspectLibrary(options.libraryId)
    const images: CodeAsset['images'] = []
    for (const id of codeMaterialMediaIds(selected.code)) {
      const media = baseline.media.find(media => media.id === id)
      if (!media) throw new Error('代码素材图片引用已失效，请恢复原图片。')
      await verifyVideoEditMediaContent(media, signal)
      const content = await getPlatform().assetLibrary.inspectFileContent(media.path, media.kind)
      assertOwner(owner, contentVersion, signal)
      images.push({ kind: media.kind, id, path: media.path, content, ...(media.assetId ? { assetId: media.assetId } : {}) })
    }
    const manifest = codeAssetSchema.parse({ format: 'henji-code-asset', version: CODE_ASSET_VERSION, name: selected.name, sourceVersion: { apiVersion: source.apiVersion, languageVersion: source.languageVersion, entry: source.entry, files: source.files.map(file => ({ ...file, location: `asset:${file.hash}` })), ...(source.imports ? { imports: assetPins(source.imports) } : {}), ...(source.libraries ? { libraries: { ...source.libraries } } : {}) }, codeSources: [...new Map([...source.files, ...componentFileReferences(source.imports)].map(file => [file.hash, { hash: file.hash, source: documentCodeSourceResolver().read(file.hash, file.location, file.path) }])).values()], parameters, ...(selected.code.curves ? { curves: structuredClone(selected.code.curves) } : {}), ...(selected.elementOverrides ? { elementOverrides: structuredClone(selected.elementOverrides) } : {}), images })
    const bytes = encodeCodeAsset(manifest); const platform = getPlatform()
    const path = typeof options.path === 'function' ? await options.path() : options.path ?? await platform.system.dialog.save({ defaultPath: `${selected.name}.henji-code`, filters: [{ name: '可编辑代码素材', extensions: ['henji-code'] }] })
    assertOwner(owner, contentVersion, signal)
    if (!path) return null
    if (await platform.system.fs.exists(path)) throw new Error('请选择新文件名保存代码素材，避免覆盖原文件。')
    for (const image of images) await checkImage(image, signal)
    assertOwner(owner, contentVersion, signal)
    await platform.system.fs.writeFile(path, bytes, { exclusive: true })
    const receipt = await publishVideoEditOutput({ owner, sequenceId: selected.sequenceId, revision: baseline.revision, path, name: manifest.name, kind: 'code' })
    latest.set(owner, { document: baseline, target: targetKey, receipt })
    if (source.foreign) await addMediaReferenceToLibrary({ filePath: path, mediaType: 'code', source: 'video-edit', foreign: source.foreign, displayName: manifest.name })
    assertOwner(owner, contentVersion, signal)
    return { asset: await collectVideoEditOutput(receipt, options, signal), detachedSceneParameters: detached, webParameters }
  } catch (error) { logger.warn('可编辑代码素材未完成收录', { event: 'video_edit.code_asset.collect.failed', error, context: { projectId } }); throw error }
  finally { collecting.delete(owner) }
}

export async function importVideoEditCodeAsset(projectId: string, assetId: string, options: { binId?: string; filterTarget?: { sequenceId: string; clipId: string }; afterImport?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument } = {}, signal?: AbortSignal): Promise<{ definitionId: string; itemId?: string }> {
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document; const contentVersion = owner.contentVersion
  assertOwner(owner, contentVersion, signal)
  const { asset, manifest } = await readVideoEditCodeAsset(assetId, signal)
  assertOwner(owner, contentVersion, signal)
  const media: VideoEditMedia[] = []; const mediaIds = new Map<string, string>()
  for (const image of manifest.images) {
    // This check must precede inspectVideoEditMedia, which may authorize a path.
    await checkImage(image, signal); assertOwner(owner, contentVersion, signal)
    let inspected = baseline.media.find(media => sameVideoEditMediaPath(media.path, image.path)) ?? media.find(media => sameVideoEditMediaPath(media.path, image.path))
    if (inspected?.assetContent?.contentIdentity) await verifyVideoEditMediaContent(inspected, signal)
    else if (inspected) {
      const current = await inspectVideoEditMedia(image.path, signal)
      if (current.kind !== inspected.kind || current.width !== inspected.width || current.height !== inspected.height) throw new Error('原剪辑中的媒体信息已改变，请先重新定位源素材。')
      inspected = { ...current, id: inspected.id, name: inspected.name, ...(inspected.assetId ? { assetId: inspected.assetId } : {}), sourceRevision: crypto.randomUUID() }
    } else inspected = await inspectVideoEditMedia(image.path, signal)
    if (inspected.kind !== image.kind) throw new Error('代码素材媒体依赖与声明种类不符。')
    await checkImage(image, signal); assertOwner(owner, contentVersion, signal)
    const fixed = { ...inspected, path: image.path, assetContent: { ...image.content }, sourceRevision: inspected.sourceRevision ?? crypto.randomUUID() }
    if (!media.some(media => media.id === fixed.id)) media.push(fixed)
    mediaIds.set(image.id, fixed.id)
  }
  const beforePublish = async (): Promise<void> => {
    assertOwner(owner, contentVersion, signal)
    for (const image of manifest.images) await checkImage(image, signal)
    if (!sameVideoEditAssetContent(asset, await assetApplicationService.inspect(assetId))) throw new Error('代码资产在导入检查期间已改变，请重新导入。')
    assertOwner(owner, contentVersion, signal)
  }
  const result = await createVideoEditCodeAssetInstance(projectId, { asset: manifest, foreign: asset.foreign ?? null, media, mediaIds, origin: { assetId, contentIdentity: videoEditAssetContentSnapshot(asset).contentIdentity }, beforePublish, ...options }, options.binId, signal)
  logger.info('可编辑代码资产已导入原剪辑', { event: 'video_edit.code_asset.import.completed', context: { projectId, assetId, ...result } })
  return result
}
