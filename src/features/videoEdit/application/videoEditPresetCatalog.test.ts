// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { testCodeSource } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useSettingsStore } from '@/stores/settingsStore'
import { videoEditTextStyleSchema } from '@/core/videoEdit/text'
import { VIDEO_EDIT_PRESET_PACKAGE_VERSION } from '@/core/videoEdit/presetPackage'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { videoEditStyleLibrary } from './videoEditStyleLibrary'
// 新建序列套默认风格的钩子由风格服务安装。
import './videoEditStyles'
import { createTestStyleLibraryIo } from './videoEditStyleTestKit'
import { videoEditTextPresetLibrary } from './videoEditTextPresets'
import { videoEditPresetPreferences } from './videoEditPresetPreferences'
import { deleteVideoEditPreset, exportVideoEditPresetPackage, importVideoEditPresetPackage, listVideoEditPresets, preferredVideoEditPreset, setVideoEditPresetDefault, setVideoEditPresetRating, videoEditPresetHostSummary, videoEditPresetSource } from './videoEditPresetCatalog'
import { appendVideoEditSequence, requireVideoEditInstance } from './videoEditService'
import { createVideoEditCaption } from './videoEditTimedContent'
import { presetPreviewTimeline } from './videoEditPresetPreview'
import { releaseVideoEditCodeCompiler } from './videoEditCodeState'
import { BLACK_HEX } from '@/core/theme/colorTokens'

const trial = vi.hoisted(() => ({ documents: [] as VideoEditComposition[], frames: [] as number[] }))
vi.mock('../engine/videoEditCodeCompiler', async () => {
 const { testAuthorBundle } = await import('../engine/videoEditAuthorTestFixtures')
 return { VideoEditCodeCompiler: class { async bundleQueued(files: import('@/core/videoEdit/codeMaterial/sources').CodeMaterialFiles) { return testAuthorBundle(files) } dispose() {} } }
})
vi.mock('./videoEditAuthorInspection', async () => {
 const { testAuthorProgram } = await import('../engine/videoEditAuthorTestFixtures')
 return { inspectVideoEditAuthor: async (bundle: import('@/core/videoEdit/codeAuthorProgram').CodeAuthorBundle) => testAuthorProgram(bundle) }
})
vi.mock('../engine/videoEditRenderSession', async () => {
  const { testAuthorBundle, testAuthorProgram } = await import('../engine/videoEditAuthorTestFixtures')
  return { VideoEditRenderSession: class {
    constructor(private document: VideoEditComposition) {}
    async updateDocument(document: VideoEditComposition) { this.document = document }
    async present(frame: number) {
      trial.documents.push(this.document); trial.frames.push(frame)
      // Real compile and evaluation of every code clip proves the preview documents are valid inputs.
      for (const clip of this.document.clips) if (clip.code) {
        const version = this.document.codeMaterials!.find(value => value.id === clip.code!.definitionId)!.versions.find(value => value.id === clip.code!.versionId)!
        testAuthorProgram(testAuthorBundle(testCodeSource(this.document, version)))
      }
      return { presented: true, bitmap: { close() {}, width: 320, height: 180 } }
    }
    async dispose() {}
  } }
})
let io: ReturnType<typeof createTestStyleLibraryIo>
beforeEach(() => {
  installHarnessNativeStorage(); io = createTestStyleLibraryIo(); videoEditStyleLibrary.reset(io, undefined)
  videoEditTextPresetLibrary.replace([]); videoEditPresetPreferences.replace([]); trial.documents = []; trial.frames = []
  useSettingsStore.getState().setVideoEditDefaultTransition('video', null)
  vi.stubGlobal('OffscreenCanvas', class { width: number; height: number; constructor(width: number, height: number) { this.width = width; this.height = height } getContext() { return { font: '', drawImage() {}, measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } async convertToBlob() { return new Blob(['frame']) } })
})
afterEach(async () => { await closeAllVideoEdits(); releaseVideoEditCodeCompiler(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage(); io.dispose() })

it('默认排第一，其余按喜爱程度排序；未设默认的类别推荐评分最高的；风格与标题不再出现在预设面板', () => {
  const first = videoEditTextPresetLibrary.save('甲', videoEditTextStyleSchema.parse({})); const second = videoEditTextPresetLibrary.save('乙', videoEditTextStyleSchema.parse({}))
  setVideoEditPresetRating('text', second.id, 4); setVideoEditPresetRating('text', first.id, 2)
  const custom = listVideoEditPresets('text').filter(entry => !entry.builtin)
  expect(custom.map(entry => entry.id)).toEqual([second.id, first.id])
  expect(listVideoEditPresets('text').filter(entry => entry.recommended).map(entry => entry.id)).toEqual([second.id])
  expect(preferredVideoEditPreset('text')?.id).toBe(second.id)
  setVideoEditPresetDefault('text', first.id)
  expect(listVideoEditPresets('text')[0]).toMatchObject({ id: first.id, isDefault: true }); expect(preferredVideoEditPreset('text')?.id).toBe(first.id)
  expect(videoEditPresetHostSummary()).toContain('文字：默认“甲”，最喜欢“乙”（4 星）')
  expect(listVideoEditPresets('style')).toEqual([]); expect(listVideoEditPresets('title')).toEqual([])
  expect(() => setVideoEditPresetDefault('effect', 'missing')).toThrow('NOT_FOUND')
  // Transition default is the existing default-transition setting, not a second copy.
  setVideoEditPresetDefault('transition', 'wipe'); expect(useSettingsStore.getState().videoEditDefaultTransitions.video).toBe('wipe')
  expect(listVideoEditPresets('transition')[0]).toMatchObject({ id: 'wipe', isDefault: true })
})
it('默认风格自动套到新建序列（工程里复制一份副本并复用），默认文字样式用于新字幕', async () => {
  await videoEditStyleLibrary.ready()
  const owner = await createVideoEditTestProject(); const projectId = owner.document.id
  await videoEditStyleLibrary.setDefaultStyle('restrained')
  const first = appendVideoEditSequence(projectId); const second = appendVideoEditSequence(projectId)
  const document = requireVideoEditInstance(projectId).document
  const bound = document.sequences.filter(sequence => [first, second].includes(sequence.id)).map(sequence => sequence.styleId)
  expect(bound).toEqual(['restrained', 'restrained']); expect(document.styles).toHaveLength(1)
  expect(document.styles![0]).toMatchObject({ name: '克制高级', version: videoEditStyleLibrary.requireStyle('restrained').style.version })
  const custom = videoEditTextPresetLibrary.save('大号黄字', videoEditTextStyleSchema.parse({ fontSize: 72, fill: { enabled: true, color: BLACK_HEX } }))
  setVideoEditPresetDefault('text', custom.id)
  const caption = createVideoEditCaption(projectId, first, { start: 0, duration: 30, text: '默认样式' })
  expect(requireVideoEditInstance(projectId).document.sequences.find(sequence => sequence.id === first)!.captions!.find(cue => cue.id === caption)!.style).toMatchObject({ fontSize: 72 })
})
it('导出再导入得到新的个人预设；内置不能删除；旧文件里的风格与标题条目转进风格库', async () => {
  const text = videoEditTextPresetLibrary.save('我的字幕', videoEditTextStyleSchema.parse({}))
  setVideoEditPresetRating('text', text.id, 5)
  const file = exportVideoEditPresetPackage([{ category: 'text', id: text.id }])
  const added = await importVideoEditPresetPackage(file)
  expect(added.map(value => [value.category, value.name])).toEqual([['text', '我的字幕 2']])
  expect(listVideoEditPresets('text').find(entry => entry.id === added[0].id)).toMatchObject({ rating: 0, isDefault: false })
  await expect(importVideoEditPresetPackage('{"format":"other"}')).rejects.toThrow('不是痕迹AI剪辑预设')
  await expect(importVideoEditPresetPackage('not json')).rejects.toThrow('不是可读取')
  expect(() => deleteVideoEditPreset('transition', 'wipe')).toThrow('内置预设不能删除')
  deleteVideoEditPreset('text', text.id)
  expect(videoEditPresetPreferences.custom()).toEqual([])
  expect(() => exportVideoEditPresetPackage([{ category: 'transition', id: 'wipe' }])).toThrow('不需要导出')
  // 2026-10-22 之前导出的文件：说明书风格与标题模板（内置类型与自建组合）。
  const legacy = { format: 'henji-video-presets', version: VIDEO_EDIT_PRESET_PACKAGE_VERSION, items: [
    { category: 'style', preset: { id: 'old', name: '旧风格', revision: 2, guide: '## 定位\n冷静的科技片\n\n## 必须\n只用一种强调色\n\n## 画面生成提示\n冷色调', examples: [] } },
    { category: 'title', preset: { id: 'title:lower_third', kind: 'lower_third', name: '下三分之一人名条', parameters: { text: '姓名', subtitle: '职务' } } },
  ] }
  const converted = await importVideoEditPresetPackage(JSON.stringify(legacy))
  expect(converted.map(value => value.category)).toEqual(['style', 'title'])
  const style = videoEditStyleLibrary.requireStyle(converted[0].id).style
  expect(style).toMatchObject({ name: '旧风格', version: 3 })
  expect(style.guide).toContain('冷静的科技片'); expect(style.guide).toContain('硬约束（原“必须”）'); expect(style.guide).toContain('## 画面生成提示')
  const template = videoEditStyleLibrary.requireTemplate(converted[1].id).template
  expect(template.body.kind).toBe('native')
  expect(JSON.stringify(template.body)).toContain('姓名')
})
it('通用实体读写评分与默认；效果没有默认；风格与标题类别已移出', async () => {
  await createVideoEditTestProject(); const app = createApplicationHarness()
  try {
    const text = videoEditTextPresetLibrary.save('通用实体', videoEditTextStyleSchema.parse({}))
    const ref = { kind: 'video_edit.preset', id: `text:${text.id}` }
    const change = await app.change(ref, { 'video_edit.preset.rating': 5, 'video_edit.preset.is_default': true })
    expect(change.ok, JSON.stringify(change)).toBe(true)
    const read = await app.read(ref, ['video_edit.preset.rating', 'video_edit.preset.is_default']) as { properties: Record<string, unknown> }
    expect(read.properties).toEqual({ 'video_edit.preset.rating': 5, 'video_edit.preset.is_default': true })
    expect((await app.change(ref, { 'video_edit.preset.rating': 9 })).ok).toBe(false)
    await expect(app.change({ kind: 'video_edit.preset', id: 'style:restrained' }, { 'video_edit.preset.rating': 1 })).rejects.toThrow('ENTITY_NOT_FOUND')
    const listed = await app.requireResult('list_application_entities', { entityType: 'video_edit.preset', limit: 200 }) as { refs: Array<{ id: string }> }
    expect(listed.refs.some(value => value.id === 'transition:cross_dissolve')).toBe(true)
    expect(listed.refs.some(value => value.id.startsWith('style:') || value.id.startsWith('title:'))).toBe(false)
  } finally { app.dispose() }
})
it('预设预览时间线：风格只放样片代码，转场两段相接', async () => {
  await videoEditStyleLibrary.ready()
  const sample = videoEditStyleLibrary.requireStyle('restrained').style.sample
  const style = await presetPreviewTimeline({ category: 'style', sample }, { width: 320, height: 180 })
  expect(style.composition.clips.filter(clip => clip.code).length).toBe(1); expect(style.frames).toBe(Math.round(sample.durationSeconds * 30)); expect(style.poster).toBe(Math.round(sample.thumbnail * 30))
  const transition = await presetPreviewTimeline(videoEditPresetSource('transition', 'push'), { width: 320, height: 180 })
  expect(transition.composition.transitions?.[0]).toMatchObject({ kind: 'push' })
})
