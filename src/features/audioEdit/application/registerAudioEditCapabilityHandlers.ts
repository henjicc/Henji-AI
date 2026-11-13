import { insertAudioEditFile } from './audioEditSpliceService'
import { repairAudioEditRegion } from './audioEditRegions'
import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { applicationPaidRequest, transcriptionEstimatedCny } from '@/services/paidApproval'
import { preflightAudioEditTranscription } from './audioEditApplicationService'
import { AUDIO_EDIT_APPLICATION_CAPABILITIES, AUDIO_EDIT_UNDOABLE_OPERATIONS, AUDIO_EDIT_VERIFIED_EDIT_OPERATIONS, audioEditInputSchema } from '@/core/application-control/domains/audioEdit/audioEditApplicationCapabilities'
import { recordAudioEditStep, redoAudioEditStep, undoAudioEditStep } from './audioEditStepUndo'
import { audioEditOutputSeconds, audioEditPlacementFrames, audioEditUntranscribedBlocks } from '@/core/audioEdit/splice'
import { audioEditContentKey } from '@/core/audioEdit/baseline'
import { audioEditProjectFromDocument } from '@/core/audioEdit/documentContent'
import type { ApplicationCapabilityHandlerRegistrar } from '@/features/application-control/capabilities/handlerTypes'
import { resolveConfiguredDestination } from '@/features/canvas/application/canvasDownloadService'
import { getPlatform } from '@/platform/runtime'
import { applicationWritePreflight, ApplicationWriteExecution } from '@/core/application-control/execution/writeExecution'
import { readTranscriptionFacts, TranscriptionFailure } from '@/core/audioEdit/transcriptionFailure'
import { exists } from '@/platform/desktopApi'
import { projectExportDirectory, uniqueOutputPath } from '@/features/documents/projectOutputs'
import { getDocumentOperations, registerDocumentCreator, registerDocumentOpener, registerDocumentReleaser } from '@/features/documents/documentOperations'
import { getDocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { registerDocumentCoverProvider, registerDocumentHoverPreview } from '@/features/documents/documentCovers'
import { audioEditContentSchema } from '@/core/documents/kinds/audioEdit'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'
import { loadAudioEditProject, flushAudioEditProject, releaseAudioEditProject, assignAudioEditSource } from './audioEditProjectInstances'
import { importAudioEditMedia, openAudioEditDocument, pickAudioEditMedia } from './audioEditDocumentService'
import { compressAudioEditSilence, cleanProjectAudioEditFillers, cleanProjectAudioEditRetakes, detectProjectAudioEditMouthClicks, matchProjectAudioEditLoudness, processProjectAudioEditBreaths, transcribeAudioEdit, exportAudioEdit, prepareAudioEditProcessing, quickProcessAudioEdit, undoAllAudioEditChanges, formatProjectAudioEditCaptions } from './audioEditApplicationService'

/** 拿不准、没有自动删的重念：留在剪辑线索里，交给助手逐处试听后决定。 */
const retakeReviewText = (count: number): string => count
  ? `另有 ${count} 处像是换了说法的重念，没有参考稿佐证，没有自动删：用 list_application_entities 读 audio_edit.suggestion（where kind=retake、current_state=available，propertyIds 带 confidence、removed_text、kept_text、before_text、after_text、block_ids）逐处判断：确认是念坏重来就把线索 status 写成 applied（同时删掉 block_ids 的词并补上接缝处的停顿剪切），不是就写 dismissed；只想删其中一部分时才逐个改词块 included（这条线索随之不再可用）。`
  : ''

/** 剪后时长的变化：重新处理呼吸声时比上次删得少，时长会变长。 */
const lengthChange = (shortenedMs: number): string => {
  const seconds = (Math.abs(shortenedMs) / 1000).toFixed(1)
  return seconds === '0.0' ? '时长不变' : shortenedMs > 0 ? `缩短 ${seconds} 秒` : `比处理前加长 ${seconds} 秒`
}

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
      if (definition.id === 'transcribe_audio_edit') void api.listTasks(id).then((tasks) => Promise.all(tasks.filter((task) => task.kind.startsWith('transcription') && task.state === 'running').map((task) => api.cancelTask(task.requestId))))
    }
    context.signal.addEventListener('abort', cancel, { once: true })
    let recognized = false
    const execute = async () => {
    const start = instance.document
    try {
      const result: Record<string, unknown> = { resultRef: { kind: 'audio_edit.document', id }, message: '' }
      switch (definition.id) {
        case 'insert_audio_edit_file': {
          const sourcePath = input.sourcePath
          const [startFrame, endFrame] = await applicationWritePreflight(context, async () => {
            if (!sourcePath || (input.positionSeconds === undefined && input.positionSourceFrame === undefined)) throw new Error('请提供音频文件，以及插入位置 positionSeconds（剪后作品时间）或 positionSourceFrame（原素材采样帧）。')
            return audioEditPlacementFrames(instance.document, input, 0)
          })
          await insertAudioEditFile(id, sourcePath!, startFrame, endFrame, requestId)
          result.durationFrames = instance.document.source.durationFrames
          result.message = `音频已插入剪后作品的 ${audioEditOutputSeconds(instance.document, startFrame).toFixed(2)} 秒处（原素材第 ${startFrame} 帧）并保存，可一步撤销。${instance.document.transcript.length ? '插入段还没有文字：用 transcribe_audio_edit 只补识别这一段（只按这段时长计费）。' : ''}`; break
        }
        case 'repair_audio_edit_region': {
          if (!input.repair) throw new Error('请提供 repair 修复范围')
          const rendered = await repairAudioEditRegion(id, input.repair, requestId)
          result.durationFrames = rendered.durationFrames; result.message = '修复已渲染并保存，可在音频编辑中撤销。'; break
        }
        case 'reset_audio_edit': await undoAllAudioEditChanges(id); result.message = instance.document.editBaseline?.kind === 'original' ? '已恢复初始剪辑与识别原文，可撤销本次恢复。' : '已恢复全部声音、分段和处理设置。旧口播没有保存最初识别原文，保留已有文字，可撤销本次恢复。'; break
        case 'format_audio_edit_subtitles': {
          const { count, differing } = await formatProjectAudioEditCaptions(id)
          result.count = count
          result.message = differing === undefined
            ? `已整理 ${count} 段字幕，文字区、波形区与 SRT 共用分段。`
            : `已按参考稿整理 ${count} 段字幕（一行一句）。其中 ${differing} 段与稿子文字不同或稿子里没有：用 list_application_entities 读 audio_edit.caption（where script_match=different / not_in_script，带 text、script_text、spoken_text）逐段核对，改字写 text。`
          break
        }
        case 'quick_process_audio_edit': {
          const processed = await quickProcessAudioEdit(id, input.range, requestId)
          const quickProcess = {
            retakesRemoved: processed.retakeCount, breathsRemoved: processed.breaths?.deleted ?? 0, breathsAttenuated: processed.breaths?.attenuated ?? 0,
            gapsSilenced: processed.gaps ?? 0, pausesCompressed: processed.count, fillersRemoved: processed.fillers,
            retakesToDecide: processed.attention.decide, retakesToCheck: processed.attention.check,
          }
          Object.assign(result, { shortenedMs: processed.shortenedMs, quickProcess })
          const toReview = quickProcess.retakesToDecide
            ? `待确认 ${quickProcess.retakesToDecide} 处重念（audio_edit.suggestion 按 attention=decide 筛出，逐处定做法）${quickProcess.retakesToCheck ? `，另有 ${quickProcess.retakesToCheck} 处已自动删但把握不高（attention=check）值得抽看` : ''}。`
            : quickProcess.retakesToCheck ? `没有待确认的重念；${quickProcess.retakesToCheck} 处已自动删但把握不高（attention=check）值得抽看。` : '没有待确认的重念。'
          result.message = `已去掉 ${quickProcess.retakesRemoved} 处重念、删除 ${quickProcess.breathsRemoved} 处与减弱 ${quickProcess.breathsAttenuated} 处呼吸、把 ${quickProcess.gapsSilenced} 处字间气口清成静音、压缩 ${quickProcess.pausesCompressed} 处停顿、删掉 ${quickProcess.fillersRemoved} 个语气词，${lengthChange(processed.shortenedMs)}；${toReview}可用回执的 undoRef 整批撤销。这只是起点：请逐处复核接缝、呼吸与语气词。`; break
        }
        case 'compress_audio_edit_silence': { const { count, shortenedMs } = await compressAudioEditSilence(id, input.range, requestId); Object.assign(result, { count, shortenedMs }) } result.message = `处理 ${result.count} 处停顿，缩短 ${result.shortenedMs} 毫秒。`; break
        case 'clean_audio_edit_fillers': result.count = await cleanProjectAudioEditFillers(id, input.range); result.message = `清理 ${result.count} 处语气词。`; break
        case 'match_audio_edit_loudness': {
          const matched = await matchProjectAudioEditLoudness(id, input.targetLufs ?? -16, requestId)
          result.message = `处理后成品测得 ${matched.integratedLufs} LUFS，已补偿 ${matched.gainDb > 0 ? '+' : ''}${matched.gainDb} dB 到 ${input.targetLufs ?? -16} LUFS（末尾限幅 -1 dB）。`
          break
        }
        case 'detect_audio_edit_mouth_clicks': {
          const detected = await detectProjectAudioEditMouthClicks(id, { ...(input.itemId ? { itemId: input.itemId } : {}), ...(input.sensitivity !== undefined ? { sensitivity: input.sensitivity } : {}), ...(input.range ? { range: input.range } : {}) }, requestId)
          result.count = detected.count
          result.message = detected.count ? `找到 ${detected.count} 处口水音（约每分钟 ${detected.perMinute} 处），已写进效果控件的“去除口水音”（${detected.itemId}）并打开；可在 audio_edit.document.effect_chain 里查看那一项、删去不需要修的。` : '没有找到口水音。'
          break
        }
        case 'clean_audio_edit_retakes': {
          const { reviewCount, ...cleaned } = await cleanProjectAudioEditRetakes(id, input.range, requestId)
          Object.assign(result, cleaned)
          result.message = `${cleaned.count ? `去掉 ${cleaned.count} 处重念，缩短 ${(cleaned.shortenedMs / 1000).toFixed(1)} 秒，每处只保留最后一遍；可在剪辑线索与文字里逐处恢复。` : '没有发现确定的重念。'}${retakeReviewText(reviewCount)}`
          break
        }
        case 'process_audio_edit_breaths': {
          const { counts, gaps, shortenedMs } = await processProjectAudioEditBreaths(id, input.policy ?? 'delete', input.range, requestId)
          Object.assign(result, { count: counts.deleted + counts.attenuated + counts.muted, shortenedMs })
          result.message = `呼吸声：删除 ${counts.deleted} 处、减弱 ${counts.attenuated} 处、静音 ${counts.muted} 处、保留 ${counts.kept} 处${gaps ? `；字间气口清成静音 ${gaps} 处` : ''}，${lengthChange(shortenedMs)}；可在 audio_edit.breath 逐处查看与修改，气口清理是标识以 gap: 开头的静音与删除剪切。`
          break
        }
        case 'transcribe_audio_edit': {
          // 已有转写时只补识别插入后还没转写的段：只对这些段计费，结果单独一步撤销
          const filling = start.transcript.length > 0
          const pending = new Set(audioEditUntranscribedBlocks(start).map((block) => block.id))
          const prepared = await applicationWritePreflight(context, () => preflightAudioEditTranscription(id, input.modelId))
          if (prepared.requiresConfirmation) await requestAlertConfirmation({ title: filling ? '补识别插入的部分' : '识别口播', message: filling ? '将使用已配置的语音识别模型识别插入后还没转写的声音，只按这几段的时长计费。' : '将使用已配置的语音识别模型转写这段声音。', confirmLabel: '允许本次', paid: await applicationPaidRequest('recognition', id, context.signal, transcriptionEstimatedCny(prepared)) }, context.signal)
          const transcribed = await transcribeAudioEdit({ projectId: id, modelId: prepared.modelId ?? input.modelId, requestId }, context.signal); recognized = true
          // 费用与付费账本同一口径：按时长与所选模型单价算的那一笔；不需要确认的（续查原任务、取回已付费结果）这次不再计费
          const costCny = prepared.requiresConfirmation ? transcriptionEstimatedCny(prepared) : 0
          // 补识别只报换上去的词块
          const blocks = filling ? instance.document.transcript.filter((block) => pending.has(block.id.split(':')[0]) && block.id.includes(':')) : instance.document.transcript
          const transcription = { modelId: transcribed.modelId, granularity: transcribed.granularity, blockCount: blocks.length, characterCount: blocks.reduce((total, block) => total + [...block.text.replace(/[\s\p{P}]/gu, '')].length, 0), costCny }
          Object.assign(result, { transcription })
          const unit = transcribed.granularity === 'word' ? '个逐词词块' : '个整句片段'
          const cost = `费用 ${costCny === null ? '未知（模型没有单价资料）' : costCny === 0 ? '¥0（沿用已计费的结果，没有再收费）' : `约 ¥${costCny.toFixed(4)}`}`
          if (filling) {
            const undoRef = recordAudioEditStep(id, start)
            if (undoRef) result.undoRef = undoRef
          }
          result.message = filling
            ? `已补识别 ${pending.size} 段插入的声音并保存：模型 ${transcribed.modelId}，${blocks.length} ${unit}（${transcription.characterCount} 字），${cost}；占位已换成识别结果，可用回执的 undoRef 撤回补之前。`
            : `转写已保存：模型 ${transcribed.modelId}，${blocks.length} ${unit}（${transcription.characterCount} 字），${cost}。${transcribed.granularity === 'word' ? '' : '只有整句时间，不能逐词去重念。'}`; break
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
        case 'undo_audio_edit': undoAudioEditStep(id, input.undoRef!); await flushAudioEditProject(id); result.message = '已撤销这一步并保存；要恢复用 redo_audio_edit（同一 undoRef）。'; break
        case 'redo_audio_edit': redoAudioEditStep(id, input.undoRef!); await flushAudioEditProject(id); result.message = '已重做这一步并保存。'; break
        case 'export_audio_edit': {
          const format = input.format ?? 'xml'
          // 与剪辑导出一致：不指定 destination 时放进口播所在项目的“导出”文件夹，重名加序号，不覆盖已有文件
          const targetPath = await applicationWritePreflight(context, async () => uniqueOutputPath(
            input.destination ? resolveConfiguredDestination(input.destination) : await projectExportDirectory(instance.session.documentMeta.container),
            `${instance.document.name}-剪辑`, format, input.includeSrt ? ['srt'] : []))
          const exported = await exportAudioEdit({ projectId: id, targetPath, format, requestId, ...(input.includeSrt ? { subtitleTargetPath: targetPath.replace(/\.[^.]+$/, '.srt') } : {}) })
          const outputPath = exported.xmlPath ?? exported.audioPath
          result.verified = (await Promise.all([outputPath, exported.subtitlePath].filter((path): path is string => Boolean(path)).map(exists))).every(Boolean)
          Object.assign(result, { outputPath, ...(format === 'xml' ? { audioPath: exported.audioPath } : {}), ...(exported.subtitlePath ? { subtitlePath: exported.subtitlePath } : {}) })
          result.durationFrames = exported.durationFrames; result.message = `已导出 ${format.toUpperCase()}：${outputPath}${exported.subtitlePath ? `，字幕 ${exported.subtitlePath}` : ''}。`; break
        }
      }
      if (AUDIO_EDIT_UNDOABLE_OPERATIONS.has(definition.id)) {
        const undoRef = recordAudioEditStep(id, start)
        if (undoRef) result.undoRef = undoRef
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
