import type { CodeAuthorApiVersion } from '@/core/videoEdit/codeAuthorProgram'
import { detachVideoEditEffectClipReferences } from '@/core/videoEdit/codeClipReferences'
import { compileVideoEditCode, ensureVideoEditCodeParameterMetadata, readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { prepareCodeVersionPublication } from './videoEditCodeStorage'
import { requireVideoEditInstance } from './videoEditService'
import { useVideoEditEffectLibraryStore } from './videoEditEffectPresets'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { videoEditEffectPresetSchema, resolveVideoEditStylePieceEffects, type VideoEditEffectPreset } from '@/core/videoEdit/effectPresets'
import { styleCodeDeclarations, styleCodeSourceResolver, type VideoEditStyleCodeSnapshot } from '@/core/videoEdit/styleCodeSnapshot'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { expandPinnedCodeComponents, portableCodeComponentFiles } from '@/core/videoEdit/codeMaterial/components'
import { addressCodeMaterialFiles, codeMaterialFilesKey, snapshotCodeSourceClosure, documentCodeSourceResolver, loadCodeSourceReferences, resolveCodeMaterialFiles, verifyCodeSourceReferences, type CodeFileReference } from '@/core/videoEdit/codeMaterial/sources'
import { type VideoEditEffect } from '@/core/videoEdit/compositing'
import { sha256HexString } from '@/utils/save/hash'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { isRemovedVideoEditBuiltinEffect } from '@/core/videoEdit/builtinEffects'
import { createLogger } from '@/core/logging'
import { jsonEqual } from '@/core/jsonEqual'
import { snapshotVideoEditCodeMedia, prepareVideoEditCodeMedia } from './videoEditCodeMedia'
import { codeMaterialMediaIds } from '@/core/videoEdit/codeMaterialResources'
import { isCodeAudioReference, isCodeImageReference, isCodeSceneReference } from '@/core/videoEdit/codeMaterial/contract'
import { videoEditSceneRecordMediaIds } from '@/core/videoEdit/scene/sceneMedia'
const logger = createLogger('features.videoEdit.styleCode')

/** 人和助手保存同一份快照；只读取已经存在的固定代码版本。 */
export async function snapshotVideoEditStyleEffects(projectId: string, original: readonly VideoEditEffect[], signal?: AbortSignal): Promise<Pick<VideoEditEffectPreset, 'effects' | 'codeSnapshots'>> {
  const effects = detachVideoEditEffectClipReferences(original)
  logger.info('读取代码风格件快照', { event: 'video_edit.style_piece.snapshot.start', context: { projectId, effects: effects.length } })
  try {
    const owner = requireVideoEditInstance(projectId), document = owner.document, contentVersion = owner.contentVersion
    const snapshots: Record<string, VideoEditStyleCodeSnapshot> = {}
    for (const effect of effects) if (effect.code) {
      await ensureVideoEditCodeParameterMetadata(owner, document, effect.code.definitionId, effect.code.versionId, signal)
      const source = codeMaterialSource(document, effect.code)
      await loadCodeSourceReferences(source)
      const { contents: _contents, compilation: _compilation, ...original } = source
      const { codeSources, ...closure } = await snapshotCodeSourceClosure(source, documentCodeSourceResolver(document))
      const version = { ...original, ...closure }
      const scenes = [...new Set(Object.values(effect.code.parameters).flatMap(value => isCodeSceneReference(value) ? [value.sceneId] : []))].map(id => {
        const scene = document.scenes?.find(scene => scene.id === id)
        if (!scene) throw new Error('代码滤镜的片子数据引用已失效。')
        return structuredClone(scene)
      })
      const media = await snapshotVideoEditCodeMedia(document, [...codeMaterialMediaIds(effect.code), ...videoEditSceneRecordMediaIds(document, scenes.flatMap(scene => scene.records))], signal)
      snapshots[effect.id] = { version, codeSources, ...styleCodeDeclarations(readVideoEditCodeMetadata(owner, document)(effect.code)), ...(media.length ? { media } : {}), ...(scenes.length ? { scenes } : {}) }
    }
    signal?.throwIfAborted()
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('读取代码快照期间原剪辑已改变，请重试。')
    logger.info('代码风格件快照已读取', { event: 'video_edit.style_piece.snapshot.completed', context: { projectId, effects: effects.length } })
    return { effects: structuredClone([...effects]), ...(Object.keys(snapshots).length ? { codeSnapshots: snapshots } : {}) }
  } catch (error) { logger.error('代码风格件快照读取失败', { event: 'video_edit.style_piece.snapshot.failed', error, context: { projectId } }); throw error }
}
/** 用户确认保存后调用；界面与助手都通过同一快照解析与库写入。 */
export async function saveVideoEditStylePieceFromEffects(projectId: string, input: Omit<VideoEditEffectPreset, 'id' | 'codeSnapshots'>, signal?: AbortSignal): Promise<VideoEditEffectPreset> {
  const captured = await snapshotVideoEditStyleEffects(projectId, input.effects, signal)
  const preset = videoEditEffectPresetSchema.parse({ ...input, ...captured, id: crypto.randomUUID() })
  await useVideoEditEffectLibraryStore.getState().ready()
  const library = useVideoEditEffectLibraryStore.getState()
  await library.saveLibrary({ favorites: library.favorites, presets: [...library.presets, preset] })
  return structuredClone(preset)
}

/** 只构造候选文档；调用方负责试渲染、原子提交和撤销。预览使用内存源码，不写工程。 */
export async function materializeVideoEditStylePiece(document: VideoEditDocument, preset: VideoEditEffectPreset, options: { projectId?: string; owner?: object; signal?: AbortSignal; createdFiles?: CodeFileReference[]; knobs?: Readonly<Record<string, number>> } = {}): Promise<VideoEditEffect[]> {
  logger.info('准备风格件', { event: 'video_edit.style_piece.materialize.start', context: { presetId: preset.id, projectId: options.projectId } })
  try {
    const { signal } = options
    const effects = resolveVideoEditStylePieceEffects(videoEditEffectPresetSchema.parse(preset), options.knobs).filter(effect => !effect.builtin || !isRemovedVideoEditBuiltinEffect(effect.builtin.id))
    for (const effect of effects) if (effect.code) {
      const snapshot = preset.codeSnapshots![effect.id], version = snapshot.version, resolver = styleCodeSourceResolver(snapshot)
      await verifyCodeSourceReferences(version, resolver)
      for (const source of snapshot.codeSources) if (await sha256HexString(source.source) !== source.hash) throw new Error('风格件源码内容校验失败。')
      const files = { ...portableCodeComponentFiles(expandPinnedCodeComponents(resolveCodeMaterialFiles(version, resolver), version.imports ?? [], resolver)), trustContext: version.foreign ? [version.foreign] : [] }
      const contents = { ...files, apiVersion: version.apiVersion as CodeAuthorApiVersion, libraries: version.libraries }
      // 编译器先检查来源许可，再读声明；缓存与内容复用均不能绕过它。
      const program = await compileVideoEditCode(contents, signal)
      if (program.kind !== 'filter') throw new Error('风格件的代码成员必须是代码滤镜。')
      if (!jsonEqual(styleCodeDeclarations(program), { params: snapshot.params, ...(snapshot.types ? { types: snapshot.types } : {}) })) throw new Error('风格件参数声明与固定源码不一致。')
      const { media, mediaIds } = await prepareVideoEditCodeMedia(document, snapshot.media ?? [], signal)
      document.media = [...document.media.map(existing => media.find(media => media.id === existing.id) ?? existing), ...media.filter(incoming => !document.media.some(existing => existing.id === incoming.id))]
      const sceneIds = new Map<string, string>()
      for (const scene of snapshot.scenes ?? []) {
        const declaration = program.parameters.find(parameter => parameter.type === 'scene' && parameter.schema.id === scene.schema.id && parameter.schema.version === scene.schema.version)
        if (declaration?.type !== 'scene') throw new Error('风格件的片子数据没有对应代码声明。')
        const copy = structuredClone(scene)
        for (const record of copy.records) for (const [key, field] of Object.entries(declaration.schema.kinds[record.kind]?.fields ?? {})) {
          const value = record.values[key]
          if (field.type === 'media' && typeof value === 'string') record.values[key] = mediaIds.get(value) ?? value
          else if (field.type === 'list' && field.of.type === 'media' && Array.isArray(value)) record.values[key] = value.map(value => typeof value === 'string' ? mediaIds.get(value) ?? value : value)
        }
        const known = document.scenes?.find(existing => jsonEqual({ ...existing, id: '' }, { ...copy, id: '' }))
        if (known) sceneIds.set(scene.id, known.id)
        else { copy.id = crypto.randomUUID(); (document.scenes ??= []).push(copy); sceneIds.set(scene.id, copy.id) }
      }
      for (const [key, value] of Object.entries(effect.code.parameters)) {
        if (isCodeAudioReference(value) || isCodeImageReference(value) && (value.kind === 'image' || value.kind === 'video')) {
          const mediaId = mediaIds.get(value.mediaId)
          if (!mediaId) throw new Error('风格件缺少代码滤镜引用的媒体。')
          effect.code.parameters[key] = { ...value, mediaId }
        } else if (isCodeSceneReference(value)) {
          const sceneId = sceneIds.get(value.sceneId)
          if (!sceneId) throw new Error('风格件缺少代码滤镜引用的片子数据。')
          effect.code.parameters[key] = { ...value, sceneId }
        }
      }
      const key = codeMaterialFilesKey(contents)
      let match: { definitionId: string; versionId: string } | undefined
      for (const definition of document.codeMaterials ?? []) for (const candidate of definition.versions) {
        if (candidate.apiVersion !== version.apiVersion || !jsonEqual(candidate.foreign, version.foreign)) continue
        try {
          await loadCodeSourceReferences(candidate)
          const source = codeMaterialSource(document, { definitionId: definition.id, versionId: candidate.id, parameters: {} })
          if (codeMaterialFilesKey({ ...portableCodeComponentFiles(source.compilation), apiVersion: candidate.apiVersion as CodeAuthorApiVersion, libraries: candidate.libraries }) === key) { match = { definitionId: definition.id, versionId: candidate.id }; break }
        } catch (error) { signal?.throwIfAborted(); logger.debug('历史源码不可读，使用风格件快照创建代码素材', { event: 'video_edit.style_piece.reuse.unavailable', error, context: { definitionId: definition.id, versionId: candidate.id } }) }
      }
      if (!match) {
        const definitionId = crypto.randomUUID(), versionId = crypto.randomUUID()
        const publication = options.projectId ? await prepareCodeVersionPublication(options.projectId, files, effect.name, [], options.createdFiles) : undefined
        const manifest = publication ? await publication.write(definitionId, effect.name, files) : await addressCodeMaterialFiles(files)
        const fixed = { id: versionId, apiVersion: version.apiVersion, languageVersion: version.languageVersion, entry: contents.entry, files: manifest.files, ...('folder' in manifest && manifest.folder ? { folder: manifest.folder } : {}), ...(version.libraries ? { libraries: version.libraries } : {}), ...(version.foreign ? { foreign: version.foreign } : {}) }
        const { folder, ...record } = fixed
        ;(document.codeMaterials ??= []).push({ id: definitionId, name: effect.name, ...(folder ? { folder } : {}), defaultVersionId: versionId, versions: [record] })
        match = { definitionId, versionId }
      }
      const definition = document.codeMaterials!.find(definition => definition.id === match!.definitionId)!
      if (options.owner) rememberVideoEditCodeMetadata(options.owner, definition.id, definition.versions.find(version => version.id === match!.versionId)!, program)
      effect.code = { ...effect.code, ...match }
    }
    signal?.throwIfAborted()
    logger.info('风格件已准备', { event: 'video_edit.style_piece.materialize.completed', context: { presetId: preset.id, effects: effects.length } })
    return effects.map(effect => ({ ...effect, id: crypto.randomUUID() }))
  } catch (error) { logger.error('风格件准备失败', { event: 'video_edit.style_piece.materialize.failed', error, context: { presetId: preset.id } }); throw error }
}
