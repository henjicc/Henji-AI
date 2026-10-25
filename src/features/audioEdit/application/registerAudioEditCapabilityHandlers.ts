import { insertAudioEditFile } from './audioEditSpliceService'
import { repairAudioEditRegion } from './audioEditRegions'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { applicationPaidRequest, transcriptionEstimatedCny } from '@/services/paidApproval'
import { preflightAudioEditTranscription } from './audioEditApplicationService'
import { AUDIO_EDIT_APPLICATION_CAPABILITIES, AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS, audioEditInputSchema } from '@/core/application-control/domains/audioEdit/audioEditApplicationCapabilities'
import { audioEditContentKey } from '@/core/audioEdit/baseline'
import { audioEditProjectFromDocument } from '@/core/audioEdit/documentContent'
import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { resolveConfiguredDestination } from '@/features/canvas/application/canvasDownloadService'
import { getPlatform } from '@/platform/runtime'
import { applicationWritePreflight, ApplicationWriteExecution } from '@/core/application-control/execution/writeExecution'
import { readTranscriptionFacts, TranscriptionFailure } from '@/core/audioEdit/transcriptionFailure'
import { join, exists } from '@/platform/desktopApi'
import { getDocumentOperations, registerDocumentCreator, registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { getDocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { registerDocumentCoverProvider, registerDocumentHoverPreview } from '@/features/documents/documentCovers'
import { audioEditContentSchema } from '@/core/documents/kinds/audioEdit'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { loadAudioEditProject, flushAudioEditProject, releaseAudioEditProject, assignAudioEditSource } from './audioEditProjectInstances'
import { importAudioEditMedia, openAudioEditDocument, pickAudioEditMedia } from './audioEditDocumentService'
import { compressAudioEditSilence, cleanProjectAudioEditFillers, cleanProjectAudioEditRetakes, processProjectAudioEditBreaths, transcribeAudioEdit, exportAudioEdit, prepareAudioEditProcessing, quickProcessAudioEdit, undoAllAudioEditChanges, formatProjectAudioEditCaptions } from './audioEditApplicationService'

/** 剪后时长的变化：重新处理呼吸声时比上次删得少，时长会变长。 */
const lengthChange = (shortenedMs: number): string => shortenedMs > 0 ? `缩短 ${(shortenedMs / 1000).toFixed(1)} 秒` : shortenedMs < 0 ? `比处理前加长 ${(-shortenedMs / 1000).toFixed(1)} 秒` : '时长不变'

export function registerAudioEditCapabilityHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  // 口播文档的通用打开与后台释放（3.3）：列表、新建、改名、移动、副本、回收站走通用文档能力
  // （list_documents / open_document 等），这里只登记“打开到哪里”和“后台持有的实例怎么释放”。
  registerDocumentOpener('audio_edit', async (document) => {
    if (await openAudioEditDocument({ id: document.id, path: document.path })) openApplicationSurface('tool.audio_edit')
  })
  registerDocumentReleaser('audio_edit', releaseAudioEditProject)
  // 列表封面：从视频导入的口播取原视频约 1/3 处的一帧；纯音频没有画面，保持口播图标
  // 卡片悬停预览：从视频导入的口播按位置看原视频画面
  registerDocumentHoverPreview('audio_edit', (read, fraction) => {
    const source = audioEditContentSchema.safeParse(read.content).data?.source
    if (!source || source.mediaType !== 'video') return null
    return { source: source.sourcePath, sourceKind: 'video', atSeconds: Math.round(fraction * source.durationFrames / Math.max(1, source.sampleRate) * 1000) / 1000 }
  })
  registerDocumentCoverProvider('audio_edit', (read) => {
    const source = audioEditContentSchema.safeParse(read.content).data?.source
    if (!source || source.mediaType !== 'video') return null
    const seconds = source.durationFrames / Math.max(1, source.sampleRate)
    return [{ source: source.sourcePath, sourceKind: 'video', atSeconds: Math.round(seconds / 3 * 1000) / 1000 }]
  })
  // 在剪辑里新建口播（4.1）：先请用户选音频或视频，导入即建草稿（放在所在项目里）；取消选择时不新建
  registerDocumentCreator('audio_edit', async (container) => {
    const sourcePath = await pickAudioEditMedia()
    if (!sourcePath) return null
    const id = await importAudioEditMedia(sourcePath, container)
    openApplicationSurface('tool.audio_edit')
    return getDocumentSessionRegistry().get(id)?.documentMeta ?? (await getDocumentOperations().readDocument({ id })).meta
  })
  for (const definition of AUDIO_EDIT_APPLICATION_CAPABILITIES) registrar.registerHandler(definition.id, async (raw, context) => {
    const input = audioEditInputSchema(definition.id).parse(raw)
    context.signal.throwIfAborted()
    const id = input.documentRef.id
    if (definition.id === 'import_audio_edit_source') {
      // 还没有素材的口播打不开编辑实例，导入走与界面“导入音频或视频”相同的指定素材服务
      const source = await applicationWritePreflight(context, async () => {
        const read = await getDocumentOperations().readDocument({ id })
        if (read.meta.kind !== 'audio_edit') throw new Error('请提供口播文档（list_documents 中 kind=audio_edit 的 id）。')
        if (audioEditContentSchema.safeParse(read.content).data?.source) throw new Error('这份口播已经有素材。换素材请用重新定位原素材，或用 create_document 新建一份口播再导入。')
        return getPlatform().audioEdit.probeSource(input.sourcePath!)
      })
      await assignAudioEditSource(id, source)
      context.execution?.report({ targetMutation: 'applied' })
      const persisted = audioEditContentSchema.safeParse((await getDocumentOperations().readDocument({ id })).content).data?.source
      return { resultRef: { kind: 'audio_edit.document', id }, durationFrames: source.durationFrames, verified: persisted?.sourcePath === source.sourcePath,
        message: `已导入${source.mediaType === 'video' ? '视频' : '音频'}素材（${(source.durationFrames / source.sampleRate).toFixed(1)} 秒）并保存，可以转写。` }
    }
    const instance = await applicationWritePreflight(context, () => loadAudioEditProject(id))
    const requestId = context.requestId ?? crypto.randomUUID()
    const api = getPlatform().audioEdit
    const cancel = () => {
      void api.cancelTask(requestId)
      if (definition.id === 'transcribe_audio_edit') void api.listTasks(id).then((tasks) => Promise.all(tasks.filter((task) => task.kind === 'transcription' && task.state === 'running').map((task) => api.cancelTask(task.requestId))))
    }
    context.signal.addEventListener('abort', cancel, { once: true })
    let recognized = false
    const execute = async () => {
    try {
      const result: Record<string, unknown> = { resultRef: { kind: 'audio_edit.document', id }, message: '' }
      switch (definition.id) {
        case 'insert_audio_edit_file': {
          if (!input.sourcePath || input.positionSeconds === undefined) throw new Error('请提供音频文件和插入秒数')
          const rate = instance.document.source.sampleRate
          await insertAudioEditFile(id, input.sourcePath, Math.round(input.positionSeconds * rate), Math.round((input.replaceUntilSeconds ?? input.positionSeconds) * rate), requestId)
          result.durationFrames = instance.document.source.durationFrames; result.message = '音频已拼接并保存，可一步撤销。'; break
        }
        case 'repair_audio_edit_region': {
          if (!input.repair) throw new Error('请提供 repair 修复范围')
          const rendered = await repairAudioEditRegion(id, input.repair, requestId)
          result.durationFrames = rendered.durationFrames; result.message = '修复已渲染并保存，可在音频编辑中撤销。'; break
        }
        case 'reset_audio_edit': await undoAllAudioEditChanges(id); result.message = instance.document.editBaseline?.kind === 'original' ? '已恢复初始剪辑与识别原文，可撤销本次恢复。' : '已恢复全部声音、分段和处理设置。旧口播没有保存最初识别原文，保留已有文字，可撤销本次恢复。'; break
        case 'format_audio_edit_subtitles': result.count = await formatProjectAudioEditCaptions(id); result.message = `已整理 ${result.count} 段字幕，文字区、波形区与 SRT 共用分段。`; break
        case 'quick_process_audio_edit': {
          const { retakeCount, breaths, ...processed } = await quickProcessAudioEdit(id, input.range, requestId)
          Object.assign(result, processed)
          const breathText = breaths ? `处理呼吸声（删除 ${breaths.deleted}、减弱 ${breaths.attenuated} 处）、` : ''
          result.message = `已${retakeCount ? `去掉 ${retakeCount} 处重念、` : ''}${breathText}压缩停顿并清理所选语气词，${lengthChange(processed.shortenedMs)}，可整批撤销。这只是起点：请逐处复核接缝、呼吸与语气词。`; break
        }
        case 'compress_audio_edit_silence': { const { count, shortenedMs } = await compressAudioEditSilence(id, input.range, requestId); Object.assign(result, { count, shortenedMs }) } result.message = `处理 ${result.count} 处停顿，缩短 ${result.shortenedMs} 毫秒。`; break
        case 'clean_audio_edit_fillers': result.count = await cleanProjectAudioEditFillers(id, input.range); result.message = `清理 ${result.count} 处语气词。`; break
        case 'clean_audio_edit_retakes': {
          const cleaned = await cleanProjectAudioEditRetakes(id, input.range, requestId)
          Object.assign(result, cleaned)
          result.message = cleaned.count ? `去掉 ${cleaned.count} 处重念，缩短 ${(cleaned.shortenedMs / 1000).toFixed(1)} 秒，每处只保留最后一遍；可在剪辑线索与文字里逐处恢复。` : '没有发现重念。'
          break
        }
        case 'process_audio_edit_breaths': {
          const { counts, shortenedMs } = await processProjectAudioEditBreaths(id, input.policy ?? 'delete', input.range, requestId)
          Object.assign(result, { count: counts.deleted + counts.attenuated + counts.muted, shortenedMs })
          result.message = `呼吸声：删除 ${counts.deleted} 处、减弱 ${counts.attenuated} 处、静音 ${counts.muted} 处、保留 ${counts.kept} 处，${lengthChange(shortenedMs)}；可在 audio_edit.breath 逐处查看与修改。`
          break
        }
        case 'transcribe_audio_edit': {
          const prepared = await applicationWritePreflight(context, () => preflightAudioEditTranscription(id, input.modelId))
          if (prepared.requiresConfirmation) await requestAlertConfirmation({ title: '识别口播', message: '将使用已配置的语音识别模型转写这段声音。', confirmLabel: '允许本次', paid: await applicationPaidRequest('recognition', id, context.signal, transcriptionEstimatedCny(prepared)) }, context.signal)
          await transcribeAudioEdit({ projectId: id, modelId: prepared.modelId ?? input.modelId, requestId }, context.signal); recognized = true; result.message = '转写已保存，按实际时间戳粒度剪辑。'; break
        }
        case 'process_audio_edit_sound': await prepareAudioEditProcessing(id, requestId); result.verified = (await api.listTasks(id)).some(task => task.requestId === requestId && task.state === 'completed'); result.message = '全长声音处理已完成。'; break
        case 'query_audio_edit_tasks': result.tasks = (await api.listTasks(id)).map(({ projectId, ...task }) => ({ ...task, documentId: projectId })); result.message = '已读取这份口播的处理任务。'; break
        case 'cancel_audio_edit_task': {
          const taskId = await applicationWritePreflight(context, async () => {
            if (!input.taskId || !(await api.listTasks(id)).some((task) => task.requestId === input.taskId)) throw new Error('请使用这份口播查询返回的任务引用。')
            return input.taskId
          })
          await api.cancelTask(taskId); result.verified = (await api.listTasks(id)).some(task => task.requestId === taskId); result.message = '已请求取消任务，请查询最终状态。'; break
        }
        case 'retry_audio_edit_save': await flushAudioEditProject(id); result.message = '口播已保存，未重复执行剪辑。'; break
        case 'export_audio_edit': {
          const format = input.format ?? 'xml'
          const fileName = `${instance.document.name.replace(/[<>:"/\\|?*]/g, '_')}-${crypto.randomUUID()}`
          const targetPath = await applicationWritePreflight(context, () => {
            if (!input.destination) throw new Error('请选择已配置的快速下载或预设目录。')
            return join(resolveConfiguredDestination(input.destination), `${fileName}.${format}`)
          })
          const exported = await exportAudioEdit({ projectId: id, targetPath, format, includeProcessing: input.includeProcessing ?? false, requestId, ...(input.includeSrt ? { subtitleTargetPath: targetPath.replace(/\.[^.]+$/, '.srt') } : {}) })
          result.verified = (await Promise.all([exported.xmlPath ?? exported.audioPath, exported.subtitlePath].filter((path): path is string => Boolean(path)).map(exists))).every(Boolean)
          result.durationFrames = exported.durationFrames; result.message = `已导出 ${format.toUpperCase()} 到所选目录。`; break
        }
      }
      if (AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS.has(definition.id) || ['transcribe_audio_edit', 'retry_audio_edit_save'].includes(definition.id)) {
        context.execution?.report({ targetMutation: 'applied', ...(recognized ? { billing: 'completed' as const, audioDocumentId: id } : {}) })
        // 从文档文件回读核对（3.3：口播是 .hjaud 文档）
        const read = await getDocumentOperations().readDocument({ id })
        const persisted = audioEditProjectFromDocument(read.meta, read.content).project
        if (instance.dirty || persisted.source.sourcePath !== instance.document.source.sourcePath || persisted.source.durationFrames !== instance.document.source.durationFrames || audioEditContentKey(persisted) !== audioEditContentKey(instance.document)) throw new Error('修改已提交，但回读时发现口播有新变化。请重新读取口播，不要重复提交原修改。')
        result.verified = true
      }
      return result
    } catch (error) {
      if (definition.id === 'transcribe_audio_edit' && !readTranscriptionFacts(error)) throw new TranscriptionFailure(error, { billing: recognized ? 'completed' : 'not_charged', targetMutation: recognized ? 'applied' : 'none', audioDocumentId: id })
      throw error
    } finally { context.signal.removeEventListener('abort', cancel) }
    }
    return AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS.has(definition.id)
      ? (context.execution ?? new ApplicationWriteExecution()).atomic(() => instance.document, execute)
      : execute()
  })
}
