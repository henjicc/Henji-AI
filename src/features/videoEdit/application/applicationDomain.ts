import { CodeComponentCollectionExecutor } from './videoEditCodeComponentReflection'
import { VideoEditTextPresetExecutor, VideoEditTextPresetMutationExecutor } from './videoEditTextPresetReflection'
import { VideoEditStyleKitCollectionExecutor, VideoEditStyleKitMutationExecutor, STYLE_KIT_ENTITY, STYLE_PRESET_ENTITY } from './videoEditStyleKitReflection'
import { handleVideoEditStyleKitCapability } from './videoEditStyleKitCapabilities'
import { handleVideoEditMulticamCapability } from './videoEditMulticamCapability'
import { handleTitleTemplateCapability } from './videoEditTitleTemplateCapability'
import { TitleTemplateCollectionExecutor, TitleTemplateMutationExecutor } from './videoEditTitleTemplateReflection'
import { handleVideoEditProxyCapability } from './videoEditProxyCapability'
import { reframeVideoEditCapability } from '@/core/application-control/domains/videoEdit/videoEditReframeCapability'
import { handleVideoEditTextCapability } from './videoEditTextCapability'
import { executeVideoEditReframeCapability } from './videoEditReframeCapability'
import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { analyzeVideoEditColorGradeCapability } from '@/core/application-control/domains/videoEdit/videoEditColorGradeCapability'
import { analyzeVideoEditColorGrade } from './videoEditColorGrade'
import { handleVideoEditSubtitleCapability } from './videoEditSubtitleCapability'
import { ApplicationPersistenceFailure, type ApplicationPersistenceParticipant } from '@/core/application-control/execution/persistence'
import { createVideoEditRegistrations } from './videoEditReflection'
import { handleVideoEditSceneCapability } from './videoEditSceneCapability'
import { handleVideoEditWorkspaceTransfer } from './videoEditWorkspaceTransfer'
import { VideoEditCollectionExecutor, VideoEditMutationExecutor } from './videoEditExecutors'
import { VIDEO_EDIT_COMPOSITE_TYPES } from './videoEditCompositeEntities'
import { openVideoEditDocument, releaseVideoEditDocument, requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved, videoEditDocumentFromContent, type VideoEditInstance } from './videoEditService'
import { videoEditCoverSource, videoEditFrameSourceAt } from './videoEditProjectCover'
import { registerDocumentCoverProvider, registerDocumentHoverPreview } from '@/features/documents/documentCovers'
import { getDocumentOperations, registerDocumentBusyCheck, registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { startVideoEditImageDocumentLinks } from './videoEditImageLinks'
import { startVideoEditSmartRegions } from './videoEditSmartRegions'
import { startVideoEditTracking } from './videoEditTracking'
import { openVideoEditClipSource, videoEditClipSource, videoEditEmbedHost } from './videoEditComposition'
import { undoVideoEdit, videoEditBusyReason } from './videoEditService'
import { executeVideoEditTimelineEdit } from './videoEditTimeline'
import { videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import { splitVideoEditRef } from './videoEditReflection'
import { VIDEO_EDIT_APPLICATION_CAPABILITIES, collectVideoEditOutputCapability, collectVideoEditCodeAssetCapability, placeVideoEditCreativeResultCapability, observeVideoEditFrameCapability, openVideoEditClipSourceCapability, trimVideoEditClipCapability } from '@/core/application-control/domains/videoEdit/videoEditApplicationCapabilities'
import { trimVideoEditClip } from './videoEditTrimCapability'
import { handleVideoEditExportCapability } from './videoEditExportCapability'
import { videoEditQueuedExportTask } from './videoEditExportQueue'
import { VideoEditExportPresetExecutor, VideoEditExportPresetMutationExecutor } from './videoEditExportPresetReflection'
import { VideoEditSourceExecutor } from './videoEditSourceExecutor'
import { importVideoEditSources } from './videoEditMedia'
import { chooseVideoEditFolders, VideoEditPartialImportFailure } from './videoEditFolderImport'
import { ApplicationTransactionFailure } from '@/core/application-control/execution/transactionFailure'
import { collectVideoEditOutput } from './videoEditOutputs'
import { captureVideoEditProgramFrame } from './videoEditProgramCapture'
import { collectVideoEditCodeAsset, importVideoEditCodeAsset, type VideoEditCodeAssetTarget } from './videoEditCodeAssets'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { placeVideoEditCreativeResultFromCapability } from './videoEditResultCapability'
import { recoverVideoEditPlacement } from './videoEditPlacementRecovery'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { handleVideoEditInPlaceCapability } from './videoEditInPlaceCapability'
import { rippleVideoEditClipSpeedCapability } from '@/core/application-control/domains/videoEdit/videoEditSpeedCapability'
import { rippleVideoEditClipSpeed } from './videoEditSpeedCapability'
import { nestVideoEditClipsCapability } from '@/core/application-control/domains/videoEdit/videoEditNestCapability'
import { nestVideoEditClipsFromCapability } from './videoEditNestCapability'
import { measureVideoEditLoudnessCapability, normalizeVideoEditLoudnessCapability } from '@/core/application-control/domains/videoEdit/videoEditLoudnessCapabilities'
import { executeVideoEditLoudnessCapability } from './videoEditLoudnessCapability'
import { generateVideoEditAudioDuckingCapability } from '@/core/application-control/domains/videoEdit/videoEditAudioDuckingCapability'
import { executeVideoEditAudioDuckingCapability } from './videoEditAudioDuckingCapability'

const persistenceOwners = new WeakMap<VideoEditInstance, ApplicationPersistenceParticipant>()
let stopImageDocumentLinks: (() => void) | null = null
let stopTracking: (() => void) | null = null
let stopSmartRegions: (() => void) | null = null

export const videoEditApplicationDomain: ApplicationDomainModule = {
  recoverOperation: recoverVideoEditPlacement,
  id: 'videoEdit', entities: createVideoEditRegistrations,
  registerExecutors(engine) {
    engine.registerCollectionExecutor(new CodeComponentCollectionExecutor())
    for (const type of [STYLE_KIT_ENTITY, STYLE_PRESET_ENTITY] as const) { engine.registerCollectionExecutor(new VideoEditStyleKitCollectionExecutor(type)); engine.registerMutationExecutor(new VideoEditStyleKitMutationExecutor(type)) }
    engine.registerCollectionExecutor(new VideoEditTextPresetExecutor())
    engine.registerMutationExecutor(new VideoEditTextPresetMutationExecutor())
    engine.registerCollectionExecutor(new TitleTemplateCollectionExecutor())
    engine.registerMutationExecutor(new TitleTemplateMutationExecutor())
    engine.registerCollectionExecutor(new VideoEditExportPresetExecutor())
    engine.registerMutationExecutor(new VideoEditExportPresetMutationExecutor())
    for (const entityType of ['video_edit.document', 'video_edit.sequence', 'video_edit.bin', 'video_edit.item', 'video_edit.track', 'video_edit.clip', 'video_edit.annotation', 'video_edit.code_material', 'video_edit.marker', 'video_edit.caption', ...VIDEO_EDIT_COMPOSITE_TYPES] as const) engine.registerMutationExecutor(new VideoEditMutationExecutor(entityType))
    engine.registerMutationExecutor(new VideoEditSourceExecutor())
    for (const entityType of ['video_edit.sequence', 'video_edit.bin', 'video_edit.item', 'video_edit.clip', 'video_edit.annotation', 'video_edit.code_material', 'video_edit.code_version', 'video_edit.marker', 'video_edit.caption', 'video_edit.track', ...VIDEO_EDIT_COMPOSITE_TYPES] as const) engine.registerCollectionExecutor(new VideoEditCollectionExecutor(entityType))
  },
  registerCapabilities(registrar) {
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
    stopImageDocumentLinks ??= startVideoEditImageDocumentLinks()
    // 智能区域（4.7d）：打开着的剪辑里挂了作用区域的效果，后台自动开始分析（不依赖页面是否打开）
    stopSmartRegions ??= startVideoEditSmartRegions()
    stopTracking ??= startVideoEditTracking()
    // 嵌入模式的宿主（4.1）：从剪辑里打开的文档“返回剪辑 · 项目名”，助手 open_document 的 fromDocumentId 也走这里
    getDocumentOperations().registerEmbedHost('video_edit', videoEditEmbedHost)
    for (const definition of VIDEO_EDIT_APPLICATION_CAPABILITIES) registrar.registerHandler(definition.id, async (raw, context) => {
      const styleKit = await handleVideoEditStyleKitCapability(definition.id, raw, context)
      if (styleKit !== undefined) return styleKit
      const title = await handleTitleTemplateCapability(definition.id, raw, context.signal)
      if (title !== undefined) return title
      const multicam = await handleVideoEditMulticamCapability(definition.id, raw, context.signal)
      if (multicam !== undefined) return multicam
      const textEdit = await handleVideoEditTextCapability(definition.id, raw, context.signal)
      if (textEdit) return textEdit
      const transfer = await handleVideoEditWorkspaceTransfer(definition.id, raw, context.signal)
      if (transfer) return transfer
      const proxy = await handleVideoEditProxyCapability(definition.id, raw, context)
      if (proxy) return proxy
      const scenes = await handleVideoEditSceneCapability(definition.id, raw, context)
      if (scenes) return scenes
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
      if (definition.id === measureVideoEditLoudnessCapability.id) return executeVideoEditLoudnessCapability(measureVideoEditLoudnessCapability.inputSchema.parse(raw), false, context.signal)
      if (definition.id === normalizeVideoEditLoudnessCapability.id) return executeVideoEditLoudnessCapability(normalizeVideoEditLoudnessCapability.inputSchema.parse(raw), true, context.signal)
      const exporting = await handleVideoEditExportCapability(definition.id, raw, context)
      if (exporting) return exporting
      const subtitles = await handleVideoEditSubtitleCapability(definition.id, raw, context)
      if (subtitles) return subtitles
      // 原地生成（4.12）：与时间线右键同一个服务
      if (definition.id === rippleVideoEditClipSpeedCapability.id) return rippleVideoEditClipSpeed(raw, context)
      if (definition.id === nestVideoEditClipsCapability.id) return nestVideoEditClipsFromCapability(raw, context)
      const inPlace = await handleVideoEditInPlaceCapability(definition.id, raw, context)
      if (inPlace) return inPlace
      if (definition.id === observeVideoEditFrameCapability.id) {
        const input = observeVideoEditFrameCapability.inputSchema.parse(raw); const id = input.documentRef.id
        const child = (ref: { kind: string; id: string }): string => { const value = splitVideoEditRef(ref); if (value.projectId !== id || !value.childId) throw new Error(`${ref.kind} 必须属于目标剪辑。`); return value.childId }
        const observed = await observeVideoEditFrame(id, input.target.kind === 'program' ? { kind: 'program', frame: input.target.frame, ...(input.target.sequenceRef ? { sequenceId: child(input.target.sequenceRef) } : {}) } : { kind: 'source', itemId: child(input.target.itemRef), timeUs: input.target.timeUs }, input.maxWidth, context.signal, undefined, { overlayAnnotations: input.overlayAnnotations, annotationIds: input.annotationIds, cropAnnotationId: input.cropAnnotationId, ...(input.highlightElement ? { highlightElement: { clipId: child(input.highlightElement.clipRef), elementId: input.highlightElement.elementId } } : {}) })
        const resultRef = { kind: 'asset' as const, id: observed.asset.id }
        return { resultRef, documentRef: input.documentRef, target: input.target, width: observed.width, height: observed.height, sourceWidth: observed.sourceWidth, sourceHeight: observed.sourceHeight, documentRevision: observed.documentRevision,
          message: `已按剪辑版本 ${observed.documentRevision} 渲染${input.target.kind === 'program' ? `序列帧 ${input.target.frame}` : '源素材画面'}（${observed.width}×${observed.height}），用 read_application_media 读取该资产查看画面。`,
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
        const asset = await collectVideoEditCodeAsset(ref.projectId, target, input.libraryRef ? { libraryId: input.libraryRef.id } : {}, context.signal)
        if (!asset) throw new Error('用户取消代码素材保存，没有收录资产。')
        const resultRef = { kind: 'asset' as const, id: asset.id }
        return { resultRef, documentRef: input.documentRef, message: '可编辑代码素材已加入资产库，可在另一剪辑引用并重新调参。', verification: { verified: true, target: resultRef, condition: '正式资产检查已核对代码清单的固定路径、结构与内容身份。' } }
      }
      if (definition.id === collectVideoEditOutputCapability.id) {
        const input = collectVideoEditOutputCapability.inputSchema.parse(raw)
        const task = input.kind === 'export' ? videoEditQueuedExportTask(input.documentRef.id, input.taskId!) : undefined
        if (input.kind === 'export' && (!task || task.state !== 'completed' || !task.output)) throw new Error('请提供原剪辑已完成且可收录的导出taskId；先查询导出状态。')
        const receipt = input.kind === 'export' ? task!.output! : await captureVideoEditProgramFrame(input.documentRef.id, input.frame, undefined, context.signal)
        if (!receipt) throw new Error('用户取消选帧，没有保存文件或收录素材。')
        const asset = await collectVideoEditOutput(receipt, input.libraryRef ? { libraryId: input.libraryRef.id } : {}, context.signal)
        const resultRef = { kind: 'asset' as const, id: asset.id }
        return { resultRef, documentRef: input.documentRef, message: '输出已加入资产库，可通过此素材引用加入画布。', verification: { verified: true, target: resultRef, condition: '正式资产检查已核对已发布输出的固定原路径与内容身份。' } }
      }
      const input = definition.inputSchema.parse(raw) as { documentRef: { kind: 'video_edit.document'; id: string }; clipRef?: { id: string }; frame?: number; assetRef?: { id: string } }
      const id = input.documentRef.id; const owner = requireVideoEditInstance(id)
      switch (definition.id) {
        case 'import_video_edit_folder': {
          const baseline = owner.document
          let result
          try { result = await chooseVideoEditFolders(id, undefined, { signal: context.signal }) }
          catch (error) {
            if (!(error instanceof VideoEditPartialImportFailure)) throw error
            if (requireVideoEditInstance(id) !== owner) throw new Error('原剪辑已关闭，未写入重新打开的剪辑。', { cause: error })
            try { await saveVideoEdit(id) } catch (saveError) {
              throw new ApplicationPersistenceFailure('已导入部分保留在剪辑里，但保存未确认。请重试保存，不要重复导入。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, saveError)
            }
            throw new ApplicationTransactionFailure({ status: 'failed', code: 'EXECUTION_FAILED', message: `${error.message}已保留 ${error.imported} 个素材，可读回当前剪辑或撤销本次导入。`, recoverable: false,
              resultRefs: [input.documentRef], effects: [{ effect: 'execute', entityType: 'video_edit.document', refs: [input.documentRef], propertyIds: [], origin: { kind: 'direct' } }],
              partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] },
            })
          }
          if (owner.document === baseline && !result.skipped) throw new Error('未导入素材，用户取消选择或所选目录无法读取。')
          await saveVideoEdit(id)
          const current = requireVideoEditInstance(id)
          const verified = await verifyVideoEditSaved(id, current.document)
          return { resultRef: input.documentRef, verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读并核对导入的素材与素材箱。' }, message: `已导入 ${result.itemIds.length} 个素材，跳过 ${result.skipped} 项。` }
        }
        case 'undo_video_edit': undoVideoEdit(id); await saveVideoEdit(id); break
        case 'redo_video_edit': undoVideoEdit(id, true); await saveVideoEdit(id); break
        case 'save_video_edit': await saveVideoEdit(id); break
        case 'split_video_edit': {
          if (!input.clipRef?.id.startsWith(`${id}:`) || input.frame === undefined) throw new Error('拆分需要本剪辑 clipRef 与整数 frame。')
          const clipId = input.clipRef.id.slice(id.length + 1)
          const sequence = requireVideoEditInstance(id).document.sequences.find(sequence => sequence.clips.some(clip => clip.id === clipId))
          if (!sequence) throw new Error('目标片段不存在。')
          // Same razor semantics as the timeline: linked portions are cut together unless Linked Selection is off.
          const current = requireVideoEditInstance(id)
          const linked = videoEditPickRelations((current.activeSequenceId === sequence.id ? current : current.sequenceViews.get(sequence.id))?.linkedSelection !== false)
          executeVideoEditTimelineEdit(id, sequence.id, { kind: 'split', clipIds: [clipId], linked, frame: input.frame! }); await saveVideoEdit(id); break
        }
        case 'import_video_edit_asset': {
          if (!input.assetRef) throw new Error('请提供素材库 assetRef。')
          const importBaseline = owner.document
          const asset = await assetApplicationService.inspect(input.assetRef.id)
          context.signal?.throwIfAborted()
          if (requireVideoEditInstance(id) !== owner || owner.document !== importBaseline) throw new Error('原剪辑已关闭或导入期间已有修改，请重新引用素材。')
          if (asset.mediaType === 'code') {
            let filterTarget: { sequenceId: string; clipId: string } | undefined
            if (input.clipRef) {
              const ref = splitVideoEditRef({ kind: 'video_edit.clip', id: input.clipRef.id })
              const sequence = owner.document.sequences.find(sequence => sequence.clips.some(clip => clip.id === ref.childId))
              if (ref.projectId !== id || !sequence) throw new Error('代码效果目标必须属于原剪辑。')
              filterTarget = { sequenceId: sequence.id, clipId: ref.childId }
            }
            await importVideoEditCodeAsset(id, asset.id, { filterTarget }, context.signal)
          } else await importVideoEditSources(id, [{ assetId: asset.id }], undefined, context.signal)
          await saveVideoEdit(id); break
        }
      }
      if (requireVideoEditInstance(id) !== owner) throw new Error('原剪辑已关闭，操作回执不会写入重新打开的剪辑。')
      const instance = requireVideoEditInstance(id)
      const verified = await verifyVideoEditSaved(id, instance.document)
      return { resultRef: input.documentRef, verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读并核对编辑内容。' }, message: '操作已完成，请回读剪辑核对结果。' }
    })
  },
  resolvePersistenceParticipants(steps) {
    const ids = new Set(steps.flatMap(step => step.kind === 'mutation' && step.target.kind.startsWith('video_edit.') && !['video_edit.source', 'video_edit.export_preset', 'video_edit.text_preset', 'video_edit.title_template', 'video_edit.style_preset'].includes(step.target.kind) ? [splitVideoEditRef(step.target).projectId] : step.kind === 'collection' && !['video_edit.export_preset', 'video_edit.title_template', 'video_edit.text_preset', 'video_edit.style_preset'].includes(step.entityType) && step.parent.kind.startsWith('video_edit.') ? [splitVideoEditRef(step.parent).projectId] : []))
    return [...ids].map(id => {
      const owner = requireVideoEditInstance(id)
      const existing = persistenceOwners.get(owner)
      if (existing) return existing
      const participant: ApplicationPersistenceParticipant = { key: `video_edit:${id}`, begin() {
      const instance = requireVideoEditInstance(id)
      const initial = instance.document; const past = instance.past.slice(); const future = instance.future.slice()
      return {
        async confirm() { try { await saveVideoEdit(id) } catch (error) { throw new ApplicationPersistenceFailure('修改已保留但未保存。请重试保存，不要再次执行剪辑。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: { kind: 'video_edit.document', id }, replayMutation: false } }, error) } },
        release() {
          const changed = JSON.stringify({ ...initial, revision: 0 }) !== JSON.stringify({ ...instance.document, revision: 0 })
          instance.past = changed ? [...past.slice(-49), initial] : past
          instance.future = changed ? [] : future
        },
      }
      } }
      persistenceOwners.set(owner, participant)
      return participant
    })
  },
}
