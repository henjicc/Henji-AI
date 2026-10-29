import { AUDIO_EDIT_MAX_CHAIN_ITEMS } from '@/core/audioEdit/effects'
import type { AudioEditExportRequest, AudioEditExportResult, AudioEditRange, AudioEditTranscriptionRequest, AudioEditProjectDocument, AudioEditSuggestion } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, cleanAudioEditFillers, DEFAULT_AUDIO_EDIT_SETTINGS } from '@/core/audioEdit/edits'
import { buildProjectAudioEditTimeline, editedDurationFrames } from '@/core/audioEdit/timeline'
import { getPlatform } from '@/platform/runtime'
import { withPaidOperation, transcriptionEstimatedCny } from '@/services/paidApproval'
import { readTranscriptionFacts, TranscriptionFailure } from '@/core/audioEdit/transcriptionFailure'
import { createLogger } from '@/core/logging'
import { formatAudioEditCaptions } from '@/core/audioEdit/captions'
import { describeAudioEditCaptions } from '@/core/audioEdit/captionReview'
import { hasAudioEditModifications } from '@/core/audioEdit/baseline'
import { audioEditRetakeSuggestion } from '@/core/audioEdit/retakes'
import { applyAudioEditBreathPolicy, type AudioEditBreathPolicy, type AudioEditQuietRange } from '@/core/audioEdit/breaths'
import { cleanAudioEditGaps, clearAudioEditGaps, type AudioEditLevels } from '@/core/audioEdit/gaps'
import type { SpeechEnergyAnalysis } from '@/core/audioEdit/speechEnergy'
import type { AudioBreath } from '@/core/audioAnalysis/breath/respiro'
import { acceptAudioEditNativeResult, editAudioEditProject, flushAudioEditProject, loadAudioEditProject, resetAudioEditProject, withAudioEditProjectOperation, type AudioEditProjectInstance } from './audioEditProjectInstances'
import { detectAudioEditRetakesOffThread } from './audioEditRetakeDetection'
import { loadAudioEditBreaths } from './audioEditBreaths'

const logger = createLogger('features.audioEdit.operations')

export async function undoAllAudioEditChanges(projectId: string, expectedVersion?: number): Promise<void> {
  const instance = await loadAudioEditProject(projectId)
  logger.info('audio_edit.reset.start', { context: { projectId } })
  try {
    resetAudioEditProject(projectId, expectedVersion ?? instance.version)
    await flushAudioEditProject(projectId)
    if (hasAudioEditModifications(instance.document)) throw new Error('口播在保存期间发生了新修改，未将其覆盖，请重新查看。')
    logger.info('audio_edit.reset.completed', { context: { projectId } })
  } catch (error) {
    logger.error('audio_edit.reset.failed', { context: { projectId }, error })
    throw error
  }
}

/** 整理字幕分段；有参考稿时按稿子断句（一行一句）。返回成片字幕段数，以及按稿子时与稿子文字不同、需要逐段核对的段数。 */
export async function formatProjectAudioEditCaptions(projectId: string): Promise<{ count: number; differing?: number }> {
  const instance = await loadAudioEditProject(projectId)
  logger.info('audio_edit.captions.start', { context: { projectId } })
  try {
    editAudioEditProject(projectId, formatAudioEditCaptions)
    await flushAudioEditProject(projectId)
    const views = describeAudioEditCaptions(instance.document)
    const differing = instance.document.referenceScript.trim() ? views.filter((view) => view.scriptMatch !== 'same').length : undefined
    logger.info('audio_edit.captions.completed', { context: { projectId, count: views.length, differing } })
    return { count: views.length, ...(differing === undefined ? {} : { differing }) }
  } catch (error) {
    logger.error('audio_edit.captions.failed', { context: { projectId }, error })
    throw error
  }
}

/** 是否有可以逐词剪辑的转写（去重念、清理语气词都需要）。 */
function hasWordTranscript(document: AudioEditProjectDocument): boolean {
  return document.transcript.length > 0 && document.transcript.every((block) => block.granularity === 'word')
}
/** 少于几个词不可能有重念，快速处理不必为此读取声音证据 */
const RETAKE_MIN_WORDS = 4

/**
 * 呼吸声（本地模型，第一次用到时下载）。required=false 时取不到就返回空：去重念、快速处理照常进行，只是不拿呼吸当气口。
 */
async function detectProjectBreaths(document: AudioEditProjectDocument, required: boolean, requestId: string): Promise<AudioBreath[] | undefined> {
  try {
    return await loadAudioEditBreaths(document)
  } catch (error) {
    if (required) throw error instanceof Error && /下载|download|网络|network/i.test(error.message) ? new Error(`呼吸声模型还没有准备好：${error.message}`) : error
    logger.warn('audio_edit.breaths.unavailable', { requestId, context: { projectId: document.id }, error })
    return undefined
  }
}

/**
 * 检测重念：读取实际声音的停顿证据（与停顿图、字幕断句共用的全频/高频能量分析），在 Worker 里比对转写，
 * 返回待应用的“重念”剪辑线索。参考稿只用来排除稿子里本来就有的重复。
 */
async function detectRetakeSuggestions(instance: AudioEditProjectInstance, range: AudioEditRange | undefined, requestId: string): Promise<AudioEditSuggestion[]> {
  const document = instance.document
  if (!document.transcript.length) throw new Error('这份口播还没有转写，请先识别口播。')
  if (!hasWordTranscript(document)) throw new Error('这份转写只有整句时间，无法逐词去掉重念；请用支持逐词时间的识别模型重新识别。')
  const detected = await getPlatform().audioEdit.detectSilence({ projectId: document.id, settings: document.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS, requestId, energy: {} })
  if (detected.revision !== instance.persistedRevision) throw new Error('口播已更新，请重新检测重念。')
  if (!detected.energy) throw new Error('没有取得声音停顿证据，请重试。')
  // 呼吸也是气口：换遍拼接、碎字判断都把它与停顿同等看待
  const breaths = await detectProjectBreaths(document, false, requestId)
  const retakes = await detectAudioEditRetakesOffThread(document.transcript, {
    sampleRate: document.source.sampleRate, pauses: detected.energy.pauses, referenceScript: document.referenceScript, ...(range ? { range } : {}), ...(breaths ? { breaths } : {}),
  })
  return retakes.map(audioEditRetakeSuggestion)
}

/** 把检测到的重念并入线索并逐条应用；已处理或已隐藏的同一处不重复提出。 */
function applyRetakeSuggestions(document: AudioEditProjectDocument, detected: readonly AudioEditSuggestion[]): AudioEditProjectDocument {
  const existing = new Set(document.suggestions.filter((item) => item.status !== 'pending').map((item) => item.id))
  const fresh = detected.filter((item) => !existing.has(item.id))
  let draft: AudioEditProjectDocument = { ...document, suggestions: [...document.suggestions.filter((item) => item.kind !== 'retake' || item.status !== 'pending'), ...fresh] }
  for (const suggestion of fresh) draft = applyAudioEditSuggestion(draft, suggestion.id)
  return draft
}

const appliedCount = (detected: readonly AudioEditSuggestion[], before: AudioEditProjectDocument, after: AudioEditProjectDocument): number => {
  const applied = new Set(before.suggestions.filter((item) => item.status === 'applied').map((item) => item.id))
  return detected.filter((item) => !applied.has(item.id) && after.suggestions.some((entry) => entry.id === item.id && entry.status === 'applied')).length
}

export async function cleanProjectAudioEditRetakes(projectId: string, range?: AudioEditRange, requestId: string = crypto.randomUUID()): Promise<{ count: number; shortenedMs: number }> {
  logger.info('audio_edit.retakes.start', { requestId, context: { projectId, range: Boolean(range) } })
  try {
    const result = await withAudioEditProjectOperation(projectId, async (instance, commit) => {
      const original = instance.document
      const before = editedDurationFrames(buildProjectAudioEditTimeline(original))
      const detected = await detectRetakeSuggestions(instance, range, requestId)
      const next = commit((document) => applyRetakeSuggestions(document, detected))
      await flushAudioEditProject(projectId)
      return { count: appliedCount(detected, original, next), shortenedMs: Math.round((before - editedDurationFrames(buildProjectAudioEditTimeline(next))) * 1000 / next.source.sampleRate) }
    })
    logger.info('audio_edit.retakes.completed', { requestId, context: { projectId, ...result } })
    return result
  } catch (error) {
    logger.error('audio_edit.retakes.failed', { requestId, context: { projectId }, error })
    throw error
  }
}

export async function compressAudioEditSilence(projectId: string, range?: AudioEditRange, requestId: string = crypto.randomUUID(), includeFillers = false): Promise<{ count: number; shortenedMs: number; retakeCount: number; breaths?: Record<'deleted' | 'attenuated' | 'muted' | 'kept', number>; gaps?: number }> {
  return withAudioEditProjectOperation(projectId, async (instance, commit) => {
    const settings = instance.document.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
    const before = editedDurationFrames(buildProjectAudioEditTimeline(instance.document))
    // 快速处理（连带语气词）在有逐词转写时先去掉重念，再压缩停顿、清理语气词、处理呼吸声，整批一个撤销步骤
    const retakes = includeFillers && hasWordTranscript(instance.document) && instance.document.transcript.length >= RETAKE_MIN_WORDS ? await detectRetakeSuggestions(instance, range, requestId) : []
    const breaths = includeFillers && instance.document.transcript.length ? await detectProjectBreaths(instance.document, false, requestId) : undefined
    let breathCounts: Record<'deleted' | 'attenuated' | 'muted' | 'kept', number> | undefined
    let gapCount: number | undefined
    // 处理呼吸时连同能量低谷一起取：只把真正安静的部分算作气口
    const detected = await getPlatform().audioEdit.detectSilence({ projectId, settings, range, requestId, ...(breaths ? { energy: { levels: true } } : {}) })
    if (detected.revision !== instance.persistedRevision) throw new Error('口播已更新，请重新分析停顿。')
    const appliedIds = new Set(instance.document.suggestions.filter((item) => item.status === 'applied').map((item) => item.id))
    const next = commit((document) => {
      let draft = retakes.length ? applyRetakeSuggestions(document, retakes) : document
      const existing = new Set(draft.suggestions.filter((item) => item.status !== 'pending').map((item) => item.id))
      const suggestions = detected.suggestions.filter((item) => !existing.has(item.id))
      draft = { ...draft, batchSettings: settings, suggestions: [...draft.suggestions.filter((item) => item.kind !== 'long_silence' || item.status !== 'pending'), ...suggestions] }
      for (const suggestion of suggestions) draft = applyAudioEditSuggestion(draft, suggestion.id)
      if (includeFillers) draft = cleanAudioEditFillers(draft, settings.fillers, range)
      if (breaths) {
        const processed = applyAudioEditBreathPolicy(draft, breaths, 'delete', range, detected.energy?.pauses); draft = processed.document; breathCounts = processed.counts
        const levels = energyLevels(detected.energy)
        if (levels) { const cleaned = cleanAudioEditGaps(draft, breaths, levels, range); draft = cleaned.document; gapCount = cleaned.count }
      }
      return draft
    })
    await flushAudioEditProject(projectId)
    return { count: detected.suggestions.filter((item) => !appliedIds.has(item.id) && next.suggestions.some((entry) => entry.id === item.id && entry.status === 'applied')).length,
      shortenedMs: Math.round((before - editedDurationFrames(buildProjectAudioEditTimeline(next))) * 1000 / next.source.sampleRate),
      retakeCount: retakes.filter((item) => !appliedIds.has(item.id) && next.suggestions.some((entry) => entry.id === item.id && entry.status === 'applied')).length,
      ...(breathCounts ? { breaths: breathCounts } : {}), ...(gapCount !== undefined ? { gaps: gapCount } : {}) }
  })
}

const energyLevels = (energy: SpeechEnergyAnalysis | undefined): AudioEditLevels | undefined =>
  energy?.levels ? { resolutionMs: energy.resolutionMs, wideDb: energy.levels.wideDb, ...(energy.levels.highDb ? { highDb: energy.levels.highDb } : {}) } : undefined

/**
 * 声音能量低谷与逐帧电平（与停顿压缩、去重念同一分析）；取不到时返回空，
 * 呼吸处理退回按词之间的空当判断气口，也不清理字间气口。
 */
async function detectQuietRanges(document: AudioEditProjectDocument, requestId: string): Promise<{ pauses: AudioEditQuietRange[]; levels?: AudioEditLevels } | undefined> {
  try {
    const detected = await getPlatform().audioEdit.detectSilence({ projectId: document.id, settings: document.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS, requestId, energy: { levels: true } })
    return detected.energy ? { pauses: detected.energy.pauses, levels: energyLevels(detected.energy) } : undefined
  } catch (error) {
    logger.warn('audio_edit.breaths.energy_unavailable', { requestId, context: { projectId: document.id }, error })
    return undefined
  }
}

/** 按策略处理呼吸声（删除 / 减弱 / 静音 / 保留），默认删除时按上下文细分；替换此前的呼吸处理，用户逐处恢复过的不动。 */
export async function processProjectAudioEditBreaths(projectId: string, policy: AudioEditBreathPolicy = 'delete', range?: AudioEditRange, requestId: string = crypto.randomUUID()): Promise<{ counts: Record<'deleted' | 'attenuated' | 'muted' | 'kept', number>; gaps: number; shortenedMs: number }> {
  logger.info('audio_edit.breaths.start', { requestId, context: { projectId, policy, range: Boolean(range) } })
  try {
    const result = await withAudioEditProjectOperation(projectId, async (instance, commit) => {
      const breaths = (await detectProjectBreaths(instance.document, true, requestId))!
      const energy = await detectQuietRanges(instance.document, requestId)
      const before = editedDurationFrames(buildProjectAudioEditTimeline(instance.document))
      let counts = { deleted: 0, attenuated: 0, muted: 0, kept: 0 }
      let gaps = 0
      const next = commit((document) => {
        const base = policy === 'delete' ? document : clearAudioEditGaps(document, range)
        const processed = applyAudioEditBreathPolicy(base, breaths, policy, range, energy?.pauses); counts = processed.counts
        // 快节奏删除时连带把字间气口清成静音；改为减弱、静音或保留时撤掉此前的清理，不把保留的呼吸静音掉
        if (policy !== 'delete' || !energy?.levels) return processed.document
        const cleaned = cleanAudioEditGaps(processed.document, breaths, energy.levels, range); gaps = cleaned.count
        return cleaned.document
      })
      await flushAudioEditProject(projectId)
      return { counts, gaps, shortenedMs: Math.round((before - editedDurationFrames(buildProjectAudioEditTimeline(next))) * 1000 / next.source.sampleRate) }
    })
    logger.info('audio_edit.breaths.completed', { requestId, context: { projectId, ...result.counts, gaps: result.gaps, shortenedMs: result.shortenedMs } })
    return result
  } catch (error) {
    logger.error('audio_edit.breaths.failed', { requestId, context: { projectId }, error })
    throw error
  }
}

/**
 * 效果控件里的“呼吸声”：检测整段录音里的呼吸（本地模型，按素材缓存），把范围写进这一项（不改时长；之后减弱或静音按这一项的设置）。
 * 界面加进这一项时自动调用；助手也用它。
 */
export async function analyzeProjectAudioEditBreathItem(projectId: string, itemId: string, requestId: string = crypto.randomUUID()): Promise<{ count: number }> {
  const instance = await loadAudioEditProject(projectId)
  if (!(instance.document.effectChain ?? []).some(item => item.id === itemId && item.kind === 'breath')) throw new Error('效果控件里没有这一项呼吸声。')
  const breaths = (await detectProjectBreaths(instance.document, true, requestId))!
  const rate = instance.document.source.sampleRate, duration = instance.document.source.durationFrames
  const ranges = breaths.map(breath => ({ startFrame: Math.max(0, Math.round(breath.startMs * rate / 1000)), endFrame: Math.min(duration, Math.round(breath.endMs * rate / 1000)) }))
    .filter(range => range.endFrame > range.startFrame && range.endFrame - range.startFrame <= rate * 10).slice(0, 20000)
  editAudioEditProject(projectId, document => ({ ...document, effectChain: (document.effectChain ?? []).map(item => item.id === itemId && item.kind === 'breath' ? { ...item, analyzed: true, breaths: ranges } : item) }))
  await flushAudioEditProject(projectId)
  logger.info('呼吸声检测完成', { event: 'audio_edit.breath_item.analyzed', requestId, context: { projectId, itemId, count: ranges.length } })
  return { count: ranges.length }
}

export async function quickProcessAudioEdit(projectId: string, range?: AudioEditRange, requestId: string = crypto.randomUUID()) {
  return compressAudioEditSilence(projectId, range, requestId, true)
}

export async function cleanProjectAudioEditFillers(projectId: string, range?: AudioEditRange): Promise<number> {
  const instance = await loadAudioEditProject(projectId)
  const before = instance.document.transcript.filter((block) => !block.included).length
  const next = editAudioEditProject(projectId, (document) => cleanAudioEditFillers(document, (document.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS).fillers, range))
  await flushAudioEditProject(projectId)
  return next.transcript.filter((block) => !block.included).length - before
}

export async function transcribeAudioEdit(request: AudioEditTranscriptionRequest, signal?: AbortSignal, approvalDocumentId = request.projectId): Promise<void> {
  let dispatched = false
  let completed = false
  let applied = false
  try {
  await withAudioEditProjectOperation(request.projectId, async (instance) => {
    const version = instance.version
    const prepared = await preflightAudioEditTranscription(request.projectId, request.modelId, request.language)
    const transcribe = async () => {
      signal?.throwIfAborted()
      dispatched = true
      return getPlatform().audioEdit.transcribe({ ...request, modelId: prepared.modelId ?? request.modelId })
    }
    const result = prepared.requiresConfirmation
      ? await withPaidOperation({ category: 'recognition', documentId: approvalDocumentId, estimatedCny: transcriptionEstimatedCny(prepared), titleKey: 'paidApproval.recognizeAudio' }, transcribe, signal)
      : await transcribe()
    completed = true
    acceptAudioEditNativeResult(request.projectId, result.project, version)
    applied = true
    // 付费识别结果立即写进文档文件，不等防抖
    await flushAudioEditProject(request.projectId)
  })
  } catch (error) {
    throw new TranscriptionFailure(error, { billing: completed ? 'completed' : dispatched ? 'unknown' : 'not_charged', targetMutation: applied ? 'applied' : 'none',
      ...readTranscriptionFacts(error), audioDocumentId: request.projectId })
  }
}

export async function preflightAudioEditTranscription(projectId: string, modelId?: string, language?: string): Promise<import('@/core/audioEdit/transcriptionFailure').TranscriptionPreparation> {
  const instance = await loadAudioEditProject(projectId)
  if (instance.document.transcript.length) return { requiresConfirmation: false }
  const source = instance.document.source
  return getPlatform().audioEdit.preflightTranscription({ sourcePath: source.sourcePath, durationMs: source.durationFrames * 1000 / source.sampleRate, modelId, language, audioDocumentId: projectId })
}
export async function exportAudioEdit(request: AudioEditExportRequest): Promise<AudioEditExportResult> {
  return withAudioEditProjectOperation(request.projectId, () => getPlatform().audioEdit.exportProject(request))
}
export async function prepareAudioEditProcessing(projectId: string, requestId: string): Promise<void> {
  return withAudioEditProjectOperation(projectId, () => getPlatform().audioEdit.prepareProcessing(projectId, requestId))
}
/** 重新定位原素材：主进程确认是同一份内容后返回新的素材信息，实例接收并经文档会话保存。 */
export async function relinkAudioEdit(projectId: string, sourcePath: string): Promise<AudioEditProjectDocument> {
  return withAudioEditProjectOperation(projectId, async (instance) => {
    const version = instance.version
    const source = await getPlatform().audioEdit.relinkSource(projectId, sourcePath)
    acceptAudioEditNativeResult(projectId, { ...instance.document, source }, version)
    await flushAudioEditProject(projectId)
    return instance.document
  })
}

/**
 * 输出一节的“自动匹配响度”：按当前全部处理（不含响度补偿本身）渲染成品、测积分响度，把到目标需要的补偿写进 output.loudness
 * （同时打开自动匹配，末尾限幅 -1 dB）。界面与助手共用。
 */
export async function matchProjectAudioEditLoudness(projectId: string, targetLufs = -16, requestId: string = crypto.randomUUID()): Promise<{ integratedLufs: number; gainDb: number }> {
  await flushAudioEditProject(projectId)
  const result = await getPlatform().audioEdit.matchLoudness({ projectId, targetLufs, requestId })
  editAudioEditProject(projectId, document => ({ ...document, output: { volumeDb: document.output?.volumeDb ?? 0, loudness: { enabled: true, targetLufs, gainDb: result.gainDb } } }))
  await flushAudioEditProject(projectId)
  logger.info('响度已匹配', { event: 'audio_edit.loudness.matched', context: { projectId, targetLufs, ...result } })
  return result
}

/**
 * 检测口水音并打开修复：写进效果链里的“去除口水音”（itemId 指定哪一项；不给时用链里第一项去除口水音，没有就加到链末尾）。
 * 检测听的是这一项之前的声音；传 range 时只替换这段里原有的结果。界面与助手共用。
 */
export async function detectProjectAudioEditMouthClicks(projectId: string, options: { itemId?: string; sensitivity?: number; range?: AudioEditRange } = {}, requestId: string = crypto.randomUUID()): Promise<{ itemId: string; count: number; perMinute: number }> {
  const instance = await loadAudioEditProject(projectId)
  const existing = (instance.document.effectChain ?? []).find(item => item.kind === 'mouth_declick' && (!options.itemId || item.id === options.itemId))
  if (options.itemId && !existing) throw new Error('效果控件里没有这一项去除口水音。')
  const itemId = existing?.id ?? crypto.randomUUID()
  const sensitivity = options.sensitivity ?? (existing?.kind === 'mouth_declick' ? existing.sensitivity : 50)
  if (!existing) {
    if ((instance.document.effectChain?.length ?? 0) >= AUDIO_EDIT_MAX_CHAIN_ITEMS) throw new Error(`效果控件最多放 ${AUDIO_EDIT_MAX_CHAIN_ITEMS} 个效果。`)
    editAudioEditProject(projectId, document => ({ ...document, effectChain: [...(document.effectChain ?? []), { id: itemId, kind: 'mouth_declick', enabled: true, sensitivity, analyzed: false, clicks: [] }] }))
  }
  await flushAudioEditProject(projectId)
  const range = options.range
  const { clicks } = await getPlatform().audioEdit.detectMouthClicks({ projectId, itemId, sensitivity, ...(range ? { range } : {}), requestId })
  let total = 0, durationFrames = 1, sampleRate = 48000
  editAudioEditProject(projectId, document => {
    total = 0
    const effectChain = (document.effectChain ?? []).map(item => {
      if (item.id !== itemId || item.kind !== 'mouth_declick') return item
      const outside = (click: { startFrame: number; endFrame: number }) => !range || click.endFrame <= range.startFrame || click.startFrame >= range.endFrame
      const kept = range ? item.clicks.filter(outside) : []
      const next = [...kept, ...clicks.map(({ startFrame, endFrame }) => ({ startFrame, endFrame }))].sort((a, b) => a.startFrame - b.startFrame).slice(0, 20000)
      // 重新检测的范围里，之前关掉的位置一并清掉（按新结果重来）；范围外的保持关掉
      const skipped = range ? (item.skipped ?? []).filter(outside) : []
      total = next.length
      return { ...item, sensitivity, analyzed: true, clicks: next, skipped: skipped.length ? skipped : undefined }
    })
    durationFrames = range ? range.endFrame - range.startFrame : document.source.durationFrames; sampleRate = document.source.sampleRate
    return { ...document, effectChain }
  })
  await flushAudioEditProject(projectId)
  const count = range ? clicks.length : total
  logger.info('口水音检测完成', { event: 'audio_edit.mouth_clicks.detected', context: { projectId, itemId, sensitivity, count } })
  return { itemId, count, perMinute: Math.round(count / Math.max(1 / 60, durationFrames / sampleRate / 60)) }
}
