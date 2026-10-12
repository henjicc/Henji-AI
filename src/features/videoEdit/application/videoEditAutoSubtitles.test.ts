import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { getPlatform } from '@/platform/runtime'
import { closeVideoEditProject, listVideoEditInstances, editVideoProject, undoVideoEdit, videoEditBusyReason, setVideoEditTimelineView, videoEditDocumentOperations, type VideoEditInstance } from './videoEditService'
import { loadAudioEditProject, resetAudioEditProjectInstancesForTests } from '@/features/audioEdit/application/audioEditProjectInstances'
import { prepareVideoEditSubtitleAudio, generateVideoEditSubtitles, appendAutoSubtitles, splitVideoEditSubtitle, mergeVideoEditSubtitles, styleVideoEditSubtitles, segmentVideoEditSubtitles, subtitleRange } from './videoEditAutoSubtitles'
import { videoEditSubtitleStyleSchema } from '@/core/videoEdit/subtitleStyle'
import { createVideoEditCaption, updateVideoEditTimedContent, exportVideoEditSubtitles } from './videoEditTimedContent'
import { readSubtitleJob, runVideoEditSubtitleJob, cancelSubtitleJob } from './videoEditSubtitleJobs'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { generateVideoEditSubtitleCapability } from '@/core/application-control/domains/videoEdit/videoEditSubtitleCapabilities'
import { applicationObservedEffectSchema } from '@/core/application-control/observedEffect'
import { reopenVideoEdit } from './videoEditDocumentTestKit'
import { editVideoEditText, restoreVideoEditText } from './videoEditTextEditing'
import { videoEditComposition } from '@/core/videoEdit/document'
import { resolveVideoEditTextRanges, videoEditTranscriptWords } from '@/core/videoEdit/textTranscript'
import { generateClipSpeechSubtitles } from './videoEditSpeechSubtitles'
import { handleVideoEditSubtitleCapability } from './videoEditSubtitleCapability'
import { bindApplicationConfirmation } from '@/core/application-control/userConfirmation'

const boundary = vi.hoisted(() => ({ mixes: [] as Array<{ start: number; duration: number }>, disposed: vi.fn() }))
// Pixel/encoder boundaries only; ASR, document instances, edits, history and persistence remain real.
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  async mixAudio(start: number, duration: number) { boundary.mixes.push({ start, duration }); return {} }
  async dispose() { boundary.disposed() }
} }))
vi.mock('mediabunny', async importOriginal => {
  const original = await importOriginal<typeof import('mediabunny')>()
  return { ...original, Output: class { addAudioTrack() {} async start() {} async finalize() {} async cancel() {} }, AudioBufferSource: class { async add() {} } }
})
const texts = new Map<string, string>(); const files = new Set<string>()
let owner: VideoEditInstance
beforeEach(async () => {
  installHarnessNativeStorage(); texts.clear(); files.clear(); boundary.mixes.length = 0; boundary.disposed.mockClear()
  const system = getPlatform().system
  vi.spyOn(system.paths, 'join').mockImplementation(async (...parts) => parts.join('/'))
  vi.spyOn(system.dialog, 'save').mockResolvedValue('D:/subtitles.henji-video')
  vi.spyOn(system.fs, 'mkdir').mockResolvedValue(undefined)
  vi.spyOn(system.fs, 'exists').mockImplementation(async path => files.has(path) || texts.has(path))
  vi.spyOn(system.fs, 'writeFile').mockImplementation(async path => { files.add(path) })
  vi.spyOn(system.fs, 'remove').mockImplementation(async path => { files.delete(path); texts.delete(path) })
  vi.spyOn(system.fs, 'writeTextFile').mockImplementation(async (path, text) => { texts.set(path, text) })
  vi.spyOn(system.fs, 'readTextFile').mockImplementation(async path => { if (!texts.has(path)) throw new Error('不存在'); return texts.get(path)! })
  vi.spyOn(getPlatform().audioEdit, 'probeSource').mockImplementation(async path => ({ mediaType: 'audio', sourcePath: path, audioPath: path, sampleRate: 1000, channels: 1, durationFrames: Math.round(boundary.mixes.reduce((sum, chunk) => sum + chunk.duration, 0) * 1000) }))
  vi.spyOn(getPlatform().audioEdit, 'listTasks').mockResolvedValue([])
  vi.spyOn(getPlatform().audioEdit, 'preflightTranscription').mockResolvedValue({ modelId: 'test-asr', requiresConfirmation: true })
  vi.spyOn(getPlatform().audioEdit, 'cancelTask').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockResolvedValue({ revision: 0, suggestions: [] })
  vi.spyOn(getPlatform().audioEdit, 'listAsrModels').mockResolvedValue([{ id: 'test-asr', providerId: 'test', timestamps: true, configured: true, longAudio: true }])
  vi.spyOn(getPlatform().audioEdit, 'transcribe').mockImplementation(async request => {
    const audio = await loadAudioEditProject(request.projectId)
    return { project: { ...audio.document, transcript: [{ id: 'one', text: 'Hello world.', startFrame: 0, endFrame: 1000, included: true, locked: false, granularity: 'segment' }] }, modelId: 'test-asr', granularity: 'segment' }
  })
  owner = (await createVideoEditProject())!
  editVideoProject(owner.document.id, document => {
    document.media.push({ id: 'audio', name: '声音', kind: 'audio', path: 'D:/voice.wav', durationSeconds: 12, width: 0, height: 0 })
    document.items.push({ id: 'audio-item', name: '声音', kind: 'audio', mediaId: 'audio' })
    document.sequences[0].clips.push({ id: 'voice', itemId: 'audio-item', name: '声音', kind: 'audio', start: 0, duration: 300, track: 0, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' })
    return document
  })
})
afterEach(async () => { useAlertDialogStore.setState({ queue: [] }); await resetAudioEditProjectInstancesForTests(); for (const value of listVideoEditInstances()) await closeVideoEditProject(value.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
const sequence = () => owner.document.sequences[0]
it('native generation timestamps create readable frame/us captions in one undo without ASR or approval', async () => {
  const original = ' 聊天的叫AI，画画的叫AI，配音、做视频的，也叫AI。它们是同一个东西吗？\n不是。它们更像一个剧组，各管一摊。大语言模型，懂文字、会思考；图片模型，只会画；音频模型，只会出声；视频模型，负责让画面动起来。但它们能接力：你说一句话，大语言模型先听懂、拆好任务、写出指令，再交给画图的、配音的、做视频的去干活。所以，AI看着五花八门，真正把这一切串起来的，是那个听得懂人话的——大语言模型。 '
  editVideoProject(owner.document.id, document => { document.media[0].durationSeconds = 60; document.media[0].creativeSource = { type: 'generation', recordId: 'tts-result', outputIndex: 0, prompt: original }; document.sequences[0].clips[0].duration = 1800; return document })
  vi.spyOn(getPlatform().aiRuntime, 'readSavedResult').mockResolvedValue({ status: 'completed', metadata: { outputTimings: [{ outputIndex: 0, timings: { granularity: 'char', items: Array.from(original).map((text, index) => ({ text, startMs: index * 100, endMs: (index + 1) * 100 })) } }] } })
  const past = owner.past.length
  const raw = await handleVideoEditSubtitleCapability('generate_video_edit_subtitles', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence().id}` }, clipRef: { kind: 'video_edit.clip', id: `${owner.document.id}:voice` }, timeSource: 'native' }, { signal: new AbortController().signal })
  const result = generateVideoEditSubtitleCapability.outputSchema.parse(raw)
  expect(result.verified).toBe(true); expect(result.timingSource).toBe('native')
  // 原文换行与首尾空白不进字幕，行内换行来自排版；文字须与原文逐字一致
  const visible = (text: string) => text.replace(/[\s，。,.;；:：—、]/g, '')
  expect(visible(result.captions?.map(value => value.text).join('') ?? '')).toBe(visible(original))
  // 原文开头的空格（0–100ms）不计入字幕时间，首条从第一个可见字开始
  expect(result.captions?.[0]).toMatchObject({ startUs: 100_000, confidence: 1, estimated: false })
  expect(visible(sequence().captions?.map(value => value.text).join('') ?? '')).toBe(visible(original))
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  expect(owner.past.length).toBe(past + 1)
  undoVideoEdit(owner.document.id); expect(sequence().captions ?? []).toHaveLength(0)
})
it('native-only mode rejects missing timings without charging or creating a caption', async () => {
  await expect(generateClipSpeechSubtitles(owner.document.id, sequence().id, 'voice', { originalText: '你好', timeSource: 'native' })).rejects.toThrow('没有原生时间戳')
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
  expect(sequence().captions ?? []).toHaveLength(0)
})
it('仅规范化所选字幕，复用片段范围内同名词的时间，不识别且一步撤销', async () => {
  editVideoProject(owner.document.id, document => { document.media[0].creativeSource = { type: 'generation', recordId: 'existing', outputIndex: 0, prompt: '你好。你好。下一句。' }; return document })
  vi.spyOn(getPlatform().aiRuntime, 'readSavedResult').mockResolvedValue({ status: 'completed', metadata: { outputTimings: [{ outputIndex: 0, timings: { granularity: 'word', items: [
    { text: '你好。', startMs: 0, endMs: 700 }, { text: '你好。', startMs: 2000, endMs: 2700 }, { text: '下一句。', startMs: 4000, endMs: 4700 },
  ] } }] } })
  createVideoEditCaption(owner.document.id, sequence().id, { clipId: 'voice', start: 0, duration: 30, text: '你好。' })
  const selected = createVideoEditCaption(owner.document.id, sequence().id, { clipId: 'voice', start: 60, duration: 30, text: '你好。' })
  createVideoEditCaption(owner.document.id, sequence().id, { clipId: 'voice', start: 120, duration: 30, text: '下一句。' })
  const previous = sequence().captions; const history = owner.past.length
  await segmentVideoEditSubtitles(owner.document.id, sequence().id, {}, [selected])
  expect(sequence().captions).toMatchObject([{ text: '你好。', start: 0, duration: 30 }, { text: '你好', start: 60, duration: 25 }, { text: '下一句。', start: 120, duration: 30 }])
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(owner.document.id); expect(sequence().captions).toEqual(previous)
})
it('片段停顿图免费只读：优先词时间，缺少时使用已有能量检测；clipRef静音路径无需序列转录', async () => {
  editVideoProject(owner.document.id, document => {
    document.media[0].creativeSource = { type: 'generation', recordId: 'tts-pauses', outputIndex: 0, prompt: '你好 世界' }
    document.sequences[0].clips[0].start = 60
    document.sequences[0].clips[0].sourceInUs = 1_000_000
    document.sequences[0].clips[0].speed = { numerator: 2, denominator: 1 }
    document.sequences[0].clips[0].duration = 90
    return document
  })
  const read = vi.spyOn(getPlatform().aiRuntime, 'readSavedResult').mockResolvedValue({ status: 'completed', metadata: { outputTimings: [{ outputIndex: 0, timings: { granularity: 'word', items: [{ text: '你好', startMs: 1000, endMs: 1400 }, { text: '世界', startMs: 1700, endMs: 2100 }] } }] } })
  const app = createApplicationHarness(); const clipRef = { kind: 'video_edit.clip', id: `${owner.document.id}:voice` }
  const before = owner.document; const history = owner.past.length
  try {
    const result = await app.requireResult('get_video_edit_clip_pauses', { clipRef })
    expect(result).toMatchObject({ source: 'words', words: [{ text: '你好', startFrame: 60, endFrame: 66 }, { text: '世界', startFrame: 70, endFrame: 77 }], pauses: [{ startFrame: 66, endFrame: 70 }] })
    expect(getPlatform().audioEdit.detectSilence).not.toHaveBeenCalled()
    read.mockResolvedValue({ status: 'completed' })
    vi.mocked(getPlatform().audioEdit.probeSource).mockResolvedValue({ mediaType: 'audio', sourcePath: 'D:/voice.wav', audioPath: 'D:/voice.wav', sampleRate: 1000, durationFrames: 12000, channels: 1 })
    vi.mocked(getPlatform().audioEdit.detectSilence).mockResolvedValue({ revision: 0, suggestions: [{ id: 'pause', kind: 'long_silence', evidence: 'audio', title: '', detail: '', startFrame: 1400, endFrame: 1700, blockIds: [], confidence: 'high', status: 'pending' }] })
    expect(await app.requireResult('get_video_edit_clip_pauses', { clipRef })).toMatchObject({ source: 'energy', words: [], pauses: [{ startFrame: 66, endFrame: 71, kind: 'silence' }] })
    expect(await app.requireResult('detect_video_edit_text_silence', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence().id}` }, clipRef })).toMatchObject({ changed: false, verified: true, ranges: [{ from: 66, to: 71 }] })
    expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
    expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
  } finally { app.dispose() }
})
it('auto 预检失败在确认前返回零执行事实，native 缺时间戳同样明确未执行', async () => {
  const app = createApplicationHarness()
  const input = { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence().id}` }, clipRef: { kind: 'video_edit.clip', id: `${owner.document.id}:voice` }, originalText: '你好' }
  try {
    vi.mocked(getPlatform().audioEdit.preflightTranscription).mockRejectedValue(new Error('宿主未提供本地文件直传'))
    expect(await app.call('generate_video_edit_subtitles', input)).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true, billing: 'not_charged' } } } })
    expect(await app.call('generate_video_edit_subtitles', { ...input, timeSource: 'native' })).toMatchObject({ ok: false, error: { details: { execution: { notExecuted: true } } } })
    expect(useAlertDialogStore.getState().queue).toHaveLength(0)
    expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
  } finally { app.dispose() }
})
it('识别完成后片段变化保留计费事实和恢复引用，不写字幕、不重复识别', async () => {
  const platform = getPlatform().audioEdit
  const original = vi.mocked(platform.transcribe).getMockImplementation()!
  vi.mocked(platform.transcribe).mockImplementation(async request => {
    const result = await original(request)
    editVideoProject(owner.document.id, doc => { doc.sequences[0].clips[0].start += 1; return doc })
    return result
  })
  const pending = generateClipSpeechSubtitles(owner.document.id, sequence().id, 'voice', { originalText: 'Hello' })
  const failed = pending.catch(error => error as import('@/core/audioEdit/transcriptionFailure').TranscriptionFailure)
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  useAlertDialogStore.getState().confirmCurrent()
  const error = await failed
  expect(error).toMatchObject({ transcriptionFacts: { billing: 'completed', targetMutation: 'none', audioDocumentId: expect.any(String) } })
  const audioDocumentId = (error as import('@/core/audioEdit/transcriptionFailure').TranscriptionFailure).transcriptionFacts.audioDocumentId!
  expect(sequence().captions ?? []).toHaveLength(0)
  await generateClipSpeechSubtitles(owner.document.id, sequence().id, 'voice', { originalText: 'Hello', audioDocumentId })
  expect(platform.transcribe).toHaveBeenCalledTimes(1)
})
it('clipRef 混用 prepare 的混音引用时给出可行动的字段修正，不识别也不弹窗', async () => {
  const audioDocumentId = await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence')
  await expect(generateClipSpeechSubtitles(owner.document.id, sequence().id, 'voice', { originalText: 'Hello', audioDocumentId })).rejects.toThrow('使用 clipRef 时不要传 prepare_video_edit_subtitle_audio 返回的混音文档')
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
})
it('公共调用识别确认通过同一弹窗发布等待事实，拒绝为零执行', async () => {
  const controller = new AbortController()
  const progress = vi.fn().mockImplementation(async progress => progress.phase === 'paid_approval' ? { decision: 'ask', reason: '每次询问', estimatedCny: null, dailySpentCny: 0 } : undefined)
  const unbind = bindApplicationConfirmation(controller.signal, progress)
  const pending = generateClipSpeechSubtitles(owner.document.id, sequence().id, 'voice', { originalText: 'Hello' }, controller.signal)
  const rejected = expect(pending).rejects.toThrow('未执行本次操作')
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'awaiting_user_confirmation' }))
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
  useAlertDialogStore.getState().dismissCurrent()
  await rejected
  expect(sequence().captions ?? []).toHaveLength(0)
  unbind()
})
it('recognition fallback waits for billing confirmation and cancellation never starts ASR', async () => {
  const controller = new AbortController()
  const pending = generateClipSpeechSubtitles(owner.document.id, sequence().id, 'voice', { originalText: '你好' }, controller.signal)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
  controller.abort(); await rejected
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
})
it('confirmed fallback keeps original words and reuses its saved ASR document after undo', async () => {
  vi.mocked(getPlatform().audioEdit.probeSource).mockResolvedValue({ mediaType: 'audio', sourcePath: 'D:/voice.wav', audioPath: 'D:/voice.wav', sampleRate: 1000, channels: 1, durationFrames: 12000 })
  const pending = generateClipSpeechSubtitles(owner.document.id, sequence().id, 'voice', { originalText: 'Hello worlds.' })
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
  useAlertDialogStore.getState().confirmCurrent()
  const result = await pending
  expect(result.timingSource).toBe('recognition')
  expect(result.subtitles.map(value => value.caption.text).join('')).toBe('Hello worlds.')
  expect(result.subtitles.some(value => value.estimated)).toBe(true)
  expect(result.audioDocumentId).toBeTruthy()
  undoVideoEdit(owner.document.id)
  await generateClipSpeechSubtitles(owner.document.id, sequence().id, 'voice', { originalText: 'Hello worlds.', audioDocumentId: result.audioDocumentId })
  expect(getPlatform().audioEdit.transcribe).toHaveBeenCalledTimes(1)
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
})
it('saved word recognition maps through later speed/trim edits and restores from the original mix without paid ASR replay', async () => {
  vi.mocked(getPlatform().audioEdit.transcribe).mockImplementation(async request => {
    const audio = await loadAudioEditProject(request.projectId)
    return { project: { ...audio.document, transcript: [{ id: 'price', text: '价格', startFrame: 1000, endFrame: 1500, included: true, locked: false, granularity: 'word' }] }, modelId: 'test-asr', granularity: 'word' }
  })
  const audioId = await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence')
  const history = owner.past.length
  await generateVideoEditSubtitles(owner.document.id, sequence().id, audioId)
  expect(owner.past.length).toBe(history + 1)
  expect(videoEditTranscriptWords(videoEditComposition(owner.document, sequence().id))).toMatchObject([{ text: '价格', from: 30, to: 45 }])
  const excerpt = editVideoEditText(owner.document.id, sequence().id, { kind: 'text', text: '价格' }, 'extract')
  await restoreVideoEditText(owner.document.id, excerpt.sequenceId, audioId)
  expect(videoEditTranscriptWords(videoEditComposition(owner.document, excerpt.sequenceId))).toMatchObject([{ text: '价格', from: 0, to: 15 }])
  editVideoProject(owner.document.id, document => { document.sequences[0].clips[0] = { ...document.sequences[0].clips[0], sourceInUs: 1000000, duration: 120, speed: { numerator: 2, denominator: 1 } }; return document })
  expect(videoEditTranscriptWords(videoEditComposition(owner.document, sequence().id))).toMatchObject([{ from: 0, to: 8 }])
  await restoreVideoEditText(owner.document.id, sequence().id, audioId)
  expect(videoEditTranscriptWords(videoEditComposition(owner.document, sequence().id))).toMatchObject([{ from: 0, to: 8 }])
  expect(getPlatform().audioEdit.transcribe).toHaveBeenCalledTimes(1)
  editVideoProject(owner.document.id, document => { document.media[0].path = 'D:/replaced.wav'; return document })
  await restoreVideoEditText(owner.document.id, sequence().id, audioId)
  expect(videoEditTranscriptWords(videoEditComposition(owner.document, sequence().id))).toEqual([])
})
it('silence detection restores every saved selection batch and commits once without ASR replay', async () => {
  setVideoEditTimelineView(owner.document.id, { inFrame: 0, outFrame: 90 })
  const first = await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'in-out')
  await generateVideoEditSubtitles(owner.document.id, sequence().id, first)
  setVideoEditTimelineView(owner.document.id, { inFrame: 120, outFrame: 180 })
  const second = await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'in-out')
  await generateVideoEditSubtitles(owner.document.id, sequence().id, second)
  expect(sequence().textTranscription?.audioDocumentIds).toEqual([first, second])
  const detect = vi.spyOn(getPlatform().audioEdit, 'detectSilence').mockImplementation(async request => {
    if (request.projectId === undefined) throw new Error('此路径须检测已保存口播')
    const audio = await loadAudioEditProject(request.projectId)
    return { revision: audio.persistedRevision, suggestions: [{ id: 'pause', kind: 'long_silence', evidence: 'audio', title: '停顿', detail: '', startFrame: 1000, endFrame: 1900, blockIds: [], confidence: 'high', status: 'pending' }] }
  })
  const history = owner.past.length
  await restoreVideoEditText(owner.document.id, sequence().id, second, true)
  expect(detect).toHaveBeenCalledTimes(2); expect(detect.mock.calls.map(([request]) => request.projectId)).toEqual([first, second])
  expect(new Set(detect.mock.calls.map(([request]) => request.requestId)).size).toBe(2)
  expect(resolveVideoEditTextRanges(videoEditComposition(owner.document, sequence().id), { kind: 'silence' })).toEqual([{ from: 35, to: 52 }, { from: 155, to: 172 }])
  expect(owner.past.length).toBe(history + 1); expect(getPlatform().audioEdit.transcribe).toHaveBeenCalledTimes(2)
})
it('分块混音复用渲染器，指定入出点换算后生成一笔历史，恢复不重复付费或重复落位', async () => {
  setVideoEditTimelineView(owner.document.id, { inFrame: 60, outFrame: 150 })
  const history = owner.past.length
  const id = await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'in-out')
  expect(boundary.mixes).toEqual([{ start: 2, duration: 3 }]); expect(boundary.disposed).toHaveBeenCalledTimes(1)
  expect(owner.past).toHaveLength(history)
  const ids = await generateVideoEditSubtitles(owner.document.id, sequence().id, id)
  expect(sequence().captions).toMatchObject([{ id: ids[0], text: 'Hello world.', start: 60, duration: 30 }]); expect(owner.past).toHaveLength(history + 1)
  await generateVideoEditSubtitles(owner.document.id, sequence().id, id)
  expect(sequence().captions).toHaveLength(1); expect(getPlatform().audioEdit.transcribe).toHaveBeenCalledTimes(1)
  undoVideoEdit(owner.document.id); expect(sequence().captions).toBeUndefined()
  await expect(generateVideoEditSubtitles(owner.document.id, sequence().id, id)).rejects.toThrow('已生成后被移除')
})
it('整序列分块、选择范围、静音和错误轨道拒绝均不进入付费识别', async () => {
  expect(subtitleRange(owner, sequence().id, 'sequence')).toEqual({ startFrame: 0, endFrame: 300 })
  await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence')
  expect(boundary.mixes).toEqual([{ start: 0, duration: 5 }, { start: 5, duration: 5 }])
  await expect(prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence', 'missing')).rejects.toMatchObject({ message: expect.stringContaining('移除'), execution: { notExecuted: true } })
  editVideoProject(owner.document.id, doc => { doc.sequences[0].tracks[0].muted = true; return doc })
  await expect(prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence')).rejects.toThrow('可听声音')
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
})
it('NTSC与44.1k混音按绝对采样边界分块，避免按小数帧块累积舍入', async () => {
  editVideoProject(owner.document.id, document => { document.sequences[0].frameRate = { numerator: 30000, denominator: 1001 }; document.sequences[0].sampleRate = 44100; return document })
  await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence')
  expect(boundary.mixes[0]).toEqual({ start: 0, duration: 5 })
  const duration = Math.round(300 * 44100 * 1001 / 30000) / 44100
  expect(boundary.mixes.reduce((total, mix) => total + mix.duration, 0)).toBeCloseTo(duration, 10)
  expect(boundary.mixes[1].start).toBe(5)
})
it('识别等待保持原实例，声音修改后拒绝迟到回填且保留付费识别结果', async () => {
  const id = await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence')
  let release!: () => void; const platform = getPlatform(); const original = vi.mocked(platform.audioEdit.transcribe).getMockImplementation()!
  vi.mocked(platform.audioEdit.transcribe).mockImplementationOnce(async request => { await new Promise<void>(resolve => { release = resolve }); return original(request) })
  const processing = generateVideoEditSubtitles(owner.document.id, sequence().id, id)
  const rejected = expect(processing).rejects.toThrow('已有修改')
  while (!release) await new Promise(resolve => setTimeout(resolve, 0))
  expect(videoEditBusyReason(owner.document.id)).toContain('字幕')
  await expect(closeVideoEditProject(owner.document.id)).rejects.toThrow('字幕')
  editVideoProject(owner.document.id, document => { document.sequences[0].clips[0].volume = .5; return document })
  release(); await rejected
  expect(sequence().captions).toBeUndefined(); expect((await loadAudioEditProject(id)).document.transcript).toHaveLength(1)
  expect(videoEditBusyReason(owner.document.id)).toBeNull()
})
it('字幕保存后恢复记录写入失败，重开仍只核实原字幕、不重复识别或追加历史', async () => {
  const id = await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence')
  let fail = true
  vi.mocked(getPlatform().system.fs.writeTextFile).mockImplementation(async (path, text) => {
    if (fail && path.endsWith('.subtitle.json') && JSON.parse(text).committed) { fail = false; throw new Error('恢复记录暂时不可写') }
    texts.set(path, text)
  })
  await expect(generateVideoEditSubtitles(owner.document.id, sequence().id, id)).rejects.toThrow('不可写')
  const ids = sequence().captions!.map(caption => caption.id)
  owner = await reopenVideoEdit(owner.document.id)
  const history = owner.past.length
  expect(await generateVideoEditSubtitles(owner.document.id, sequence().id, id)).toEqual(ids)
  expect(sequence().captions).toHaveLength(1); expect(owner.past).toHaveLength(history)
  expect(getPlatform().audioEdit.transcribe).toHaveBeenCalledTimes(1)
})
it('首次恢复记录写入失败在识别前清理混音，不创建无法恢复的口播草稿', async () => {
  vi.mocked(getPlatform().system.fs.writeTextFile).mockImplementation(async (path, text) => {
    if (path.endsWith('.subtitle.json')) throw new Error('恢复目录不可写')
    texts.set(path, text)
  })
  await expect(prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence')).rejects.toThrow('不可写')
  expect(files.size).toBe(0)
  expect(await videoEditDocumentOperations().listDocuments({ kind: 'audio_edit', container: owner.session.documentMeta.container, includeDrafts: true, includeMissing: false })).toHaveLength(0)
  expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled(); expect(videoEditBusyReason(owner.document.id)).toBeNull()
})
it('识别提交后的取消阻止落位，已完成识别保存供同一声音引用恢复', async () => {
  const id = await prepareVideoEditSubtitleAudio(owner.document.id, sequence().id, 'sequence')
  let release!: () => void
  const original = vi.mocked(getPlatform().audioEdit.transcribe).getMockImplementation()!
  vi.mocked(getPlatform().audioEdit.transcribe).mockImplementationOnce(async request => { await new Promise<void>(resolve => { release = resolve }); return original(request) })
  const controller = new AbortController()
  const processing = generateVideoEditSubtitles(owner.document.id, sequence().id, id, undefined, {}, controller.signal)
  const rejected = expect(processing).rejects.toThrow('停止字幕')
  while (!release) await new Promise(resolve => setTimeout(resolve, 0))
  controller.abort(new Error('停止字幕')); release(); await rejected
  expect(sequence().captions).toBeUndefined()
  expect((await loadAudioEditProject(id)).document.transcript).toHaveLength(1)
  await generateVideoEditSubtitles(owner.document.id, sequence().id, id)
  expect(sequence().captions).toHaveLength(1); expect(getPlatform().audioEdit.transcribe).toHaveBeenCalledTimes(1)
})
it('字幕拆分合并、通用实体文字写入与样式一笔撤销、重开共用正式状态', async () => {
  appendAutoSubtitles(owner.document.id, sequence().id, [{ id: 'caption', start: 30, duration: 90, text: '甲乙丙丁' }])
  const history = owner.past.length
  splitVideoEditSubtitle(owner.document.id, sequence().id, 'caption', 60, 2)
  expect(sequence().captions?.map(cue => [cue.text, cue.start, cue.duration])).toEqual([['甲乙', 30, 30], ['丙丁', 60, 60]])
  expect(owner.past).toHaveLength(history + 1)
  mergeVideoEditSubtitles(owner.document.id, sequence().id, sequence().captions!.map(cue => cue.id))
  const app = createApplicationHarness()
  try {
    expect(await app.change({ kind: 'video_edit.caption', id: `${owner.document.id}:caption` }, { 'video_edit.caption.style': videoEditSubtitleStyleSchema.parse({ fontFamily: 'serif' }) })).toMatchObject({ ok: true })
    expect(await app.read({ kind: 'video_edit.caption', id: `${owner.document.id}:caption` }, ['video_edit.caption.style'])).toMatchObject({ properties: { 'video_edit.caption.style': { fontFamily: 'serif', strokes: [{ position: 'outside' }] } } })
    undoVideoEdit(owner.document.id)
    expect(await app.change({ kind: 'video_edit.caption', id: `${owner.document.id}:caption` }, { 'video_edit.caption.text': '公共修改', 'video_edit.caption.start': 45 })).toMatchObject({ ok: true })
    expect(sequence().captions![0]).toMatchObject({ text: '公共修改', start: 45 })
    styleVideoEditSubtitles(owner.document.id, sequence().id, videoEditSubtitleStyleSchema.parse({ background: { enabled: true }, fontFamily: 'serif' }))
    expect(sequence().captions![0].style).toMatchObject({ background: { enabled: true } })
    undoVideoEdit(owner.document.id); expect(sequence().captions![0].style).toBeUndefined()
    const reopened = await reopenVideoEdit(owner.document.id); owner = reopened
    expect(sequence().captions![0]).toMatchObject({ text: '公共修改', start: 45 })
  } finally { app.dispose() }
})
it('显式选择序列时钟时SRT保留序列时间，默认与成片一致从入点计时', async () => {
  createVideoEditCaption(owner.document.id, sequence().id, { start: 60, duration: 30, text: '序列字幕' })
  setVideoEditTimelineView(owner.document.id, { inFrame: 60, outFrame: 90 })
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValue('D:/captions.srt')
  expect(await exportVideoEditSubtitles(owner.document.id, 'srt', sequence().id, undefined, 'sequence')).toEqual({ saved: true, verified: true })
  expect(texts.get('D:/captions.srt')).toContain('00:00:02,000 --> 00:00:03,000')
  const app = createApplicationHarness()
  try {
    expect(await app.call('export_video_edit', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, format: 'srt', subtitleClock: 'sequence' })).toMatchObject({ ok: true })
    expect(texts.get('D:/captions.srt')).toContain('00:00:02,000 --> 00:00:03,000')
    await exportVideoEditSubtitles(owner.document.id, 'srt', sequence().id)
    expect(texts.get('D:/captions.srt')).toContain('00:00:00,000 --> 00:00:01,000')
  } finally { app.dispose() }
})
it('费用确认取消不提交识别，取消任务保存稳定声音引用可恢复', async () => {
  const run = runVideoEditSubtitleJob(owner, sequence().id, 'sequence', undefined, {})
  while (!useAlertDialogStore.getState().queue.length) await new Promise(resolve => setTimeout(resolve, 0))
  expect(readSubtitleJob(owner, sequence().id)?.audioDocumentId).toBeTruthy()
  cancelSubtitleJob(owner, sequence().id); await run
  expect(readSubtitleJob(owner, sequence().id)?.state).toBe('cancelled'); expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
})
it('共享文字渲染取消字幕行数上限，文字写入可撤销', () => {
  createVideoEditCaption(owner.document.id, sequence().id, { start: 0, duration: 30, text: '字幕', style: videoEditSubtitleStyleSchema.parse({}) })
  const cue = sequence().captions![0]
  updateVideoEditTimedContent(owner.document.id, sequence().id, 'caption', cue.id, { text: '1\n2\n3\n4' })
  expect(sequence().captions![0].text).toBe('1\n2\n3\n4')
  undoVideoEdit(owner.document.id); expect(sequence().captions![0].text).toBe('字幕')
})

it('正式公共能力准备声音、转录生成与通用回读使用同一注册和领域服务', async () => {
  const app = createApplicationHarness(); const documentRef = { kind: 'video_edit.document', id: owner.document.id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence().id}` }
  try {
    const prepared = await app.requireResult('prepare_video_edit_subtitle_audio', { documentRef, sequenceRef })
    expect(prepared.verified).toBe(true); expect(getPlatform().audioEdit.transcribe).not.toHaveBeenCalled()
    const generated = await app.requireResult('generate_video_edit_subtitles', { documentRef, sequenceRef, audioDocumentRef: prepared.audioDocumentRef, language: 'en' })
    expect(generated.verified).toBe(true); expect(sequence().captions).toHaveLength(1)
    expect(generated.createdCaptionRefs).toHaveLength(1)
    expect(getPlatform().audioEdit.transcribe).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }))
    const refs = generated.captionRefs as Array<{ kind: 'video_edit.caption'; id: string }>
    expect(await app.read(refs[0], ['video_edit.caption.text', 'video_edit.caption.style'])).toMatchObject({ properties: { 'video_edit.caption.text': 'Hello world.', 'video_edit.caption.style': { strokes: [{ position: 'outside' }] } } })
    const resumed = await app.requireResult('generate_video_edit_subtitles', { documentRef, sequenceRef, audioDocumentRef: prepared.audioDocumentRef })
    expect(resumed.createdCaptionRefs).toEqual([])
    expect(await app.call('prepare_video_edit_subtitle_audio', { documentRef, sequenceRef: { kind: 'video_edit.sequence', id: 'other:sequence' } })).toMatchObject({ ok: false })
    expect(getPlatform().audioEdit.transcribe).toHaveBeenCalledTimes(1)
  } finally { app.dispose() }
})

it('整序列字幕能力回执分批覆盖500行，符合公共单条回执引用上限', () => {
  const captionRefs = Array.from({ length: 500 }, (_, index) => ({ kind: 'video_edit.caption' as const, id: `document:caption-${index}` }))
  const output = { documentRef: { kind: 'video_edit.document' as const, id: 'document' }, audioDocumentRef: { kind: 'audio_edit.document' as const, id: 'audio' }, captionRefs, createdCaptionRefs: captionRefs, message: '已生成', verified: true }
  const input = generateVideoEditSubtitleCapability.inputSchema.parse({ documentRef: output.documentRef, sequenceRef: { kind: 'video_edit.sequence', id: 'document:sequence' }, audioDocumentRef: output.audioDocumentRef })
  const effects = generateVideoEditSubtitleCapability.resolveObservedEffects!(input, output)
  expect(effects.every(effect => applicationObservedEffectSchema.safeParse(effect).success)).toBe(true)
  expect(effects.filter(effect => effect.effect === 'create').reduce((count, effect) => count + effect.count, 0)).toBe(500)
})

it('未设置样式的通用回读与schema一致，空字符串可恢复既有默认样式', async () => {
  const id = createVideoEditCaption(owner.document.id, sequence().id, { start: 0, duration: 30, text: '默认字幕' })
  const app = createApplicationHarness(); const ref = { kind: 'video_edit.caption', id: `${owner.document.id}:${id}` }
  try {
    expect(await app.read(ref, ['video_edit.caption.style'])).toMatchObject({ properties: { 'video_edit.caption.style': '' } })
    expect(await app.change(ref, { 'video_edit.caption.style': videoEditSubtitleStyleSchema.parse({}) })).toMatchObject({ ok: true })
    expect(await app.change(ref, { 'video_edit.caption.style': '' })).toMatchObject({ ok: true })
    expect(sequence().captions![0].style).toBe('')
  } finally { app.dispose() }
})

it('AI 付费策略 auto 不弹窗直接识别，预检估值进入同一授权请求并保存字幕', async () => {
  vi.mocked(getPlatform().audioEdit.preflightTranscription).mockResolvedValue({ modelId: 'test-asr', requiresConfirmation: true, cost: { status: 'estimated', amount: .01, currency: 'CNY' } })
  vi.mocked(getPlatform().audioEdit.probeSource).mockResolvedValue({ mediaType: 'audio', sourcePath: 'D:/voice.wav', audioPath: 'D:/voice.wav', sampleRate: 1000, channels: 1, durationFrames: 12000 })
  const controller = new AbortController()
  const progress = vi.fn().mockImplementation(async progress => progress.phase === 'paid_approval' ? { decision: 'auto', reason: '全部放行', estimatedCny: null, dailySpentCny: 0 } : undefined)
  const unbind = bindApplicationConfirmation(controller.signal, progress)
  try {
    await generateClipSpeechSubtitles(owner.document.id, sequence().id, 'voice', { originalText: 'Hello' }, controller.signal)
    expect(getPlatform().audioEdit.preflightTranscription).toHaveBeenCalled()
    expect(getPlatform().audioEdit.transcribe).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'paid_approval', request: expect.objectContaining({ category: 'recognition', estimatedCny: .01 }) }))
    expect(sequence().captions?.map(value => value.text).join('')).toBe('Hello')
    expect(useAlertDialogStore.getState().queue).toHaveLength(0)
    expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'awaiting_user_confirmation' }))
  } finally { unbind() }
})
