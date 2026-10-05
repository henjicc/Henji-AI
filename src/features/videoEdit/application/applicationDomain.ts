import type { ApplicationDomainModule } from '@/features/application-control/domainModule'
import { ApplicationPersistenceFailure, type ApplicationPersistenceParticipant } from '@/core/application-control/execution/persistence'
import { createVideoEditRegistrations } from './videoEditReflection'
import { VideoEditCollectionExecutor, VideoEditMutationExecutor } from './videoEditExecutors'
import { VIDEO_EDIT_COMPOSITE_TYPES } from './videoEditCompositeEntities'
import { openVideoEditDocument, releaseVideoEditDocument, requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved, type VideoEditInstance } from './videoEditService'
import { registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { undoVideoEdit } from './videoEditService'
import { executeVideoEditTimelineEdit } from './videoEditTimeline'
import { videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import { splitVideoEditRef } from './videoEditReflection'
import { VIDEO_EDIT_APPLICATION_CAPABILITIES, collectVideoEditOutputCapability, collectVideoEditCodeAssetCapability, placeVideoEditCreativeResultCapability, observeVideoEditFrameCapability } from '@/core/application-control/domains/videoEdit/videoEditApplicationCapabilities'
import { exportVideoEdit, cancelVideoEditExport, videoEditExportTask } from './videoEditExport'
import { VideoEditSourceExecutor } from './videoEditSourceExecutor'
import { importVideoEditSources } from './videoEditMedia'
import { exportVideoEditSubtitles } from './videoEditTimedContent'
import { collectVideoEditOutput } from './videoEditOutputs'
import { captureVideoEditProgramFrame } from './videoEditProgramCapture'
import { collectVideoEditCodeAsset, importVideoEditCodeAsset, type VideoEditCodeAssetTarget } from './videoEditCodeAssets'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import { placeVideoEditCreativeResultFromCapability } from './videoEditResultCapability'
import { observeVideoEditFrame } from './videoEditFrameObservation'

const persistenceOwners = new WeakMap<VideoEditInstance, ApplicationPersistenceParticipant>()

export const videoEditApplicationDomain: ApplicationDomainModule = {
  id: 'videoEdit', entities: createVideoEditRegistrations,
  registerExecutors(engine) {
    for (const entityType of ['video_edit.project', 'video_edit.sequence', 'video_edit.bin', 'video_edit.item', 'video_edit.track', 'video_edit.clip', 'video_edit.annotation', 'video_edit.code_material', 'video_edit.marker', 'video_edit.caption', ...VIDEO_EDIT_COMPOSITE_TYPES] as const) engine.registerMutationExecutor(new VideoEditMutationExecutor(entityType))
    engine.registerMutationExecutor(new VideoEditSourceExecutor())
    for (const entityType of ['video_edit.sequence', 'video_edit.bin', 'video_edit.item', 'video_edit.clip', 'video_edit.annotation', 'video_edit.code_material', 'video_edit.code_version', 'video_edit.marker', 'video_edit.caption', ...VIDEO_EDIT_COMPOSITE_TYPES] as const) engine.registerCollectionExecutor(new VideoEditCollectionExecutor(entityType))
  },
  registerCapabilities(registrar) {
    // 剪辑文档的通用打开与后台释放（3.1）：项目与文档的列出、新建、移动、删除走通用文档能力，
    // 这里只登记“打开到哪里”（剪辑工作区）和“后台持有的实例怎么释放”。
    registerDocumentOpener('video_edit', async (document) => {
      await openVideoEditDocument({ id: document.id, path: document.path })
      openApplicationSurface('workspace.video_edit')
    })
    registerDocumentReleaser('video_edit', releaseVideoEditDocument)
    for (const definition of VIDEO_EDIT_APPLICATION_CAPABILITIES) registrar.registerHandler(definition.id, async (raw, context) => {
      if (definition.id === observeVideoEditFrameCapability.id) {
        const input = observeVideoEditFrameCapability.inputSchema.parse(raw); const id = input.projectRef.id
        const child = (ref: { kind: string; id: string }): string => { const value = splitVideoEditRef(ref); if (value.projectId !== id || !value.childId) throw new Error(`${ref.kind} 必须属于目标剪辑工程。`); return value.childId }
        const observed = await observeVideoEditFrame(id, input.target.kind === 'program' ? { kind: 'program', frame: input.target.frame, ...(input.target.sequenceRef ? { sequenceId: child(input.target.sequenceRef) } : {}) } : { kind: 'source', itemId: child(input.target.itemRef), timeUs: input.target.timeUs }, input.maxWidth, context.signal)
        const resultRef = { kind: 'asset' as const, id: observed.asset.id }
        return { resultRef, projectRef: input.projectRef, target: input.target, width: observed.width, height: observed.height, sourceWidth: observed.sourceWidth, sourceHeight: observed.sourceHeight, documentRevision: observed.documentRevision,
          message: `已按工程版本 ${observed.documentRevision} 渲染${input.target.kind === 'program' ? `序列帧 ${input.target.frame}` : '源素材画面'}（${observed.width}×${observed.height}），用 read_application_media 读取该资产查看画面。`,
          verification: { verified: true, target: resultRef, condition: '已用正式渲染器生成固定版本画面，并通过资产检查核对尺寸。' } }
      }
      if (definition.id === placeVideoEditCreativeResultCapability.id) return await placeVideoEditCreativeResultFromCapability(placeVideoEditCreativeResultCapability.inputSchema.parse(raw), context.signal)
      if (definition.id === collectVideoEditCodeAssetCapability.id) {
        const input = collectVideoEditCodeAssetCapability.inputSchema.parse(raw)
        const ref = splitVideoEditRef(input.targetRef)
        if (ref.projectId !== input.projectRef.id) throw new Error('代码素材目标必须属于明确的原工程。')
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
        return { resultRef, projectRef: input.projectRef, message: '可编辑代码素材已加入资产库，可在另一剪辑工程引用并重新调参。', verification: { verified: true, target: resultRef, condition: '正式资产检查已核对代码清单的固定路径、结构与内容身份。' } }
      }
      if (definition.id === collectVideoEditOutputCapability.id) {
        const input = collectVideoEditOutputCapability.inputSchema.parse(raw)
        const task = input.kind === 'export' ? videoEditExportTask(input.projectRef.id) : undefined
        if (input.kind === 'export' && (!task || task.id !== input.taskId || task.state !== 'completed' || !task.output)) throw new Error('请提供原工程已完成且可收录的导出taskId；先查询导出状态。')
        const receipt = input.kind === 'export' ? task!.output! : await captureVideoEditProgramFrame(input.projectRef.id, input.frame, undefined, context.signal)
        if (!receipt) throw new Error('用户取消选帧，没有保存文件或收录素材。')
        const asset = await collectVideoEditOutput(receipt, input.libraryRef ? { libraryId: input.libraryRef.id } : {}, context.signal)
        const resultRef = { kind: 'asset' as const, id: asset.id }
        return { resultRef, projectRef: input.projectRef, message: '输出已加入资产库，可通过此素材引用加入画布。', verification: { verified: true, target: resultRef, condition: '正式资产检查已核对已发布输出的固定原路径与内容身份。' } }
      }
      const input = definition.inputSchema.parse(raw) as { projectRef: { kind: 'video_edit.project'; id: string }; clipRef?: { id: string }; frame?: number; assetRef?: { id: string }; format?: 'mp4' | 'srt' | 'vtt' }
      const id = input.projectRef.id; const owner = requireVideoEditInstance(id)
      if (definition.id === 'export_video_edit' && input.format && input.format !== 'mp4') {
        const result = await exportVideoEditSubtitles(id, input.format)
        if (requireVideoEditInstance(id) !== owner) throw new Error('原工程已关闭，操作回执不会写入重新打开的工程。')
        return { resultRef: input.projectRef, verification: { verified: result.verified, target: input.projectRef, condition: result.verified ? '已从所选字幕文件回读并核对序列快照。' : '用户取消文件选择，未写出字幕。' }, message: result.saved ? '字幕已导出并核实。' : '已取消字幕导出。' }
      }
      switch (definition.id) {
        case 'undo_video_edit': undoVideoEdit(id); await saveVideoEdit(id); break
        case 'redo_video_edit': undoVideoEdit(id, true); await saveVideoEdit(id); break
        case 'save_video_edit': await saveVideoEdit(id); break
        case 'split_video_edit': {
          if (!input.clipRef?.id.startsWith(`${id}:`) || input.frame === undefined) throw new Error('拆分需要本工程 clipRef 与整数 frame。')
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
          if (requireVideoEditInstance(id) !== owner || owner.document !== importBaseline) throw new Error('原工程已关闭或导入期间已有修改，请重新引用素材。')
          if (asset.mediaType === 'code') {
            let filterTarget: { sequenceId: string; clipId: string } | undefined
            if (input.clipRef) {
              const ref = splitVideoEditRef({ kind: 'video_edit.clip', id: input.clipRef.id })
              const sequence = owner.document.sequences.find(sequence => sequence.clips.some(clip => clip.id === ref.childId))
              if (ref.projectId !== id || !sequence) throw new Error('代码效果目标必须属于原工程。')
              filterTarget = { sequenceId: sequence.id, clipId: ref.childId }
            }
            await importVideoEditCodeAsset(id, asset.id, { filterTarget }, context.signal)
          } else await importVideoEditSources(id, [{ assetId: asset.id }], undefined, context.signal)
          await saveVideoEdit(id); break
        }
        case 'export_video_edit': await exportVideoEdit(id, undefined, true, context.signal); break
        case 'cancel_video_edit_export': cancelVideoEditExport(id); break
      }
      if (requireVideoEditInstance(id) !== owner) throw new Error('原工程已关闭，操作回执不会写入重新打开的工程。')
      const task = videoEditExportTask(id)
      const instance = requireVideoEditInstance(id)
      const verified = definition.id.includes('export') ? Boolean(task) : await verifyVideoEditSaved(id, instance.document)
      return { resultRef: input.projectRef, verification: { verified, target: input.projectRef, condition: definition.id.includes('export') ? '已回读原工程的导出任务状态；请求提交不等于视频导出完成。' : '已从剪辑文件回读并核对编辑内容。' }, message: definition.id.includes('export') ? task ? `导出状态：${task.state}。请查询导出状态确认完成。` : '尚无导出任务或已取消文件选择。' : '操作已完成，请回读工程核对结果。', ...(task ? { task: { id: task.id, state: task.state, progress: task.progress, revision: task.revision, startFrame: task.startFrame, endFrame: task.endFrame } } : {}) }
    })
  },
  resolvePersistenceParticipants(steps) {
    const ids = new Set(steps.flatMap(step => step.kind === 'mutation' && step.target.kind.startsWith('video_edit.') && step.target.kind !== 'video_edit.source' ? [splitVideoEditRef(step.target).projectId] : step.kind === 'collection' && step.parent.kind.startsWith('video_edit.') ? [splitVideoEditRef(step.parent).projectId] : []))
    return [...ids].map(id => {
      const owner = requireVideoEditInstance(id)
      const existing = persistenceOwners.get(owner)
      if (existing) return existing
      const participant: ApplicationPersistenceParticipant = { key: `video_edit:${id}`, begin() {
      const instance = requireVideoEditInstance(id)
      const initial = instance.document; const past = instance.past.slice(); const future = instance.future.slice()
      return {
        async confirm() { try { await saveVideoEdit(id) } catch (error) { throw new ApplicationPersistenceFailure('修改已保留但未保存。请重试保存，不要再次执行剪辑。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: { kind: 'video_edit.project', id }, replayMutation: false } }, error) } },
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
