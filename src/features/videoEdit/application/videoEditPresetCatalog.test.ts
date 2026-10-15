// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { testCodeSource } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useSettingsStore } from '@/stores/settingsStore'
import { videoEditTextStyleSchema } from '@/core/videoEdit/text'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'
import { videoEditTextPresetLibrary } from './videoEditTextPresets'
import { videoEditPresetPreferences } from './videoEditPresetPreferences'
import { deleteVideoEditPreset, exportVideoEditPresetPackage, importVideoEditPresetPackage, listVideoEditPresets, preferredVideoEditPreset, setVideoEditPresetDefault, setVideoEditPresetRating, videoEditPresetHostSummary, videoEditPresetSource } from './videoEditPresetCatalog'
import { appendVideoEditSequence, requireVideoEditInstance } from './videoEditService'
import { createVideoEditCaption } from './videoEditTimedContent'
import { presetPreviewTimeline } from './videoEditPresetPreview'
import { releaseVideoEditCodeCompiler } from './videoEditCodeState'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { BLACK_HEX } from '@/core/theme/colorTokens'

const trial = vi.hoisted(() => ({ documents: [] as VideoEditComposition[], frames: [] as number[] }))
vi.mock('../engine/videoEditCodeCompiler', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  return { VideoEditCodeCompiler: class { async compile(source: string) { return compileCodeMaterial(source) } dispose() {} } }
})
vi.mock('../engine/videoEditRenderSession', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  const { evaluateCodeMaterial } = await import('@/core/videoEdit/codeMaterial/evaluate')
  const { measureCodeText } = await import('../videoEditGlyphMetrics')
  return { VideoEditRenderSession: class {
    constructor(private document: VideoEditComposition) {}
    async updateDocument(document: VideoEditComposition) { this.document = document }
    async present(frame: number) {
      trial.documents.push(this.document); trial.frames.push(frame)
      // Real compile and evaluation of every code clip proves the preview documents are valid inputs.
      for (const clip of this.document.clips) if (clip.code) {
        const version = this.document.codeMaterials!.find(value => value.id === clip.code!.definitionId)!.versions.find(value => value.id === clip.code!.versionId)!
        const program = compileCodeMaterial(testCodeSource(this.document, version)); const time = Math.max(0, (frame - clip.start) / this.document.fps)
        evaluateCodeMaterial(program, { time, localTime: time, sequenceTime: frame / this.document.fps, width: program.width, height: program.height, frame, fps: this.document.fps }, clip.code.parameters, { measureText: measureCodeText })
      }
      return { presented: true, bitmap: { close() {}, width: 320, height: 180 } }
    }
    async dispose() {}
  } }
})
beforeEach(() => {
  installHarnessNativeStorage(); videoEditStyleKitLibrary.replace([]); videoEditTextPresetLibrary.replace([]); videoEditPresetPreferences.replace([]); trial.documents = []; trial.frames = []
  useSettingsStore.getState().setVideoEditDefaultTransition('video', null)
  vi.stubGlobal('OffscreenCanvas', class { width: number; height: number; constructor(width: number, height: number) { this.width = width; this.height = height } getContext() { return { font: '', drawImage() {}, measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } async convertToBlob() { return new Blob(['frame']) } })
})
afterEach(async () => { await closeAllVideoEdits(); releaseVideoEditCodeCompiler(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('默认排第一，其余按喜爱程度排序；未设默认的类别推荐评分最高的', () => {
  setVideoEditPresetRating('title', 'title:chapter', 4); setVideoEditPresetRating('title', 'title:callout', 2)
  let titles = listVideoEditPresets('title')
  expect(titles.slice(0, 2).map(entry => entry.id)).toEqual(['title:chapter', 'title:callout'])
  expect(titles.filter(entry => entry.recommended).map(entry => entry.id)).toEqual(['title:chapter'])
  expect(preferredVideoEditPreset('title')?.id).toBe('title:chapter')
  setVideoEditPresetDefault('title', 'title:callout'); titles = listVideoEditPresets('title')
  expect(titles[0]).toMatchObject({ id: 'title:callout', isDefault: true }); expect(titles.find(entry => entry.recommended)?.id).toBe('title:chapter')
  expect(preferredVideoEditPreset('title')?.id).toBe('title:callout')
  expect(videoEditPresetHostSummary()).toContain('标题：默认“强调标注框”，最喜欢“章节标题”（4 星）')
  expect(() => setVideoEditPresetDefault('effect', 'missing')).toThrow('NOT_FOUND')
  // Transition default is the existing default-transition setting, not a second copy.
  setVideoEditPresetDefault('transition', 'wipe'); expect(useSettingsStore.getState().videoEditDefaultTransitions.video).toBe('wipe')
  expect(listVideoEditPresets('transition')[0]).toMatchObject({ id: 'wipe', isDefault: true })
})
it('默认风格自动套到新建序列，默认文字样式用于新字幕', async () => {
  const owner = await createVideoEditTestProject(); const projectId = owner.document.id
  setVideoEditPresetDefault('style', BUILTIN_STYLE_KITS[1].id)
  const first = appendVideoEditSequence(projectId); const second = appendVideoEditSequence(projectId)
  const document = requireVideoEditInstance(projectId).document
  const bound = document.sequences.filter(sequence => [first, second].includes(sequence.id)).map(sequence => sequence.styleKitId)
  expect(bound[0]).toBeTruthy(); expect(bound[1]).toBe(bound[0]); expect(document.styleKits).toHaveLength(1)
  expect(document.styleKits![0].name).toBe(BUILTIN_STYLE_KITS[1].name)
  const custom = videoEditTextPresetLibrary.save('大号黄字', videoEditTextStyleSchema.parse({ fontSize: 72, fill: { enabled: true, color: BLACK_HEX } }))
  setVideoEditPresetDefault('text', custom.id)
  const caption = createVideoEditCaption(projectId, first, { start: 0, duration: 30, text: '默认样式' })
  expect(requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === first)!.captions!.find(cue => cue.id === caption)!.style).toMatchObject({ fontSize: 72 })
})
it('导出再导入得到新的个人预设；内置不能删除，删除个人预设同时清掉评分与默认', () => {
  const kit = videoEditStyleKitLibrary.save({ ...BUILTIN_STYLE_KITS[0], id: 'mine', name: '我的风格' })
  const text = videoEditTextPresetLibrary.save('我的字幕', videoEditTextStyleSchema.parse({}))
  setVideoEditPresetRating('style', kit.id, 5); setVideoEditPresetDefault('style', kit.id)
  const file = exportVideoEditPresetPackage([{ category: 'style', id: kit.id }, { category: 'text', id: text.id }])
  const added = importVideoEditPresetPackage(file)
  expect(added.map(value => [value.category, value.name])).toEqual([['style', '我的风格 2'], ['text', '我的字幕 2']])
  expect(added.every(value => value.id !== kit.id && value.id !== text.id)).toBe(true)
  expect(listVideoEditPresets('style').find(entry => entry.id === added[0].id)).toMatchObject({ rating: 0, isDefault: false })
  expect(() => importVideoEditPresetPackage('{"format":"other"}')).toThrow('不是痕迹AI剪辑预设')
  expect(() => importVideoEditPresetPackage('not json')).toThrow('不是可读取')
  expect(() => deleteVideoEditPreset('style', BUILTIN_STYLE_KITS[0].id)).toThrow('内置预设不能删除')
  deleteVideoEditPreset('style', kit.id)
  expect(videoEditPresetPreferences.custom()).toEqual([]); expect(listVideoEditPresets('style').some(entry => entry.id === kit.id)).toBe(false)
  expect(() => exportVideoEditPresetPackage([{ category: 'transition', id: 'wipe' }])).toThrow('不需要导出')
})
it('通用实体读写评分与默认，可撤销；效果没有默认；省略模板时标题用默认模板', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.preset', id: 'title:title:lower_third' }
    const change = await app.change(ref, { 'video_edit.preset.rating': 5, 'video_edit.preset.is_default': true })
    expect(change.ok, JSON.stringify(change)).toBe(true)
    const read = await app.read(ref, ['video_edit.preset.rating', 'video_edit.preset.is_default', 'video_edit.preset.source_ref']) as { properties: Record<string, unknown> }
    expect(read.properties).toEqual({ 'video_edit.preset.rating': 5, 'video_edit.preset.is_default': true, 'video_edit.preset.source_ref': 'video_edit.title_template:title:lower_third' })
    expect((await app.change(ref, { 'video_edit.preset.rating': 9 })).ok).toBe(false)
    const outcome = await app.requireResult('apply_video_edit_title_template', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }, frame: 0 }) as { clipRefs: unknown[] }
    expect(outcome.clipRefs.length).toBeGreaterThan(0)
    expect(requireVideoEditInstance(id).document.sequences[0].clips.some(clip => clip.name === '下三分之一人名条')).toBe(true)
    const listed = await app.requireResult('list_application_entities', { entityType: 'video_edit.preset', limit: 200 }) as { refs: Array<{ id: string }> }
    expect(listed.refs.some(value => value.id === 'transition:cross_dissolve')).toBe(true)
  } finally { app.dispose() }
})
it('预设预览时间线：风格依次播放参考示例，转场两段相接', async () => {
  const style = await presetPreviewTimeline(videoEditPresetSource('style', BUILTIN_STYLE_KITS[2].id), { width: 320, height: 180 })
  // A style shows its reference examples back to back over the shared footage: three examples, three seconds each.
  expect(style.composition.clips.filter(clip => clip.code).length).toBe(4); expect(style.composition.captions ?? []).toEqual([]); expect(style.frames).toBe(270)
  const transition = await presetPreviewTimeline(videoEditPresetSource('transition', 'push'), { width: 320, height: 180 })
  expect(transition.composition.transitions?.[0]).toMatchObject({ kind: 'push' })
})
