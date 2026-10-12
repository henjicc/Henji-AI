import { requestAlertConfirmation } from '@/stores/alertDialogStore'
import { executeApplicationWrite, applicationWritePreflight } from '@/core/application-control/execution/writeExecution'
import { applicationPaidRequest, transcriptionEstimatedCny } from '@/services/paidApproval'
import { hasApplicationConfirmation } from '@/core/application-control/userConfirmation'
import { backupPersistenceSnapshot } from '@/core/persistence/backup'
import { videoEditSubtitleManifestSchema } from '@/core/persistence/storedSchemas'
import { SUBTITLE_MANIFEST_VERSION } from '@/core/persistence/preferenceSchemas'
import { formatMigrations } from '@/core/persistence/formatMigrations'
import { migratePersistenceContent } from '@/core/persistence/migrations'
export { videoEditSubtitleManifestSchema } from '@/core/persistence/storedSchemas'
import { z } from 'zod'
import { AudioBufferSource, Output, StreamTarget, WavOutputFormat } from 'mediabunny'
import { createLogger } from '@/core/logging'
import { buildAutoSubtitles, autoSubtitleOptionsSchema, type AutoSubtitleOptions } from '@/core/videoEdit/autoSubtitles'
import { buildSpeechSubtitles } from '@/core/videoEdit/speechSubtitles'
import { resolveSubtitleStyle } from '@/core/videoEdit/subtitleStyleProfiles'
import { advanceVideoEditClipSource, videoEditClipFrameBoundaryAtSource } from '@/core/videoEdit/clipSpeed'
import { readClipSpeechTimings, readClipEnergyPauses, readSourceEnergyPauses } from './videoEditPauseMap'
import { videoEditComposition, videoEditDuration, audibleVideoEditClips, type VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditAudioContent } from '@/core/videoEdit/audioContent'
import { videoEditCaptionSchema, type VideoEditCaption } from '@/core/videoEdit/timedContent'
import { videoEditSubtitleStyleSchema, type VideoEditSubtitleStyle } from '@/core/videoEdit/subtitleStyle'
import { buildVideoEditTextTranscription, mergeVideoEditTextTranscription, videoEditTextMediaIdentity, type VideoEditTextTranscription } from '@/core/videoEdit/textTranscript'
import { getPlatform } from '@/platform/runtime'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { createAudioEditDraft, flushAudioEditProject, loadAudioEditProject, transcribeAudioEdit, preflightAudioEditTranscription } from '@/features/audioEdit'
import { readTranscriptionFacts, TranscriptionFailure, type TranscriptionFacts } from '@/core/audioEdit/transcriptionFailure'
import { editVideoSequence, requireVideoEditInstance, videoEditDocumentOperations, saveVideoEdit, verifyVideoEditSaved, holdVideoEditActivity, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.autoSubtitles')
export type SubtitleScope = 'sequence' | 'in-out' | 'selection'
export type SubtitleTranscriptionOptions = AutoSubtitleOptions & { language?: 'zh' | 'en' }

const manifestSchema = videoEditSubtitleManifestSchema
type Manifest = z.infer<typeof manifestSchema>
const active = new WeakSet<VideoEditInstance>()

export async function videoEditSubtitleSequenceSignature(snapshot: VideoEditComposition): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoEditAudioContent(snapshot)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
const sequenceSignature = videoEditSubtitleSequenceSignature
function current(projectId: string, sequenceId: string): VideoEditComposition { return videoEditComposition(requireVideoEditInstance(projectId).document, sequenceId) }
export function subtitleRange(owner: VideoEditInstance, sequenceId: string, scope: SubtitleScope): { startFrame: number; endFrame: number } {
  const sequence = videoEditComposition(owner.document, sequenceId)
  if (scope !== 'sequence' && owner.activeSequenceId !== sequenceId) throw new Error('请先打开目标序列，再选择入出点或片段范围。')
  if (scope === 'in-out') {
    if (owner.inFrame === null || owner.outFrame === null || owner.outFrame <= owner.inFrame) throw new Error('请先设置完整入出点范围。')
    return { startFrame: owner.inFrame, endFrame: owner.outFrame }
  }
  if (scope === 'selection') {
    const clips = sequence.clips.filter(clip => owner.selectedClipIds.includes(clip.id))
    if (!clips.length) throw new Error('请先选择要转录的片段。')
    return { startFrame: Math.min(...clips.map(clip => clip.start)), endFrame: Math.max(...clips.map(clip => clip.start + clip.duration)) }
  }
  return { startFrame: 0, endFrame: videoEditDuration(sequence) }
}

/** Prepare is local only. A saved audio document is the stable ASR task/recovery reference. */
export async function prepareVideoEditSubtitleAudio(projectId: string, sequenceId: string, scope: SubtitleScope, trackId?: string, signal?: AbortSignal, progress?: (fraction: number) => void): Promise<string> {
  return executeApplicationWrite(async execution => {
  const owner = requireVideoEditInstance(projectId)
  if (active.has(owner)) throw new Error('这份剪辑正在准备字幕声音。')
  const release = holdVideoEditActivity(projectId, '字幕混音')
  active.add(owner)
  let renderer: VideoEditRenderSession | undefined; let output: Output | undefined; let path: string | undefined; let retained = false
  const cancelMix = (): void => { void renderer?.dispose().catch(error => logger.warn('字幕混音取消清理失败', { event: 'video_edit.subtitle.prepare.cleanup_failed', error })) }
  signal?.addEventListener('abort', cancelMix, { once: true })
  logger.info('开始准备字幕混音', { event: 'video_edit.subtitle.prepare.start', context: { projectId, sequenceId, scope } })
  try {
    signal?.throwIfAborted()
    const snapshot = structuredClone(current(projectId, sequenceId)); const range = subtitleRange(owner, sequenceId, scope); const selected = new Set(owner.selectedClipIds)
    const signature = await sequenceSignature(snapshot)
    const track = trackId ? snapshot.tracks.find(track => track.id === trackId) : undefined
    if (trackId && !track) throw new Error('指定声音轨道已移除。')
    const sound = { ...snapshot, clips: snapshot.clips.filter(clip => (!track || clip.track === track.index) && (scope !== 'selection' || selected.has(clip.id))) }
    if (!audibleVideoEditClips(sound).some(clip => clip.start < range.endFrame && clip.start + clip.duration > range.startFrame)) throw new Error('所选范围没有可听声音，请检查静音、独奏或音轨选择。')
    const container = owner.session.documentMeta.container
    if (container.kind !== 'project') throw new Error('请先把剪辑保存到项目，再生成字幕。')
    const project = await videoEditDocumentOperations().findProject(container.projectId)
    if (!project) throw new Error('剪辑所在项目找不到。')
    const platform = getPlatform(); const folder = await platform.system.paths.join(project.path, '字幕转录')
    await execution.run(() => platform.system.fs.mkdir(folder, { recursive: true }))
    path = await platform.system.paths.join(folder, `${crypto.randomUUID()}.wav`)
    await platform.system.fs.writeFile(path, new Uint8Array(), { exclusive: true })
    const target = path
    output = new Output({ format: new WavOutputFormat(), target: new StreamTarget(new WritableStream({ write: chunk => { signal?.throwIfAborted(); return platform.system.fs.writeFile(target, chunk.data, { position: chunk.position }) } }), { chunked: true }) })
    const audio = new AudioBufferSource({ codec: 'pcm-s16' }); output.addAudioTrack(audio); await output.start()
    renderer = new VideoEditRenderSession(sound)
    const firstSample = Math.round(range.startFrame * snapshot.sampleRate / snapshot.fps)
    const finalSample = Math.round(range.endFrame * snapshot.sampleRate / snapshot.fps)
    const step = snapshot.sampleRate * 5
    for (let sample = firstSample; sample < finalSample; sample += step) {
      signal?.throwIfAborted()
      const end = Math.min(finalSample, sample + step)
      const buffer = await renderer.mixAudio(sample / snapshot.sampleRate, (end - sample) / snapshot.sampleRate)
      // The encoder's timestamp is relative to the exported range, rather than the sequence clock.
      await audio.add(buffer); progress?.((end - firstSample) / (finalSample - firstSample))
    }
    await output.finalize(); output = undefined
    signal?.throwIfAborted()
    if (requireVideoEditInstance(projectId) !== owner || await sequenceSignature(current(projectId, sequenceId)) !== signature) throw new Error('剪辑声音在准备期间已改变，请重新准备。')
    const source = await platform.audioEdit.probeSource(path)
    // Save the source identity before registering its document; a failed first write leaves no orphan draft.
    await platform.system.fs.writeTextFile(`${path}.subtitle.json`, JSON.stringify({ version: SUBTITLE_MANIFEST_VERSION, projectId, sequenceId, signature, soundClips: audibleVideoEditClips(sound), soundIdentities: Object.fromEntries(audibleVideoEditClips(sound).map(clip => [clip.itemId, videoEditTextMediaIdentity(snapshot, clip.itemId)])), ...range } satisfies Manifest))
    const draft = await createAudioEditDraft(source, container)
    retained = true; draft.session.markInUse(); await flushAudioEditProject(draft.document.id)
    logger.info('字幕混音准备完成', { event: 'video_edit.subtitle.prepare.completed', context: { projectId, sequenceId, audioDocumentId: draft.document.id } })
    return draft.document.id
  } catch (error) { logger.error('字幕混音准备失败', { event: 'video_edit.subtitle.prepare.failed', error, context: { projectId, sequenceId } }); throw error }
  finally {
    signal?.removeEventListener('abort', cancelMix)
    try { const cleanup = await Promise.allSettled([output?.cancel(), renderer?.dispose()]); for (const result of cleanup) if (result.status === 'rejected') logger.warn('字幕混音资源清理失败', { event: 'video_edit.subtitle.prepare.cleanup_failed', error: result.reason }) } finally {
      active.delete(owner); release()
      if (path && !retained) for (const file of [path, `${path}.subtitle.json`]) {
        try { if (await getPlatform().system.fs.exists(file)) await getPlatform().system.fs.remove(file) }
        catch (error) { logger.warn('未完成混音清理失败', { event: 'video_edit.subtitle.prepare.cleanup_failed', error }) }
      }
    }
  }
  })
}

export function appendAutoSubtitles(projectId: string, sequenceId: string, captions: readonly VideoEditCaption[], textTranscription?: VideoEditTextTranscription): string[] {
  const parsed = captions.map(caption => videoEditCaptionSchema.parse(caption))
  if (!parsed.length) throw new Error('没有可用字幕，请检查识别结果。')
  editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, ...(textTranscription ? { textTranscription: mergeVideoEditTextTranscription(sequence.textTranscription, textTranscription) } : {}), captions: [...(sequence.captions ?? []), ...parsed] }))
  return parsed.map(caption => caption.id)
}

/** UI and approved capability calls share ASR, cancellation, saved paid results and a single edit commit. */
export async function generateVideoEditSubtitles(projectId: string, sequenceId: string, audioDocumentId: string, modelId?: string, options: SubtitleTranscriptionOptions = {}, signal?: AbortSignal, requestId: string = crypto.randomUUID()): Promise<string[]> {
  const settings = autoSubtitleOptionsSchema.strip().parse(options)
  const language = z.enum(['zh', 'en']).optional().parse(options.language)
  const owner = await applicationWritePreflight({}, () => {
    const instance = requireVideoEditInstance(projectId)
    if (active.has(instance)) throw new Error('这份剪辑正在生成字幕。')
    return instance
  })
  const release = holdVideoEditActivity(projectId, '字幕转录')
  active.add(owner)
  let cancel: (() => void) | undefined
  let billing: TranscriptionFacts['billing'] = 'not_charged'
  let applied = false
  logger.info('字幕转录开始', { event: 'video_edit.subtitle.transcribe.start', requestId, context: { projectId, sequenceId, audioDocumentId } })
  try {
    signal?.throwIfAborted()
    const audio = await loadAudioEditProject(audioDocumentId)
    const path = `${audio.document.source.sourcePath}.subtitle.json`
    const platform = getPlatform()
    const text = await platform.system.fs.readTextFile(path)
    const raw = JSON.parse(text) as unknown
    const version = raw && typeof raw === 'object' && 'version' in raw ? raw.version : 1
    const contract = { id: 'subtitle-manifest', name: '字幕回填记录', version: SUBTITLE_MANIFEST_VERSION, migrations: formatMigrations('subtitle-manifest') }
    const backup = await backupPersistenceSnapshot(path, contract, typeof version === 'number' ? version : 0, new TextEncoder().encode(text), platform.system.fs)
    const manifest = manifestSchema.parse(migratePersistenceContent(contract, raw, typeof version === 'number' ? version : 0, backup))
    if (manifest.projectId !== projectId || manifest.sequenceId !== sequenceId) throw new Error('此转录声音不属于目标剪辑序列。')
    const assertTarget = async (): Promise<void> => {
      signal?.throwIfAborted()
      if (requireVideoEditInstance(projectId) !== owner || await sequenceSignature(current(projectId, sequenceId)) !== manifest.signature) throw new Error('原序列声音已有修改；识别结果保留在口播文档，不会覆盖当前剪辑。')
    }
    await assertTarget()
    const ids = manifest.captions?.map(caption => caption.id)
    if (ids?.length && ids.every(id => current(projectId, sequenceId).captions?.some(caption => caption.id === id))) { await saveVideoEdit(projectId); await platform.system.fs.writeTextFile(path, JSON.stringify({ ...manifest, committed: true })); return ids }
    if (ids?.some(id => current(projectId, sequenceId).captions?.some(caption => caption.id === id))) throw new Error('这批字幕已有部分保留，请编辑现有字幕，不要重复回填。')
    if (manifest.committed) throw new Error('这批字幕已生成后被移除，不会重复回填；可从已保存转录结果重新整理。')
    cancel = () => { void platform.audioEdit.listTasks(audioDocumentId).then(tasks => Promise.all(tasks.filter(task => ['queued', 'running'].includes(task.state)).map(task => platform.audioEdit.cancelTask(task.requestId)))).catch(error => logger.warn('字幕转录取消请求失败', { event: 'video_edit.subtitle.cancel.failed', error })); void platform.audioEdit.cancelTask(requestId).catch(error => logger.warn('字幕取消失败', { event: 'video_edit.subtitle.cancel.failed', error })) }
    signal?.addEventListener('abort', cancel, { once: true })
    if (!audio.document.transcript.length) {
      const prepared = await preflightAudioEditTranscription(audioDocumentId, modelId, language)
      if (prepared.requiresConfirmation && hasApplicationConfirmation(signal)) await requestAlertConfirmation({ title: '转录并生成字幕', message: '使用已配置的语音模型转录声音并生成字幕。', confirmLabel: '允许本次', paid: await applicationPaidRequest('recognition', projectId, signal, transcriptionEstimatedCny(prepared)) }, signal)
      await assertTarget()
      billing = 'unknown'
      await transcribeAudioEdit({ projectId: audioDocumentId, modelId: prepared.modelId ?? modelId, language, requestId })
      billing = 'completed'
    }
    else await flushAudioEditProject(audioDocumentId)
    await assertTarget()
    const fps = current(projectId, sequenceId).fps
    const pauses = !manifest.captions && audio.document.transcript.some(block => block.granularity !== 'word')
      ? (await readSourceEnergyPauses(audio.document.source.sourcePath, signal)).map(pause => ({ startMs: pause.startMs + manifest.startFrame / fps * 1000, endMs: pause.endMs + manifest.startFrame / fps * 1000 })) : []
    const captions = manifest.captions ?? buildAutoSubtitles(audio.document.transcript, audio.document.source.sampleRate, current(projectId, sequenceId).frameRate, manifest, settings, pauses).map(caption => ({ ...caption, style: videoEditSubtitleStyleSchema.parse({}) }))
    if (!captions.length) throw new Error('识别结果没有可用字幕。')
    // Record planned IDs before committing, so a lost save acknowledgement cannot create a duplicate batch.
    await platform.system.fs.writeTextFile(path, JSON.stringify({ ...manifest, captions }))
    await assertTarget()
    const composition = current(projectId, sequenceId)
    const textTranscription = buildVideoEditTextTranscription(composition, manifest.soundClips ?? audibleVideoEditClips(composition), audio.document, manifest.startFrame)
    const result = appendAutoSubtitles(projectId, sequenceId, captions, textTranscription)
    applied = true
    await saveVideoEdit(projectId)
    await platform.system.fs.writeTextFile(path, JSON.stringify({ ...manifest, captions, committed: true }))
    logger.info('字幕生成完成', { event: 'video_edit.subtitle.transcribe.completed', requestId, context: { projectId, sequenceId, count: result.length } })
    return result
  } catch (error) {
    logger.error('字幕生成失败，已完成转录保留供恢复', { event: 'video_edit.subtitle.transcribe.failed', requestId, error, context: { projectId, sequenceId, audioDocumentId } })
    throw new TranscriptionFailure(error, { billing: readTranscriptionFacts(error)?.billing ?? billing, targetMutation: applied ? 'applied' : 'none', audioDocumentId })
  }
  finally { if (cancel) signal?.removeEventListener('abort', cancel); active.delete(owner); release() }
}

export function splitVideoEditSubtitle(projectId: string, sequenceId: string, id: string, frame: number, character: number): void {
  editVideoSequence(projectId, sequenceId, sequence => {
    const cue = sequence.captions?.find(cue => cue.id === id)
    if (!cue || frame <= cue.start || frame >= cue.start + cue.duration || !Number.isInteger(character)) throw new Error('请在字幕内部选择拆分时刻与文字位置。')
    const points = Array.from(cue.text); const left = points.slice(0, character).join('').trim(); const right = points.slice(character).join('').trim()
    if (character <= 0 || character >= points.length || !left || !right) throw new Error('拆分后两行都须保留文字。')
    let translations: [string, string] | undefined
    if (cue.translation) {
      const translated = Array.from(cue.translation)
      const target = Math.max(1, Math.min(translated.length - 1, Math.round(translated.length * character / points.length)))
      const spaces = translated.flatMap((point, index) => /\s/u.test(point) && index > 0 && index < translated.length - 1 ? [index] : [])
      const boundary = spaces.length ? spaces.reduce((closest, index) => Math.abs(index - target) < Math.abs(closest - target) ? index : closest) : target
      translations = [translated.slice(0, boundary).join('').trim(), translated.slice(boundary).join('').trim()]
      if (translations.some(text => !text)) throw new Error('译文太短无法拆分，请先清除第二语言，拆分后重新翻译。')
    }
    return { ...sequence, captions: sequence.captions!.flatMap(value => value.id === id ? [{ ...cue, text: left, ...(translations ? { translation: translations[0] } : {}), duration: frame - cue.start }, { ...cue, id: crypto.randomUUID(), text: right, ...(translations ? { translation: translations[1] } : {}), start: frame, duration: cue.start + cue.duration - frame }] : [value]) }
  })
}
export function mergeVideoEditSubtitles(projectId: string, sequenceId: string, ids: readonly string[]): void {
  editVideoSequence(projectId, sequenceId, sequence => {
    const all = [...(sequence.captions ?? [])].sort((a, b) => a.start - b.start)
    const selected = all.filter(cue => ids.includes(cue.id))
    const first = selected[0]; const last = selected.at(-1)
    if (ids.length < 2 || selected.length !== ids.length || !first || !last || all.slice(all.indexOf(first), all.indexOf(last) + 1).length !== selected.length || selected.some(cue => cue.clipId !== first.clipId)) throw new Error('请选择相邻且跟随同一片段的字幕。')
    if (selected.some(cue => Boolean(cue.translation)) && !selected.every(cue => Boolean(cue.translation))) throw new Error('请先为这些字幕统一生成或清除第二语言，再合并。')
    const merged = videoEditCaptionSchema.parse({ ...first, text: selected.map(cue => cue.text).join('\n'), ...(first.translation ? { translation: selected.map(cue => cue.translation).join(' ') } : {}), duration: Math.max(...selected.map(cue => cue.start + cue.duration)) - first.start })
    return { ...sequence, captions: sequence.captions!.flatMap(cue => cue.id === first.id ? [merged] : ids.includes(cue.id) ? [] : [cue]) }
  })
}
export function styleVideoEditSubtitles(projectId: string, sequenceId: string, style: VideoEditSubtitleStyle, ids?: readonly string[], gesture?: import('./videoEditService').VideoEditGesture): void {
  const parsed = videoEditSubtitleStyleSchema.parse(style)
  editVideoSequence(projectId, sequenceId, sequence => {
    if (ids && ids.some(id => !sequence.captions?.some(cue => cue.id === id))) throw new Error('原字幕已移除，请重新选择。')
    return { ...sequence, captions: sequence.captions?.map(cue => !ids || ids.includes(cue.id) ? { ...cue, style: parsed } : cue) }
  }, gesture)
}
/** Reuse saved speech anchors; cue-only text falls back to proportional timing without recognition. */
export async function segmentVideoEditSubtitles(projectId: string, sequenceId: string, options: AutoSubtitleOptions, ids?: readonly string[], signal?: AbortSignal): Promise<{ captionIds: string[]; createdIds: string[]; updatedIds: string[]; removedIds: string[] }> {
  const settings = autoSubtitleOptionsSchema.parse(options)
  const owner = requireVideoEditInstance(projectId); const snapshot = owner.document
  const sequence = snapshot.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('序列不存在。')
  const all = [...(sequence.captions ?? [])].sort((a, b) => a.start - b.start)
  const positions = new Map(all.map((caption, index) => [caption.id, index]))
  if (ids?.some(id => !positions.has(id))) throw new Error('原字幕已移除，请重新选择。')
  const selectedIds = new Set(ids ?? all.map(caption => caption.id))
  const selected = all.filter(caption => selectedIds.has(caption.id))
  if (!selected.length) throw new Error('没有可整理的字幕。')
  if (selected.some(caption => caption.translation)) throw new Error('请先清除第二语言，再整理长句；整理后可重新生成双语。')
  const captionIds: string[] = []; const createdIds: string[] = []; const updatedIds: string[] = []; const removedIds: string[] = []
  const captions = all.filter(caption => !selectedIds.has(caption.id))
  const savedTimings = new Map<string, ReturnType<typeof readClipSpeechTimings>>()
  const energyTimings = new Map<string, ReturnType<typeof readClipEnergyPauses>>()
  const groups: VideoEditCaption[][] = []
  const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
  const profile = resolveSubtitleStyle(settings)
  for (const caption of selected) {
    const group = groups.at(-1); const previous = group?.at(-1)
    if (previous && caption.clipId === previous.clipId && JSON.stringify(caption.style) === JSON.stringify(previous.style)
      && positions.get(caption.id)! === positions.get(previous.id)! + 1 && caption.start >= previous.start + previous.duration
      && (caption.start - previous.start - previous.duration) / fps * 1000 < profile.joinGapMs) group!.push(caption)
    else groups.push([caption])
  }
  const release = holdVideoEditActivity(projectId, '整理字幕')
  logger.info('整理字幕开始', { event: 'video_edit.subtitle.normalize.start', context: { projectId, sequenceId } })
  try {
    for (const group of groups) {
      signal?.throwIfAborted()
      const first = group[0]; const last = group.at(-1)!
      const clip = sequence.clips.find(clip => clip.id === first.clipId)
      if (clip && !savedTimings.has(clip.id)) savedTimings.set(clip.id, readClipSpeechTimings(projectId, sequenceId, clip.id))
      const timings = clip ? await savedTimings.get(clip.id) : undefined
      if (clip && timings?.granularity !== 'word' && !energyTimings.has(clip.id)) energyTimings.set(clip.id, readClipEnergyPauses(projectId, sequenceId, clip.id, signal))
      const pauses = clip ? await energyTimings.get(clip.id) ?? [] : []
      const boundary = all[positions.get(last.id)! + 1]?.start ?? videoEditDuration(sequence)
      const endFrame = Math.min(boundary, clip ? clip.start + clip.duration : boundary)
      const text = group.map(caption => caption.text).join(' ')
      const scopedClip = clip ? { ...clip, ...advanceVideoEditClipSource(clip, Math.max(first.start, clip.start) - clip.start, sequence.frameRate), start: Math.max(first.start, clip.start), duration: endFrame - Math.max(first.start, clip.start) } : undefined
      const sequencePauses = clip ? pauses.map(pause => {
        const a = videoEditClipFrameBoundaryAtSource(clip, pause.startMs / 1000, fps) / fps * 1000
        const b = videoEditClipFrameBoundaryAtSource(clip, pause.endMs / 1000, fps) / fps * 1000
        return { startMs: Math.min(a, b), endMs: Math.max(a, b) }
      }) : []
      const cues = timings && scopedClip ? (await buildSpeechSubtitles(text, timings, scopedClip, sequence.frameRate, settings, signal, pauses, 'clip')).map(value => value.caption)
        : buildAutoSubtitles(group.map(caption => ({ id: caption.id, text: caption.text, startFrame: (caption.start - first.start) * sequence.frameRate.denominator, endFrame: (caption.start + caption.duration - first.start) * sequence.frameRate.denominator, granularity: 'segment', included: true, locked: false })), sequence.frameRate.numerator, sequence.frameRate, { startFrame: first.start, endFrame }, settings, sequencePauses)
      if (!cues.length) throw new Error('已有时间信息无法覆盖这些字幕，请检查字幕与声音片段的对应位置。')
      for (let index = 0; index < cues.length; index++) {
        const original = group[index]; const id = original?.id ?? cues[index].id
        const value = { ...first, ...cues[index], id, style: first.style, clipId: first.clipId }
        captions.push(value); captionIds.push(id)
        if (!original) createdIds.push(id)
        else if (JSON.stringify(value) !== JSON.stringify(original)) updatedIds.push(id)
      }
      removedIds.push(...group.slice(cues.length).map(caption => caption.id))
    }
    signal?.throwIfAborted()
    if (owner.document !== snapshot) throw new Error('整理期间字幕已有修改，请重新整理。')
    editVideoSequence(projectId, sequenceId, sequence => ({ ...sequence, captions: captions.sort((a, b) => a.start - b.start) }))
    logger.info('整理字幕完成', { event: 'video_edit.subtitle.normalize.completed', context: { projectId, sequenceId, count: captionIds.length } })
    return { captionIds, createdIds, updatedIds, removedIds }
  } catch (error) { logger.error('整理字幕失败', { event: 'video_edit.subtitle.normalize.failed', context: { projectId, sequenceId }, error }); throw error }
  finally { release() }
}
export async function verifyAutoSubtitles(projectId: string): Promise<boolean> { return verifyVideoEditSaved(projectId) }
