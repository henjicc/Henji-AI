import { AUDIO_EDIT_APPLICATION_CAPABILITIES, audioEditOperationInput } from '@/core/application-control/domains/audioEdit/audioEditApplicationCapabilities'
import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { resolveConfiguredDestination } from '@/features/canvas/application/canvasDownloadService'
import { getPlatform } from '@/platform/runtime'
import { join } from '@/platform/desktopApi'
import { loadAudioEditProject, flushAudioEditProject } from './audioEditProjectInstances'
import { compressAudioEditSilence, cleanProjectAudioEditFillers, transcribeAudioEdit, exportAudioEdit, prepareAudioEditProcessing, quickProcessAudioEdit } from './audioEditApplicationService'

export function registerAudioEditCapabilityHandlers(registrar: ApplicationCapabilityHandlerRegistrar): void {
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
      return result
    } finally { context.signal.removeEventListener('abort', cancel) }
  })
}
