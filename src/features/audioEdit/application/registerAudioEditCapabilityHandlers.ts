import { AUDIO_EDIT_APPLICATION_CAPABILITIES, AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS, audioEditOperationInput } from '@/core/application-control/domains/audioEdit/audioEditApplicationCapabilities'
import { audioEditContentKey } from '@/core/audioEdit/baseline'
import { audioEditProjectFromDocument } from '@/core/audioEdit/documentContent'
import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { resolveConfiguredDestination } from '@/features/canvas/application/canvasDownloadService'
import { getPlatform } from '@/platform/runtime'
import { join } from '@/platform/desktopApi'
import { getDocumentOperations, registerDocumentCreator, registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { getDocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { loadAudioEditProject, flushAudioEditProject, releaseAudioEditProject } from './audioEditProjectInstances'
import { importAudioEditMedia, openAudioEditDocument, pickAudioEditMedia } from './audioEditDocumentService'
import { compressAudioEditSilence, cleanProjectAudioEditFillers, transcribeAudioEdit, exportAudioEdit, prepareAudioEditProcessing, quickProcessAudioEdit, undoAllAudioEditChanges, formatProjectAudioEditCaptions } from './audioEditApplicationService'

export function registerAudioEditCapabilityHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
  // 口播文档的通用打开与后台释放（3.3）：列表、新建、改名、移动、副本、回收站走通用文档能力
  // （list_documents / open_document 等），这里只登记“打开到哪里”和“后台持有的实例怎么释放”。
  registerDocumentOpener('audio_edit', async (document) => {
    if (await openAudioEditDocument({ id: document.id, path: document.path })) openApplicationSurface('tool.audio_edit')
  })
  registerDocumentReleaser('audio_edit', releaseAudioEditProject)
  // 在剪辑里新建口播（4.1）：先请用户选音频或视频，导入即建草稿（放在所在项目里）；取消选择时不新建
  registerDocumentCreator('audio_edit', async (container) => {
    const sourcePath = await pickAudioEditMedia()
    if (!sourcePath) return null
    const id = await importAudioEditMedia(sourcePath, container)
    openApplicationSurface('tool.audio_edit')
    return getDocumentSessionRegistry().get(id)?.documentMeta ?? (await getDocumentOperations().readDocument({ id })).meta
  })
  for (const definition of AUDIO_EDIT_APPLICATION_CAPABILITIES) registrar.registerHandler(definition.id, async (raw, context) => {
    const input = audioEditOperationInput.parse(raw)
    context.signal.throwIfAborted()
    const id = input.projectRef.id
    const instance = await loadAudioEditProject(id)
    const requestId = context.requestId ?? crypto.randomUUID()
    const api = getPlatform().audioEdit
    const cancel = () => {
      void api.cancelTask(requestId)
      if (definition.id === 'transcribe_audio_edit') void api.listTasks(id).then((tasks) => Promise.all(tasks.filter((task) => task.kind === 'transcription' && task.state === 'running').map((task) => api.cancelTask(task.requestId))))
    }
    context.signal.addEventListener('abort', cancel, { once: true })
    try {
      const result: Record<string, unknown> = { resultRef: { kind: 'audio_edit.project', id }, message: '' }
      switch (definition.id) {
        case 'reset_audio_edit': await undoAllAudioEditChanges(id); result.message = instance.document.editBaseline?.kind === 'original' ? '已恢复初始剪辑与识别原文，可撤销本次恢复。' : '已恢复全部声音、分段和处理设置。旧工程没有保存最初识别原文，保留已有文字，可撤销本次恢复。'; break
        case 'format_audio_edit_subtitles': result.count = await formatProjectAudioEditCaptions(id); result.message = `已整理 ${result.count} 段字幕，文字区、波形区与 SRT 共用分段。`; break
        case 'quick_process_audio_edit': Object.assign(result, await quickProcessAudioEdit(id, input.range, requestId)); result.message = `已压缩停顿并清理所选语气词，缩短 ${result.shortenedMs} 毫秒，可整批撤销。`; break
        case 'compress_audio_edit_silence': Object.assign(result, await compressAudioEditSilence(id, input.range, requestId)); result.message = `处理 ${result.count} 处停顿，缩短 ${result.shortenedMs} 毫秒。`; break
        case 'clean_audio_edit_fillers': result.count = await cleanProjectAudioEditFillers(id, input.range); result.message = `清理 ${result.count} 处语气词。`; break
        case 'transcribe_audio_edit': await transcribeAudioEdit({ projectId: id, modelId: input.modelId, requestId }); result.message = '转写已保存，按实际时间戳粒度剪辑。'; break
        case 'process_audio_edit_sound': await prepareAudioEditProcessing(id, requestId); result.message = '全长声音处理已完成。'; break
        case 'query_audio_edit_tasks': result.tasks = await api.listTasks(id); result.message = '已读取该工程处理任务。'; break
        case 'cancel_audio_edit_task': {
          if (!input.taskId || !(await api.listTasks(id)).some((task) => task.requestId === input.taskId)) throw new Error('请使用该工程查询返回的任务引用。')
          await api.cancelTask(input.taskId); result.message = '已请求取消任务，请查询最终状态。'; break
        }
        case 'retry_audio_edit_save': await flushAudioEditProject(id); result.message = '工程已保存，未重复执行剪辑。'; break
        case 'export_audio_edit': {
          if (!input.destination) throw new Error('请选择已配置的快速下载或预设目录。')
          const format = input.format ?? 'xml'
          const fileName = `${instance.document.name.replace(/[<>:"/\\|?*]/g, '_')}-${crypto.randomUUID()}`
          const targetPath = await join(resolveConfiguredDestination(input.destination), `${fileName}.${format}`)
          const exported = await exportAudioEdit({ projectId: id, targetPath, format, includeProcessing: input.includeProcessing ?? false, requestId, ...(input.includeSrt ? { subtitleTargetPath: targetPath.replace(/\.[^.]+$/, '.srt') } : {}) })
          result.durationFrames = exported.durationFrames; result.message = `已导出 ${format.toUpperCase()} 到所选目录。`; break
        }
      }
      if (AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS.has(definition.id)) {
        // 从文档文件回读核对（3.3：口播是 .henji-audio 文档）
        const read = await getDocumentOperations().readDocument({ id })
        const persisted = audioEditProjectFromDocument(read.meta, read.content).project
        if (instance.dirty || audioEditContentKey(persisted) !== audioEditContentKey(instance.document)) throw new Error('修改已提交，但回读时发现口播有新变化。请重新读取口播，不要重复提交原修改。')
        result.verified = true
      }
      return result
    } finally { context.signal.removeEventListener('abort', cancel) }
  })
}
