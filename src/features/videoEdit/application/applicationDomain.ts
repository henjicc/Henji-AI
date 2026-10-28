import { upgradeVideoEditCodeMaterials } from './videoEditCodeProjectUpgrade'
import { getPlatform } from '@/platform/runtime'
import { upgradeVideoEditCodeMaterialsCapability, commitVideoEditCodeProjectCapability } from '@/core/application-control/domains/videoEdit/videoEditCodeProjectCapabilities'
import { CodeProjectFileMutationExecutor, CodeProjectFileCollectionExecutor } from './videoEditCodeProjectReflection'
import { codeProjectPersistenceParticipants, notifyVideoCodeProjectChanged } from './videoEditCodeProject'
import { registerCurrentDocumentProvider } from '@/features/documents'
import { activeVideoEditInstance } from './videoEditService'
import '../layout/videoEditDockLayout'
import { startVideoEditAudioDocumentLinks, sendVideoEditClipToAudioEdit } from './videoEditAudioLinks'
import { sendVideoEditAudioCapability } from '@/core/application-control/domains/videoEdit/videoEditAudioLinkCapability'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { placeVideoEditSoundEffectsCapability } from '@/core/application-control/domains/videoEdit/videoEditSoundEffectCapability'
import { placeVideoEditSoundEffects } from './videoEditSoundEffects'
import { remixVideoEditMusicCapability } from '@/core/application-control/domains/videoEdit/videoEditMusicRemixCapability'
import { executeVideoEditMusicRemixCapability } from './videoEditMusicRemixCapability'
import { executeVideoEditPrivacy } from './videoEditPrivacyCapability'
import { CodeComponentCollectionExecutor } from './videoEditCodeComponentReflection'
import { videoEditStaggerCapability } from '@/core/application-control/domains/videoEdit/videoEditStaggerCapability'
import { staggerVideoMotion } from './videoEditMotionDraft'
import { handleVideoEditAnnotationCapability } from './videoEditAnnotationBatch'
export { videoCreativeIntentProvider } from './videoEditCreativeIntentReflection'
import { VideoEditTextPresetExecutor, VideoEditTextPresetMutationExecutor } from './videoEditTextPresetReflection'
import { VideoEditProjectTemplateCollectionExecutor, VideoEditProjectTemplateMutationExecutor, VideoEditStyleCollectionExecutor, VideoEditStyleMutationExecutor, STYLE_ENTITY, TEMPLATE_ENTITY } from './videoEditStyleReflection'
import { VideoEditPresetMutationExecutor } from './videoEditPresetReflection'
import { handleVideoEditMulticamCapability } from './videoEditMulticamCapability'
import { handleVideoEditStyleCapability } from './videoEditStyleCapability'
import { handleVideoEditProxyCapability } from './videoEditProxyCapability'
import { handleVideoEditRenderCacheCapability } from './videoEditRenderCacheCapability'
import { screenAttentionVideoEditCapability } from '@/core/application-control/domains/videoEdit/videoEditScreenAttentionCapability'
import { executeVideoEditScreenAttentionCapability } from './videoEditScreenAttentionCapability'
import { reframeVideoEditCapability } from '@/core/application-control/domains/videoEdit/videoEditReframeCapability'
import { handleVideoEditTextCapability } from './videoEditTextCapability'
import { queryVideoEditContentCapability } from '@/core/application-control/domains/videoEdit/videoEditContentIndexCapability'
import { queryVideoEditSourceMapCapability } from '@/core/application-control/domains/videoEdit/videoEditSourceMapCapability'
import { queryVideoEditSourceMap } from './videoEditSourceMap'
import { queryVideoEditReviewCapability } from '@/core/application-control/domains/videoEdit/videoEditReviewCapability'
import { queryVideoEditReview } from './videoEditReview'
import { readVideoEditContentIndex } from './videoEditContentIndex'
import { executeVideoEditReframeCapability } from './videoEditReframeCapability'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { analyzeVideoEditColorGradeCapability, exportVideoEditColorLutCapability, observeVideoEditColorCapability } from '@/core/application-control/domains/videoEdit/videoEditColorGradeCapability'
import { ColorGradeExportRejection } from '@/core/imaging/lut/colorGradeExport'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { colorGradeExportReceipt } from '@/services/colorGradeExport'
import { exportVideoEditColorGrade } from './videoEditColorGradeExport'
import { analyzeVideoEditColorGrade, observeVideoEditColor } from './videoEditColorGrade'
import { handleVideoEditSubtitleCapability } from './videoEditSubtitleCapability'
import { ApplicationPersistenceFailure, type ApplicationPersistenceParticipant } from '@/core/application-control/execution/persistence'
import { createVideoEditRegistrations } from './videoEditReflection'
import { handleVideoEditSceneCapability } from './videoEditSceneCapability'
import { handleVideoEditWorkspaceTransfer } from './videoEditWorkspaceTransfer'
import { VideoEditCollectionExecutor, VideoEditMutationExecutor, VideoEditSceneCollectionExecutor, VideoEditSceneMutationExecutor, VideoEditSceneRecordCollectionExecutor } from './videoEditExecutors'
import { VIDEO_EDIT_SCENE_TYPES } from './videoEditSceneFields'
import { VIDEO_EDIT_COMPOSITE_TYPES } from './videoEditCompositeEntities'
import { beginVideoEditCommitBatch, bindVideoEditCommitBatch, endVideoEditCommitBatch, videoEditPersistenceKey, openVideoEditDocument, releaseVideoEditDocument, requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved, videoEditDocumentFromContent, type VideoEditInstance, undoVideoEdit, videoEditBusyReason } from './videoEditService'
import { videoEditCoverSource, videoEditFrameSourceAt } from './videoEditProjectCover'
import { registerDocumentCoverProvider, registerDocumentHoverPreview } from '@/features/documents/documentCovers'
import { getDocumentOperations, registerDocumentBusyCheck, registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { startVideoEditImageDocumentLinks } from './videoEditImageLinks'
import { startVideoEditSmartRegions } from './videoEditSmartRegions'
import { startVideoEditTracking } from './videoEditTracking'
import { openVideoEditClipSource, videoEditClipSource, videoEditEmbedHost } from './videoEditComposition'
import { executeVideoEditTimelineEdit } from './videoEditTimeline'
import { videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import { splitVideoEditRef } from './videoEditReflection'

/**
 * 不属于某份剪辑的 video_edit.* 实体：源素材预览、风格库与模板库、各类预设、内置效果目录、风格使用者偏好。
 * 写它们不经剪辑文件保存；只有其余实体（引用形如“剪辑ID:子ID”）才按所属剪辑登记持久化参与者。
 */
const VIDEO_EDIT_LIBRARY_KINDS: ReadonlySet<string> = new Set(['video_edit.source', 'video_edit.export_preset', 'video_edit.text_preset', 'video_edit.template', 'video_edit.style', 'video_edit.style_preference', 'video_edit.preset', 'video_edit.effect_preset', 'video_edit.subtitle_preset', 'video_edit.builtin_effect'])
const isVideoEditDocumentKind = (kind: string): boolean => kind.startsWith('video_edit.') && !VIDEO_EDIT_LIBRARY_KINDS.has(kind)
import { VIDEO_EDIT_APPLICATION_CAPABILITIES, collectVideoEditOutputCapability, collectVideoEditCodeAssetCapability, placeVideoEditCreativeResultCapability, observeVideoEditFrameCapability, openVideoEditClipSourceCapability, trimVideoEditClipCapability } from '@/core/application-control/domains/videoEdit/videoEditApplicationCapabilities'
import { trimVideoEditClip } from './videoEditTrimCapability'
import { handleVideoEditExportCapability } from './videoEditExportCapability'
import { uniqueVideoEditOutputPath, videoEditProjectOutputDirectory, videoEditQueuedExportTask } from './videoEditExportQueue'
import { VideoEditExportPresetExecutor, VideoEditExportPresetMutationExecutor } from './videoEditExportPresetReflection'
import { VideoEditSourceExecutor } from './videoEditSourceExecutor'
import { importVideoEditSources } from './videoEditMedia'
import { chooseVideoEditFolders } from './videoEditFolderImport'
import { importVideoEditProjectFiles, settleVideoEditPartialImport } from './videoEditProjectFileImport'
import { importVideoEditProjectFilesCapability } from '@/core/application-control/domains/videoEdit/videoEditProjectFileImportCapability'
import { collectVideoEditOutput } from './videoEditOutputs'
import { captureVideoEditProgramFrame } from './videoEditProgramCapture'
import { collectVideoEditCodeAsset, importVideoEditCodeAsset, type VideoEditCodeAssetTarget } from './videoEditCodeAssets'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { placeVideoEditCreativeResultFromCapability } from './videoEditResultCapability'
import { recoverVideoEditPlacement } from './videoEditPlacementRecovery'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { handleVideoEditInPlaceCapability } from './videoEditInPlaceCapability'
import { rampVideoEditClipSpeedCapability, rippleVideoEditClipSpeedCapability } from '@/core/application-control/domains/videoEdit/videoEditSpeedCapability'
import { rampVideoEditClipSpeed, rippleVideoEditClipSpeed } from './videoEditSpeedCapability'
import { followVideoEditTrackerCapability, stabilizeVideoEditClipCapability, trackVideoEditRecordingCapability } from '@/core/application-control/domains/videoEdit/videoEditTrackingCapabilities'
import { followVideoEditTrackerFromCapability, stabilizeVideoEditClipFromCapability, trackVideoEditRecordingFromCapability } from './videoEditTrackingCapabilities'
import { nestVideoEditClipsCapability } from '@/core/application-control/domains/videoEdit/videoEditNestCapability'
import { nestVideoEditClipsFromCapability } from './videoEditNestCapability'
import { measureVideoEditLoudnessCapability, normalizeVideoEditLoudnessCapability } from '@/core/application-control/domains/videoEdit/videoEditLoudnessCapabilities'
import { executeVideoEditLoudnessCapability } from './videoEditLoudnessCapability'
import { generateVideoEditAudioDuckingCapability } from '@/core/application-control/domains/videoEdit/videoEditAudioDuckingCapability'
import { executeVideoEditAudioDuckingCapability } from './videoEditAudioDuckingCapability'
import { VideoEditOperationFailure } from '@/core/videoEdit/operationFailure'
import { retryVideoEditSmartRegionCapability } from '@/core/application-control/domains/videoEdit/videoEditSmartRegionCapability'
import { retryVideoEditSmartRegionFromCapability } from './videoEditSmartRegionCapability'
import { guardVideoEditDocumentAlgorithm } from './videoEditDocumentAlgorithm'
import { analyzeVideoEditBeatsCapability } from '@/core/application-control/domains/videoEdit/videoEditBeatCapability'
import { executeVideoEditBeatCapability } from './videoEditBeatCapability'

const persistenceOwners = new WeakMap<VideoEditInstance, ApplicationPersistenceParticipant>()
let stopAudioDocumentLinks: (() => void) | null = null
let stopImageDocumentLinks: (() => void) | null = null
let stopTracking: (() => void) | null = null
let stopSmartRegions: (() => void) | null = null

export const videoEditApplicationDomain: ApplicationDomainModule = {
  reviewTarget(ref) {
    if (ref.kind !== 'video_edit.sequence') return undefined
    const separator = ref.id.indexOf(':')
    if (separator < 0) return undefined
    const instance = requireVideoEditInstance(ref.id.slice(0, separator))
    const sequence = instance.document.sequences.find(value => value.id === ref.id.slice(separator + 1))
    return sequence ? { name: sequence.name, situation: `序列里有 ${sequence.captions?.length ?? 0} 条字幕。` } : undefined
  },
  failure(error) {
    if (error instanceof VideoEditOperationFailure) {
      // 纯规划阶段的拒绝；已提交生成或保存失败不在此名单，不能抹掉执行事实。
      const notExecuted = ['reference_missing', 'sequence_missing', 'clip_missing', 'take_missing', 'duration_range', 'range', 'track_locked', 'slot_occupied', 'trim_boundary', 'failed_task_missing', 'recover_original', 'not_in_project', 'project_path_rejected'].includes(String(error.facts.reason))
      return { ok: false, error: { code: 'CAPABILITY_REJECTED', message: error.message, recoverable: true, details: { videoEdit: error.facts, ...(notExecuted ? { execution: { notExecuted: true } } : {}) } } }
    }
    return undefined
  },
  recoverOperation: recoverVideoEditPlacement,
  id: 'videoEdit', entities: createVideoEditRegistrations,
  registerExecutors(engine) {
    engine.registerMutationExecutor(new CodeProjectFileMutationExecutor())
    engine.registerCollectionExecutor(new CodeProjectFileCollectionExecutor())
    engine.registerCollectionExecutor(new CodeComponentCollectionExecutor())
    for (const type of [STYLE_ENTITY, TEMPLATE_ENTITY] as const) { engine.registerCollectionExecutor(new VideoEditStyleCollectionExecutor(type)); engine.registerMutationExecutor(new VideoEditStyleMutationExecutor(type)) }
    engine.registerCollectionExecutor(new VideoEditProjectTemplateCollectionExecutor())
    engine.registerMutationExecutor(new VideoEditProjectTemplateMutationExecutor())
    engine.registerCollectionExecutor(new VideoEditTextPresetExecutor())
    engine.registerMutationExecutor(new VideoEditPresetMutationExecutor())
    engine.registerMutationExecutor(new VideoEditTextPresetMutationExecutor())
    engine.registerCollectionExecutor(new VideoEditExportPresetExecutor())
    engine.registerMutationExecutor(new VideoEditExportPresetMutationExecutor())
    for (const entityType of ['video_edit.document', 'video_edit.sequence', 'video_edit.bin', 'video_edit.item', 'video_edit.track', 'video_edit.clip', 'video_edit.annotation', 'video_edit.code_material', 'video_edit.marker', 'video_edit.caption', ...VIDEO_EDIT_COMPOSITE_TYPES] as const) engine.registerMutationExecutor(new VideoEditMutationExecutor(entityType))
    engine.registerMutationExecutor(new VideoEditSourceExecutor())
    for (const entityType of VIDEO_EDIT_SCENE_TYPES) engine.registerMutationExecutor(new VideoEditSceneMutationExecutor(entityType))
    engine.registerCollectionExecutor(new VideoEditSceneCollectionExecutor())
    engine.registerCollectionExecutor(new VideoEditSceneRecordCollectionExecutor())
    for (const entityType of ['video_edit.sequence', 'video_edit.bin', 'video_edit.item', 'video_edit.clip', 'video_edit.annotation', 'video_edit.code_material', 'video_edit.code_version', 'video_edit.marker', 'video_edit.caption', 'video_edit.track', ...VIDEO_EDIT_COMPOSITE_TYPES] as const) engine.registerCollectionExecutor(new VideoEditCollectionExecutor(entityType))
  },
  registerCapabilities(registrar) {
    registerCurrentDocumentProvider('videoEdit', host => host.activeWorkspace === 'videoEdit' ? activeVideoEditInstance()?.document.id : undefined)
    // 剪辑文档的通用打开与后台释放（3.1）：项目与文档的列出、新建、移动、删除走通用文档能力，
    // 这里只登记“打开到哪里”（剪辑工作区）和“后台持有的实例怎么释放”。
    registerDocumentOpener('video_edit', async (document) => {
      await openVideoEditDocument({ id: document.id, path: document.path })
      openApplicationSurface('workspace.video_edit')
    })
    registerDocumentReleaser('video_edit', releaseVideoEditDocument)
    // 列表里没有封面的剪辑（含草稿）从内容补生成：与编辑时同一取法
    // 项目卡片悬停预览：按位置取剪辑里那一刻最上层的画面
    registerDocumentHoverPreview('video_edit', (read, fraction) => videoEditFrameSourceAt(videoEditDocumentFromContent(read.content, { id: read.meta.id, name: read.meta.name }), fraction))
    registerDocumentCoverProvider('video_edit', (read) => { const source = videoEditCoverSource(videoEditDocumentFromContent(read.content, { id: read.meta.id, name: read.meta.name })); return source ? [source] : null })
    // 通用“收集素材到项目”（4.4）：导出进行中或参数调整未完成时不允许整份改写
    registerDocumentBusyCheck('video_edit', videoEditBusyReason)
    // 图片文档放进剪辑保持链接（4.1）：图片文档写回后，打开着的剪辑里链接它的片段自动重新渲染
    stopAudioDocumentLinks ??= startVideoEditAudioDocumentLinks()
    stopImageDocumentLinks ??= startVideoEditImageDocumentLinks()
    // 智能区域（4.7d）：打开着的剪辑里挂了作用区域的效果，后台自动开始分析（不依赖页面是否打开）
    stopSmartRegions ??= startVideoEditSmartRegions()
    stopTracking ??= startVideoEditTracking()
    // 嵌入模式的宿主（4.1）：从剪辑里打开的文档“返回剪辑 · 项目名”，助手 open_document 的 fromDocumentId 也走这里
    getDocumentOperations().registerEmbedHost('video_edit', videoEditEmbedHost)
    for (const definition of VIDEO_EDIT_APPLICATION_CAPABILITIES) registrar.registerHandler(definition.id, guardVideoEditDocumentAlgorithm(definition.id, async (raw, context) => {
      if (definition.id === upgradeVideoEditCodeMaterialsCapability.id) return upgradeVideoEditCodeMaterials(upgradeVideoEditCodeMaterialsCapability.inputSchema.parse(raw), context.signal)
      if (definition.id === commitVideoEditCodeProjectCapability.id) {
        const input = commitVideoEditCodeProjectCapability.inputSchema.parse(raw)
        await openVideoEditDocument({ id: input.documentRef.id }, { focus: false })
        const target = { id: input.documentRef.id, path: requireVideoEditInstance(input.documentRef.id).session.documentMeta.path }
        const commit = await getPlatform().documents.commitCodeProject({ target, message: input.message })
        notifyVideoCodeProjectChanged(input.documentRef.id)
        return { resultRef: { kind: 'video_edit.code_project', id: input.documentRef.id }, commit, verified: (await getPlatform().documents.readCodeProject(target)).head === commit, message: '已提交工程工作区。' }
      }
      if (definition.id === sendVideoEditAudioCapability.id) {
        const input = sendVideoEditAudioCapability.inputSchema.parse(raw)
        const target = splitVideoEditRef(input.clipRef)
        if (target.projectId !== input.documentRef.id || !target.childId) throw new Error('片段必须属于目标剪辑')
        const result = await sendVideoEditClipToAudioEdit(input.documentRef.id, target.childId, false)
        return { resultRef: input.documentRef, created: result.created, audioDocumentRef: { kind: 'audio_edit.document', id: result.documentId }, clipRef: { kind: 'video_edit.clip', id: `${input.documentRef.id}:${result.clipId}` }, verified: await verifyVideoEditSaved(input.documentRef.id), message: '已建立音频编辑链接，保存声音后自动更新，可在剪辑中一步撤销链接。' }
      }
      if (definition.id === videoEditStaggerCapability.id) {
        context.signal.throwIfAborted()
        const input = videoEditStaggerCapability.inputSchema.parse(raw), id = input.documentRef.id
        const child = (ref: { kind: string; id: string }): string => { const value = splitVideoEditRef(ref); if (value.projectId !== id || !value.childId) throw new Error(`${ref.kind} 必须属于目标剪辑。`); return value.childId }
        const changed = staggerVideoMotion(id, child(input.sequenceRef), child(input.sourceRef), input.targetRefs.map(child), input.sourceRange, input.stepFrames)
        return { resultRefs: changed.map(clipId => ({ kind: 'video_edit.clip', id: `${id}:${clipId}` })), message: '已错峰复制动作。', verification: { verified: true, condition: '所有目标曲线通过范围校验并在同一次文档编辑中提交。' } }
      }
      const annotations = handleVideoEditAnnotationCapability(definition.id, raw)
      if (annotations) return annotations
      if (definition.id === analyzeVideoEditBeatsCapability.id) return executeVideoEditBeatCapability(analyzeVideoEditBeatsCapability.inputSchema.parse(raw), context.signal)
      if (definition.id === placeVideoEditSoundEffectsCapability.id) return placeVideoEditSoundEffects(placeVideoEditSoundEffectsCapability.inputSchema.parse(raw), context.signal)
      if (definition.id === remixVideoEditMusicCapability.id) return executeVideoEditMusicRemixCapability(remixVideoEditMusicCapability.inputSchema.parse(raw), context.signal)
      if (definition.id === retryVideoEditSmartRegionCapability.id) return retryVideoEditSmartRegionFromCapability(raw, context.signal)
      if (definition.id === importVideoEditProjectFilesCapability.id) return importVideoEditProjectFiles(raw, context.signal)
      const styles = await handleVideoEditStyleCapability(definition.id, raw, context.signal)
      if (styles !== undefined) return styles
      const multicam = await handleVideoEditMulticamCapability(definition.id, raw, context.signal)
      if (multicam !== undefined) return multicam
      const textEdit = await handleVideoEditTextCapability(definition.id, raw, context.signal)
      if (definition.id === queryVideoEditContentCapability.id) return readVideoEditContentIndex(raw, context)
      if (definition.id === queryVideoEditSourceMapCapability.id) return queryVideoEditSourceMap(raw, context)
      if (definition.id === queryVideoEditReviewCapability.id) return queryVideoEditReview(raw, context)
      if (textEdit) return textEdit
      const transfer = await handleVideoEditWorkspaceTransfer(definition.id, raw, context.signal)
      if (transfer) return transfer
      const proxy = await handleVideoEditProxyCapability(definition.id, raw, context)
      if (proxy) return proxy
      const preview = await handleVideoEditRenderCacheCapability(definition.id, raw, context)
      if (preview) return preview
      const scenes = await handleVideoEditSceneCapability(definition.id, raw, context)
      if (scenes) return scenes
      if (definition.id === screenAttentionVideoEditCapability.id) return executeVideoEditScreenAttentionCapability(screenAttentionVideoEditCapability.inputSchema.parse(raw), context.signal)
      if (definition.id === reframeVideoEditCapability.id) return executeVideoEditReframeCapability(reframeVideoEditCapability.inputSchema.parse(raw), context.signal, context.callerGrant?.permissions)
      if (definition.id === generateVideoEditAudioDuckingCapability.id) return executeVideoEditAudioDuckingCapability(generateVideoEditAudioDuckingCapability.inputSchema.parse(raw), context.signal)
      if (definition.id === analyzeVideoEditColorGradeCapability.id) {
        const input = analyzeVideoEditColorGradeCapability.inputSchema.parse(raw)
        const sequence = splitVideoEditRef(input.sequenceRef); const clip = splitVideoEditRef(input.clipRef)
        if (sequence.projectId !== input.documentRef.id || clip.projectId !== input.documentRef.id || !sequence.childId || !clip.childId) throw new Error('序列和片段必须属于目标剪辑。')
        const reference = input.referenceClipRef ? splitVideoEditRef(input.referenceClipRef) : undefined
        if (reference && (reference.projectId !== input.documentRef.id || !reference.childId)) throw new Error('参考片段必须属于目标剪辑。')
        const result = await analyzeVideoEditColorGrade({ projectId: input.documentRef.id, sequenceId: sequence.childId, clipId: clip.childId }, input.frame, context.signal, undefined, { sampleCount: input.sampleCount, referenceClipId: reference?.childId, matchMethod: input.matchMethod })
        return { ...result, resultRef: input.clipRef, message: '已分析自动校色建议，可写入全能调色参数后观察并微调。' }
      }
      if (definition.id === exportVideoEditColorLutCapability.id) {
        const input = exportVideoEditColorLutCapability.inputSchema.parse(raw)
        const effect = splitVideoEditRef(input.effectRef)
        if (effect.projectId !== input.documentRef.id || !effect.childId) throw notExecutedFailure(new Error('effectRef 必须属于目标剪辑，请使用目录返回的完整引用。'))
        try {
          const result = await exportVideoEditColorGrade({ projectId: input.documentRef.id, effectId: effect.childId, frame: input.frame, format: input.format, lutSize: input.lutSize, path: input.path, overwrite: input.overwrite, signal: context.signal })
          return { ...colorGradeExportReceipt(result), resultRef: input.effectRef, clipRef: { kind: 'video_edit.clip', id: `${input.documentRef.id}:${result.clipId}` }, frame: result.frame }
        } catch (error) { throw error instanceof ColorGradeExportRejection ? notExecutedFailure(error) : error }
      }
      if (definition.id === observeVideoEditColorCapability.id) {
        const input = observeVideoEditColorCapability.inputSchema.parse(raw)
        const sequence = splitVideoEditRef(input.sequenceRef); const clip = input.clipRef ? splitVideoEditRef(input.clipRef) : undefined
        const sequenceId = sequence.childId
        if (sequence.projectId !== input.documentRef.id || !sequenceId || clip && (clip.projectId !== input.documentRef.id || !clip.childId)) throw new Error('序列和片段必须属于目标剪辑。')
        const result = await observeVideoEditColor({ projectId: input.documentRef.id, sequenceId, clipId: clip?.childId }, { frame: input.frame, stage: input.stage, sampleCount: input.sampleCount, scopes: input.includeScopes }, context.signal)
        const { readout, scopes } = result.statistics
        return { resultRef: input.sequenceRef, stage: result.stage, frame: result.frame, frames: result.frames, readout, ...(scopes ? { scopes } : {}), documentRevision: result.documentRevision, documentVersion: result.documentVersion,
          message: `中灰偏差 ${readout.exposure.middleGrayOffsetEv} EV，高光溢出 ${readout.clipping.highlightsPercent}%，估计光源 ${readout.whiteBalance.kelvin} K（可信度 ${readout.whiteBalance.confidence}）。` }
      }
      if (definition.id === measureVideoEditLoudnessCapability.id) return executeVideoEditLoudnessCapability(measureVideoEditLoudnessCapability.inputSchema.parse(raw), false, context.signal)
      if (definition.id === 'detect_video_edit_sensitive_text') return executeVideoEditPrivacy(raw, context)
      if (definition.id === normalizeVideoEditLoudnessCapability.id) return executeVideoEditLoudnessCapability(normalizeVideoEditLoudnessCapability.inputSchema.parse(raw), true, context.signal)
      const exporting = await handleVideoEditExportCapability(definition.id, raw, context)
      if (exporting) return exporting
      const subtitles = await handleVideoEditSubtitleCapability(definition.id, raw, context)
      if (subtitles) return subtitles
      // 原地生成（4.12）：与时间线右键同一个服务
      if (definition.id === rippleVideoEditClipSpeedCapability.id) return rippleVideoEditClipSpeed(raw, context)
      if (definition.id === rampVideoEditClipSpeedCapability.id) return rampVideoEditClipSpeed(raw, context)
      // 跟踪与防抖：与跟踪面板同一组领域函数
      if (definition.id === followVideoEditTrackerCapability.id) return followVideoEditTrackerFromCapability(raw, context)
      if (definition.id === stabilizeVideoEditClipCapability.id) return stabilizeVideoEditClipFromCapability(raw, context)
      if (definition.id === trackVideoEditRecordingCapability.id) return trackVideoEditRecordingFromCapability(raw, context)
      if (definition.id === nestVideoEditClipsCapability.id) return nestVideoEditClipsFromCapability(raw, context)
      const inPlace = await handleVideoEditInPlaceCapability(definition.id, raw, context)
      if (inPlace) return inPlace
      if (definition.id === observeVideoEditFrameCapability.id) {
        const input = observeVideoEditFrameCapability.inputSchema.parse(raw); const id = input.documentRef.id
        const child = (ref: { kind: string; id: string }): string => { const value = splitVideoEditRef(ref); if (value.projectId !== id || !value.childId) throw new Error(`${ref.kind} 必须属于目标剪辑。`); return value.childId }
        const observed = await observeVideoEditFrame(id, input.target.kind === 'source' ? { kind: 'source', itemId: child(input.target.itemRef), timeUs: input.target.timeUs } : { ...input.target, ...(input.target.sequenceRef ? { sequenceId: child(input.target.sequenceRef) } : {}) }, input.maxWidth, context.signal, undefined, { documentVersion: input.documentVersion, overlayAnnotations: input.overlayAnnotations, annotationIds: input.annotationIds, cropAnnotationId: input.cropAnnotationId, cropRegion: input.cropRegion, ...(input.reference ? { reference: { itemId: child(input.reference.itemRef), offsetUs: input.reference.offsetUs } } : {}), ...(input.highlightElement ? { highlightElement: { clipId: child(input.highlightElement.clipRef), elementId: input.highlightElement.elementId } } : {}) })
        const resultRef = { kind: 'asset' as const, id: observed.asset.id }
        return { resultRef, ...(observed.comparison ? { comparison: { referenceItemRef: { kind: 'video_edit.item', id: `${id}:${observed.comparison.referenceItemId}` }, referenceTimesUs: observed.comparison.referenceTimesUs } } : {}), ...(observed.performance?.length ? { performance: observed.performance } : {}), ...(observed.contactSheet ? { contactSheet: observed.contactSheet } : {}), byteLength: observed.byteLength, documentRef: input.documentRef, target: input.target, width: observed.width, height: observed.height, sourceWidth: observed.sourceWidth, sourceHeight: observed.sourceHeight, documentRevision: observed.documentRevision, documentVersion: observed.documentVersion,
          message: `已渲染${observed.comparison ? '参考比较' : observed.contactSheet ? '联系表' : input.target.kind === 'program' ? `序列帧 ${input.target.frame}` : '源素材画面'}（${observed.width}×${observed.height}），用 read_application_media 并设置 mode="image" 直接查看该资产画面。`,
          verification: { verified: true, target: resultRef, condition: '已用正式渲染器生成固定版本画面，并通过资产检查核对尺寸。' } }
      }
      if (definition.id === trimVideoEditClipCapability.id) return await trimVideoEditClip(trimVideoEditClipCapability.inputSchema.parse(raw))
      if (definition.id === placeVideoEditCreativeResultCapability.id) return await placeVideoEditCreativeResultFromCapability(placeVideoEditCreativeResultCapability.inputSchema.parse(raw), context.signal, context.callerGrant ? context.requestId : undefined)
      if (definition.id === openVideoEditClipSourceCapability.id) {
        // 回到来源（4.1）：与时间线右键 / 双击同一入口
        const input = openVideoEditClipSourceCapability.inputSchema.parse(raw); const id = input.documentRef.id
        const ref = splitVideoEditRef(input.clipRef)
        if (ref.projectId !== id || !ref.childId) throw new Error('clipRef 必须属于目标剪辑，请使用目录返回的完整引用。')
        const source = videoEditClipSource(id, ref.childId)
        if (!source) throw new Error('这个片段没有记录来源（直接导入的素材），没有可回去编辑的文档或生成记录。')
        const outcome = await openVideoEditClipSource(id, ref.childId)
        const opened = outcome.status === 'opened'
        return { resultRef: input.clipRef, documentRef: input.documentRef, status: outcome.status, sourceType: source.type,
          message: opened ? (source.type === 'generation' ? '已打开生成页并定位到来源记录。' : '已以嵌入模式打开来源文档，用户改完可点“返回剪辑”回到原位置。') : (source.type === 'generation' ? '来源生成记录已被删除，无法回到来源。' : '来源文档找不到：请用户在剪辑里右键这个片段选择“回到来源继续编辑”，再点“重新定位…”选到它现在的位置。'),
          verification: { verified: opened, target: input.clipRef, condition: opened ? '来源已交给对应界面打开。' : '来源找不到，没有打开。' } }
      }
      if (definition.id === collectVideoEditCodeAssetCapability.id) {
        const input = collectVideoEditCodeAssetCapability.inputSchema.parse(raw)
        const ref = splitVideoEditRef(input.targetRef)
        if (ref.projectId !== input.documentRef.id) throw new Error('代码素材目标必须属于明确的原剪辑。')
        const owner = requireVideoEditInstance(ref.projectId)
        let target: VideoEditCodeAssetTarget
        if (input.targetRef.kind === 'video_edit.item') target = { kind: 'item', itemId: ref.childId }
        else if (input.targetRef.kind === 'video_edit.code_material') target = { kind: 'definition', definitionId: ref.childId }
        else {
          const sequence = owner.document.sequences.find(sequence => sequence.clips.some(clip => input.targetRef.kind === 'video_edit.clip' ? clip.id === ref.childId : clip.effects?.some(effect => effect.id === ref.childId)))
          const clip = sequence?.clips.find(clip => input.targetRef.kind === 'video_edit.clip' ? clip.id === ref.childId : clip.effects?.some(effect => effect.id === ref.childId))
          if (!sequence || !clip) throw new Error('原代码片段或效果已不存在。')
          target = { kind: 'clip', sequenceId: sequence.id, clipId: clip.id, ...(input.targetRef.kind === 'video_edit.effect' ? { effectId: ref.childId } : {}) }
        }
        // 能力调用不弹保存对话框：先写进项目“导出”文件夹再收录。
        const path = async (): Promise<string> => uniqueVideoEditOutputPath(await videoEditProjectOutputDirectory(ref.projectId), '可编辑代码素材', 'henji-code')
        const collected = await collectVideoEditCodeAsset(ref.projectId, target, { ...(input.libraryRef ? { libraryId: input.libraryRef.id } : {}), path }, context.signal)
        if (!collected) throw new Error('用户取消代码素材保存，没有收录资产。')
        const resultRef = { kind: 'asset' as const, id: collected.asset.id }
        const detached = collected.detachedSceneParameters.length ? `片子数据没有随资产带走：参数 ${collected.detachedSceneParameters.join('、')} 在资产里为空，导入后需要重新指定。` : ''
        return { resultRef, documentRef: input.documentRef, message: `可编辑代码素材已加入资产库，可在另一剪辑引用并重新调参。${detached}`, verification: { verified: true, target: resultRef, condition: '正式资产检查已核对代码清单的固定路径、结构与内容身份。' } }
      }
      if (definition.id === collectVideoEditOutputCapability.id) {
        const input = collectVideoEditOutputCapability.inputSchema.parse(raw)
        const task = input.kind === 'export' ? videoEditQueuedExportTask(input.documentRef.id, input.taskId!) : undefined
        if (input.kind === 'export' && (!task || task.state !== 'completed' || !task.output)) throw new Error('请提供原剪辑已完成且可收录的导出taskId；先查询导出状态。')
        const receipt = input.kind === 'export' ? task!.output! : await captureVideoEditProgramFrame(input.documentRef.id, input.frame, async () => uniqueVideoEditOutputPath(await videoEditProjectOutputDirectory(input.documentRef.id), `${requireVideoEditInstance(input.documentRef.id).document.name}-节目帧${input.frame ?? ''}`, 'png'), context.signal)
        if (!receipt) throw new Error('用户取消选帧，没有保存文件或收录素材。')
        const asset = await collectVideoEditOutput(receipt, input.libraryRef ? { libraryId: input.libraryRef.id } : {}, context.signal)
        const resultRef = { kind: 'asset' as const, id: asset.id }
        return { resultRef, documentRef: input.documentRef, message: '输出已加入资产库，可通过此素材引用加入画布。', verification: { verified: true, target: resultRef, condition: '正式资产检查已核对已发布输出的固定原路径与内容身份。' } }
      }
      const input = definition.inputSchema.parse(raw) as { documentRef: { kind: 'video_edit.document'; id: string }; clipRef?: { id: string }; frame?: number; assetRef?: { id: string } }
      const id = input.documentRef.id; const owner = requireVideoEditInstance(id)
      let importedItemIds: string[] | undefined
      switch (definition.id) {
        case 'import_video_edit_folder': {
          const contentVersion = owner.contentVersion
          let result
          try { result = await chooseVideoEditFolders(id, undefined, { signal: context.signal }) }
          catch (error) { return settleVideoEditPartialImport(error, owner, input.documentRef) }
          if (isVideoEditContentCurrent(owner, contentVersion) && !result.skipped) throw new Error('未导入素材，用户取消选择或所选目录无法读取。')
          await saveVideoEdit(id)
          const current = requireVideoEditInstance(id)
          const verified = await verifyVideoEditSaved(id, current.document)
          return { resultRef: input.documentRef, verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读并核对导入的素材与素材箱。' }, message: `已导入 ${result.itemIds.length} 个素材，跳过 ${result.skipped} 项。` }
        }
        case 'undo_video_edit': undoVideoEdit(id); await saveVideoEdit(id); break
        case 'redo_video_edit': undoVideoEdit(id, true); await saveVideoEdit(id); break
        case 'save_video_edit': await saveVideoEdit(id); break
        case 'add_video_edit_frame_hold':
        case 'split_video_edit': {
          if (!input.clipRef?.id.startsWith(`${id}:`) || input.frame === undefined) throw new Error('拆分需要本剪辑 clipRef 与整数 frame。')
          const clipId = input.clipRef.id.slice(id.length + 1)
          const sequence = requireVideoEditInstance(id).document.sequences.find(sequence => sequence.clips.some(clip => clip.id === clipId))
          if (!sequence) throw new Error('目标片段不存在。')
          // Same razor semantics as the timeline: linked portions are cut together unless Linked Selection is off.
          const current = requireVideoEditInstance(id)
          const linked = videoEditPickRelations((current.activeSequenceId === sequence.id ? current : current.sequenceViews.get(sequence.id))?.linkedSelection !== false)
          executeVideoEditTimelineEdit(id, sequence.id, { kind: definition.id === 'add_video_edit_frame_hold' ? 'frame_hold' : 'split', clipIds: [clipId], linked: definition.id === 'add_video_edit_frame_hold' ? false : linked, frame: input.frame! }); await saveVideoEdit(id); break
        }
        case 'import_video_edit_asset': {
          if (!input.assetRef) throw new Error('请提供素材库 assetRef。')
          const contentVersion = owner.contentVersion
          const asset = await assetApplicationService.inspect(input.assetRef.id)
          context.signal?.throwIfAborted()
          if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('原剪辑已关闭或导入期间已有修改，请重新引用素材。')
          if (asset.mediaType === 'code') {
            let filterTarget: { sequenceId: string; clipId: string } | undefined
            if (input.clipRef) {
              const ref = splitVideoEditRef({ kind: 'video_edit.clip', id: input.clipRef.id })
              const sequence = owner.document.sequences.find(sequence => sequence.clips.some(clip => clip.id === ref.childId))
              if (ref.projectId !== id || !sequence) throw new Error('代码效果目标必须属于原剪辑。')
              filterTarget = { sequenceId: sequence.id, clipId: ref.childId }
            }
            const imported = await importVideoEditCodeAsset(id, asset.id, { filterTarget }, context.signal)
            importedItemIds = imported.itemId ? [imported.itemId] : []
          } else importedItemIds = await importVideoEditSources(id, [{ assetId: asset.id }], undefined, context.signal)
          await saveVideoEdit(id); break
        }
      }
      if (requireVideoEditInstance(id) !== owner) throw new Error('原剪辑已关闭，操作回执不会写入重新打开的剪辑。')
      const instance = requireVideoEditInstance(id)
      const verified = await verifyVideoEditSaved(id, instance.document)
      if (importedItemIds) {
        const itemRefs = importedItemIds.map(itemId => ({ kind: 'video_edit.item' as const, id: `${id}:${itemId}` }))
        return { resultRef: input.documentRef, itemRefs, verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读并核对编辑内容。' }, message: itemRefs.length ? `已引用到剪辑，素材项 ${itemRefs.length} 个（itemRefs），可接着设素材箱或放进时间线。` : '代码滤镜已应用到目标片段。' }
      }
      return { resultRef: input.documentRef, verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读并核对编辑内容。' }, message: '操作已完成，请回读剪辑核对结果。' }
    }))
  },
  resolvePersistenceParticipants(steps) {
    const ids = new Set(steps.flatMap(step => step.kind === 'mutation' && isVideoEditDocumentKind(step.target.kind) ? [splitVideoEditRef(step.target).projectId]
      : step.kind === 'collection' && !VIDEO_EDIT_LIBRARY_KINDS.has(step.entityType) && isVideoEditDocumentKind(step.parent.kind) ? [splitVideoEditRef(step.parent).projectId] : []))
    return [...codeProjectPersistenceParticipants(steps), ...[...ids].map(id => {
      const owner = requireVideoEditInstance(id)
      const existing = persistenceOwners.get(owner)
      if (existing) return existing
      const participant: ApplicationPersistenceParticipant = { key: videoEditPersistenceKey(id), begin() {
      const batch = beginVideoEditCommitBatch(id)
      return bindVideoEditCommitBatch({
        async confirm() { endVideoEditCommitBatch(batch); try { await saveVideoEdit(id) } catch (error) { throw new ApplicationPersistenceFailure('修改已保留但未保存。请重试保存，不要再次执行剪辑。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: { kind: 'video_edit.document', id }, replayMutation: false } }, error) } },
        release() { endVideoEditCommitBatch(batch) },
      }, batch)
      } }
      persistenceOwners.set(owner, participant)
      return participant
    })]
  },
}
