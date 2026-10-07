import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { llmChatStream, llmCancelTask } from '@/commands/llmRuntime'
import { DEFAULT_LLM_CAPABILITIES } from '@/core/llm/defaults'
import { videoEditSubtitleStyleSchema, VIDEO_EDIT_SUBTITLE_PRESETS } from '@/core/videoEdit/subtitleStyle'
import { videoEditCaptionClips, exportVideoEditCaptions } from '@/core/videoEdit/timedContent'
import { llmConfigService } from '@/services/llm/LlmConfigService'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { closeVideoEditProject, listVideoEditInstances, undoVideoEdit, videoEditBusyReason, type VideoEditInstance } from './videoEditService'
import { createVideoEditCaption, updateVideoEditTimedContent } from './videoEditTimedContent'
import { createVideoEditSubtitleLibraryStore, useVideoEditSubtitleLibraryStore, applyVideoEditSubtitlePreset, VIDEO_EDIT_SUBTITLE_LIBRARY_STORAGE_KEY } from './videoEditSubtitlePresets'
import { generateVideoEditBilingualSubtitles, confirmVideoEditBilingualSubtitles } from './videoEditBilingualSubtitles'
import { splitVideoEditSubtitle, mergeVideoEditSubtitles, segmentVideoEditSubtitles } from './videoEditAutoSubtitles'
import { translateVideoEditSubtitleCapability } from '@/core/application-control/domains/videoEdit/videoEditSubtitleCapabilities'

vi.mock('@/commands/llmRuntime', async original => ({ ...await original<typeof import('@/commands/llmRuntime')>(), llmChatStream: vi.fn(), llmCancelTask: vi.fn(async () => undefined) }))
let owner: VideoEditInstance
const files = new Map<string, string>()
const trace = { providerId: 'fixture', modelId: 'text', startedAtMs: 0, elapsedMs: 1, inputChars: 4, outputChars: 6 }
const sequence = () => owner.document.sequences[0]
beforeEach(async () => {
  installHarnessNativeStorage(); files.clear(); vi.clearAllMocks()
  useVideoEditSubtitleLibraryStore.setState({ presets: [], loadError: '' })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue(path.resolve(path.sep, 'caption-tests.henji-video'))
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, text) => { files.set(path, text) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(llmConfigService, 'getConfig').mockResolvedValue({
    providers: [{ providerId: 'fixture', displayName: 'Fixture', adapter: 'openai', enabled: true }],
    models: [{ providerId: 'fixture', modelId: 'text', displayName: 'Text', adapter: 'openai', enabled: true, capabilities: DEFAULT_LLM_CAPABILITIES }],
    promptProfiles: [], textProcessingPromptTemplates: [], agentProfiles: [], tools: [], policy: { allowedTools: [], requireHumanConfirmation: false }, memory: {},
  })
  vi.mocked(llmChatStream).mockImplementation(async (request, emit) => {
    const inputs = JSON.parse(request.messages[1].content as string) as Array<{ id: string; text: string }>
    emit({ type: 'Token', data: JSON.stringify(inputs.map(caption => ({ id: caption.id, text: `Translated ${caption.text}` }))) }); emit({ type: 'Done', data: trace })
  })
  owner = (await createVideoEditProject())!
})
afterEach(async () => {
  useAlertDialogStore.setState({ queue: [] })
  for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})

it('本机预设复用版本信封持久保存，重建恢复；存储失败和损坏数据不发布或覆盖', () => {
  const saved = new Map<string, string>()
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) }, removeItem: (key: string) => { saved.delete(key) } }
  const library = createVideoEditSubtitleLibraryStore(storage)
  const style = videoEditSubtitleStyleSchema.parse({ background: true })
  const preset = library.getState().savePreset('本机样式', style)
  style.fontSize = 99
  expect(JSON.parse(saved.get(VIDEO_EDIT_SUBTITLE_LIBRARY_STORAGE_KEY)!)).toMatchObject({ version: 1, state: { presets: [{ name: '本机样式', style: { fontSize: 48 } }] } })
  expect(createVideoEditSubtitleLibraryStore(storage).getState().presets).toEqual([preset])
  const before = library.getState()
  storage.setItem = () => { throw new Error('存储失败') }
  expect(() => library.getState().savePreset('失败', style)).toThrow('存储失败')
  expect(library.getState()).toBe(before)
  storage.setItem = (key, value) => { saved.set(key, value) }
  library.getState().deletePreset(preset.id); expect(createVideoEditSubtitleLibraryStore(storage).getState().presets).toEqual([])
  saved.set(VIDEO_EDIT_SUBTITLE_LIBRARY_STORAGE_KEY, 'corrupt')
  const damaged = createVideoEditSubtitleLibraryStore(storage)
  expect(damaged.getState().loadError).toContain('读取失败')
  expect(() => damaged.getState().savePreset('不能覆盖', style)).toThrow('读取失败')
  expect(saved.get(VIDEO_EDIT_SUBTITLE_LIBRARY_STORAGE_KEY)).toBe('corrupt')
})

it('内置及本机样式批量应用一笔历史，不把预设库存入剪辑；失败无部分应用', () => {
  const a = createVideoEditCaption(owner.document.id, sequence().id, { start: 0, duration: 30, text: '第一条' })
  const b = createVideoEditCaption(owner.document.id, sequence().id, { start: 30, duration: 30, text: '第二条' })
  const history = owner.past.length
  applyVideoEditSubtitlePreset(owner.document.id, sequence().id, 'builtin:variety')
  expect(sequence().captions?.every(caption => caption.style && caption.style.fontSize === 80)).toBe(true)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(owner.document.id); expect(sequence().captions?.every(caption => !caption.style)).toBe(true)
  const preset = useVideoEditSubtitleLibraryStore.getState().savePreset('自定义底框', videoEditSubtitleStyleSchema.parse({ background: true }))
  applyVideoEditSubtitlePreset(owner.document.id, sequence().id, preset.id, [a, b])
  expect(owner.past).toHaveLength(history + 1)
  expect(JSON.stringify(owner.document)).not.toContain('自定义底框')
  const baseline = owner.document
  expect(() => applyVideoEditSubtitlePreset(owner.document.id, sequence().id, preset.id, [a, 'missing'])).toThrow('移除')
  expect(owner.document).toBe(baseline)
  undoVideoEdit(owner.document.id); expect(sequence().captions?.every(caption => !caption.style)).toBe(true)
})

it('助手发现四种内置和本机预设，经通用样式事务批量应用，一步撤销与UI相同', async () => {
  const ids = [0, 30].map(start => createVideoEditCaption(owner.document.id, sequence().id, { start, duration: 30, text: '字幕' }))
  const preset = useVideoEditSubtitleLibraryStore.getState().savePreset('保存的样式', videoEditSubtitleStyleSchema.parse({ fontSize: 64 }))
  const app = createApplicationHarness()
  try {
    const listed = await app.requireResult('list_application_entities', { entityType: 'video_edit.subtitle_preset', limit: 20 })
    expect(listed.refs).toHaveLength(VIDEO_EDIT_SUBTITLE_PRESETS.length + 1)
    const read = await app.read({ kind: 'video_edit.subtitle_preset', id: preset.id }, ['video_edit.subtitle_preset.style'])
    const history = owner.past.length
    await app.requireResult('change_application_entities', { summary: '批量套用字幕样式', changes: ids.map(id => ({ kind: 'set_properties', entityType: 'video_edit.caption', target: { kind: 'video_edit.caption', id: `${owner.document.id}:${id}` }, properties: { 'video_edit.caption.style': (read.properties as Record<string, unknown>)['video_edit.subtitle_preset.style'] } })) })
    expect(sequence().captions?.every(caption => caption.style && caption.style.fontSize === 64)).toBe(true)
    expect(owner.past).toHaveLength(history + 1)
    undoVideoEdit(owner.document.id); expect(sequence().captions?.every(caption => !caption.style)).toBe(true)
  } finally { app.dispose() }
})

it('双语复用文本模型，批次全部完成才一次写入；保留原文时刻，烧录与SRT一致，一步撤销', async () => {
  const ids = Array.from({ length: 25 }, (_, index) => createVideoEditCaption(owner.document.id, sequence().id, { start: index * 30, duration: 30, text: `原文${index}` }))
  const original = sequence().captions; const history = owner.past.length
  expect(await generateVideoEditBilingualSubtitles(owner.document.id, sequence().id, { targetLanguage: 'en' })).toEqual(ids)
  expect(llmChatStream).toHaveBeenCalledTimes(3)
  expect(owner.past).toHaveLength(history + 1)
  expect(sequence().captions![0]).toMatchObject({ start: 0, duration: 30, text: '原文0', translation: 'Translated 原文0' })
  expect(videoEditCaptionClips(sequence(), 0)[0].graphic?.objects.filter(object => object.name === '字幕文字').map(object => object.parameters.text)).toEqual(['原文0', 'Translated 原文0'])
  expect(exportVideoEditCaptions(sequence())).toContain('原文0\nTranslated 原文0')
  undoVideoEdit(owner.document.id); expect(sequence().captions).toEqual(original)
})

it('翻译失败、缺失对应项或未完成流不留下部分译文，模型不可用与超行原文在付费前拒绝', async () => {
  Array.from({ length: 13 }, (_, index) => createVideoEditCaption(owner.document.id, sequence().id, { start: index * 30, duration: 30, text: `原文${index}` }))
  const baseline = owner.document
  const successfulBatch = vi.mocked(llmChatStream).getMockImplementation()!
  vi.mocked(llmChatStream).mockImplementationOnce(successfulBatch).mockImplementationOnce(async (_request, emit) => { emit({ type: 'Token', data: '[]' }); emit({ type: 'Done', data: trace }) })
  await expect(generateVideoEditBilingualSubtitles(owner.document.id, sequence().id, { targetLanguage: 'en' })).rejects.toThrow()
  expect(owner.document).toBe(baseline)
  vi.mocked(llmChatStream).mockClear()
  vi.mocked(llmChatStream).mockImplementationOnce(async (_request, emit) => { emit({ type: 'Token', data: '[]' }); emit({ type: 'Done', data: trace }) })
  await expect(generateVideoEditBilingualSubtitles(owner.document.id, sequence().id, { targetLanguage: 'en' })).rejects.toThrow()
  expect(owner.document).toBe(baseline)
  vi.mocked(llmChatStream).mockImplementationOnce(async (_request, emit) => { emit({ type: 'Token', data: '[]' }) })
  await expect(generateVideoEditBilingualSubtitles(owner.document.id, sequence().id, { targetLanguage: 'en' })).rejects.toThrow('未完整返回')
  expect(owner.document).toBe(baseline)
  await expect(generateVideoEditBilingualSubtitles(owner.document.id, sequence().id, { targetLanguage: 'en', modelId: 'missing' })).rejects.toThrow('文本模型')
  expect(llmChatStream).toHaveBeenCalledTimes(2)
  updateVideoEditTimedContent(owner.document.id, sequence().id, 'caption', sequence().captions![0].id, { text: '一\n二\n三' })
  await expect(generateVideoEditBilingualSubtitles(owner.document.id, sequence().id, { targetLanguage: 'en' })).rejects.toThrow('原文单行')
  expect(llmChatStream).toHaveBeenCalledTimes(2)
})

it('双语取消传给现有LLM取消入口，任务期间旧字幕被改拒绝迟到写入', async () => {
  const id = createVideoEditCaption(owner.document.id, sequence().id, { start: 0, duration: 30, text: '原文' })
  let finish!: () => void
  vi.mocked(llmChatStream).mockImplementation(async (_request, emit) => { await new Promise<void>(resolve => { finish = resolve }); emit({ type: 'Token', data: JSON.stringify([{ id, text: 'Hello' }]) }); emit({ type: 'Done', data: trace }) })
  const controller = new AbortController()
  const task = generateVideoEditBilingualSubtitles(owner.document.id, sequence().id, { targetLanguage: 'en' }, controller.signal)
  const failed = expect(task).rejects.toThrow('取消翻译')
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0))
  expect(videoEditBusyReason(owner.document.id)).not.toBeNull()
  controller.abort(new Error('取消翻译')); finish(); await failed
  expect(llmCancelTask).toHaveBeenCalledTimes(1); expect(sequence().captions![0].translation).toBeUndefined()
  expect(videoEditBusyReason(owner.document.id)).toBeNull()
  const late = generateVideoEditBilingualSubtitles(owner.document.id, sequence().id, { targetLanguage: 'en' })
  const lateFailed = expect(late).rejects.toThrow('已有修改')
  finish = undefined as unknown as () => void
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0))
  updateVideoEditTimedContent(owner.document.id, sequence().id, 'caption', id, { text: '手工新文字' })
  finish(); await lateFailed
  expect(sequence().captions![0]).toMatchObject({ text: '手工新文字' }); expect(sequence().captions![0].translation).toBeUndefined()
})

it('手动双语先费用确认，取消不调用LLM；助手能力按R2，经公共入口保存并通用读写译文', async () => {
  const id = createVideoEditCaption(owner.document.id, sequence().id, { start: 0, duration: 30, text: '原文' })
  const confirmation = confirmVideoEditBilingualSubtitles(owner.document.id, sequence().id, { targetLanguage: 'en' })
  expect(useAlertDialogStore.getState().queue).toHaveLength(1)
  useAlertDialogStore.getState().dismissCurrent(); await confirmation
  expect(llmChatStream).not.toHaveBeenCalled()
  expect(translateVideoEditSubtitleCapability.risk).toBe('R2')
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('translate_video_edit_subtitles', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence().id}` }, targetLanguage: 'en' })
    expect(result.verified).toBe(true)
    const ref = { kind: 'video_edit.caption', id: `${owner.document.id}:${id}` }
    expect(await app.read(ref, ['video_edit.caption.translation'])).toMatchObject({ properties: { 'video_edit.caption.translation': 'Translated 原文' } })
    expect(await app.change(ref, { 'video_edit.caption.translation': 'Corrected' })).toMatchObject({ ok: true })
    expect(sequence().captions![0].translation).toBe('Corrected')
    expect(await app.change(ref, { 'video_edit.caption.translation': '' })).toMatchObject({ ok: true })
    expect(sequence().captions![0].translation).toBe('')
  } finally { app.dispose() }
})

it('手动拆分和合并双语保留两份文本，译文按词边界比例拆分', () => {
  const id = createVideoEditCaption(owner.document.id, sequence().id, { start: 0, duration: 60, text: '甲乙丙丁', translation: 'Hello beautiful world', style: videoEditSubtitleStyleSchema.parse({}) })
  splitVideoEditSubtitle(owner.document.id, sequence().id, id, 30, 2)
  expect(sequence().captions?.map(caption => [caption.text, caption.translation])).toEqual([['甲乙', 'Hello beautiful'], ['丙丁', 'world']])
  mergeVideoEditSubtitles(owner.document.id, sequence().id, sequence().captions!.map(caption => caption.id))
  expect(sequence().captions).toMatchObject([{ text: '甲乙\n丙丁', translation: 'Hello beautiful world', duration: 60 }])
})

it('已有长句免费整理，原引用保留第一段、比例分配时间，一步撤销；助手整理与UI走同一入口', async () => {
  const id = createVideoEditCaption(owner.document.id, sequence().id, { start: 30, duration: 60, text: '甲乙丙丁戊己庚辛' })
  const history = owner.past.length
  const result = segmentVideoEditSubtitles(owner.document.id, sequence().id, { maxCharacters: 4, maxLines: 1 })
  expect(result.createdIds).toHaveLength(1)
  expect(sequence().captions).toMatchObject([{ id, text: '甲乙丙丁', start: 30, duration: 30 }, { text: '戊己庚辛', start: 60, duration: 30 }])
  expect(owner.past).toHaveLength(history + 1); expect(llmChatStream).not.toHaveBeenCalled()
  undoVideoEdit(owner.document.id)
  const app = createApplicationHarness()
  try {
    const output = await app.requireResult('segment_video_edit_subtitles', { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequence().id}` }, maxCharacters: 4, maxLines: 1 })
    expect(output.verified).toBe(true); expect(output.createdCaptionRefs).toHaveLength(1)
    expect(owner.past).toHaveLength(history + 1)
    expect(sequence().captions?.map(caption => [caption.text, caption.start, caption.duration])).toEqual([['甲乙丙丁', 30, 30], ['戊己庚辛', 60, 30]])
    const unchanged = segmentVideoEditSubtitles(owner.document.id, sequence().id, { maxCharacters: 4, maxLines: 1 })
    expect(unchanged.createdIds).toEqual([]); expect(unchanged.updatedIds).toEqual([])
    expect(owner.past).toHaveLength(history + 1)
  } finally { app.dispose() }
})
