import { testCodeSource, testFilesSource } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits, savedVideoEdit, reopenVideoEdit } from './videoEditDocumentTestKit'
import { applyStyleKitToSequence, captureVideoEditStyleExample, checkStyleKit, copyStyleKit, styleKitHostSummary } from './videoEditStyleKits'
import { VideoEditStyleKitLibrary, videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'
import { VideoEditLocalLibrary } from './videoEditLocalLibrary'
import { BUILTIN_STYLE_KITS } from '@/core/videoEdit/styleKitPresets'
import { composeStyleGuide, parseStyleGuide, styleKitContent } from '@/core/videoEdit/styleKit'
import { undoVideoEdit, saveVideoEdit, updateVideoEditCreativeIntents } from './videoEditService'
import { releaseVideoEditCodeCompiler } from './videoEditCodeState'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { createVideoEditCodeItems } from './videoEditCodeService'
import { appendVideoEditItems } from './videoEditProjectItems'
const trial = vi.hoisted(() => ({ fail: false, documents: [] as VideoEditComposition[], beforeCompile: undefined as (() => void) | undefined }))
vi.mock('../engine/videoEditCodeCompiler', async () => {
 const { testAuthorBundle } = await import('../engine/videoEditAuthorTestFixtures')
 return { VideoEditCodeCompiler: class { async bundleQueued(files: import('@/core/videoEdit/codeMaterial/sources').CodeMaterialFiles) { trial.beforeCompile?.(); return testAuthorBundle(files) } dispose() {} } }
})
vi.mock('./videoEditAuthorInspection', async () => {
 const { testAuthorProgram } = await import('../engine/videoEditAuthorTestFixtures')
 return { inspectVideoEditAuthor: async (bundle: import('@/core/videoEdit/codeAuthorProgram').CodeAuthorBundle) => testAuthorProgram(bundle) }
})
vi.mock('../engine/videoEditRenderSession', async () => {
  const { testAuthorBundle, testAuthorProgram } = await import('../engine/videoEditAuthorTestFixtures')
  return { VideoEditRenderSession: class {
    constructor(private document: VideoEditComposition) {}
    setTracks() {}
    async updateDocument(document: VideoEditComposition) { this.document = document }
    async replaceContent(document: VideoEditComposition) { this.document = document }
    async present(_frame: number) {
      if (trial.fail) throw new Error('试绘失败')
      trial.documents.push(this.document)
      for (const clip of this.document.clips) if (clip.code) {
        const version = this.document.codeMaterials!.find(value => value.id === clip.code!.definitionId)!.versions.find(value => value.id === clip.code!.versionId)!
        testAuthorProgram(testAuthorBundle(testCodeSource(this.document, version)))
      }
      return { presented: true, bitmap: { close() {} } }
    }
    async dispose() {}
  } }
})
beforeEach(() => { installHarnessNativeStorage(); videoEditStyleKitLibrary.replace([]); trial.fail = false; trial.documents = []; trial.beforeCompile = undefined; vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } }) })
afterEach(async () => { await closeAllVideoEdits(); releaseVideoEditCodeCompiler(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
const available = () => copyStyleKit({ ...BUILTIN_STYLE_KITS[0], examples: [{ id: 'fixture', title: '测试参考', note: '', source: 'export default {name:"测试参考",draw(){}}' }] })
it('公共风格校验期间仅写元数据不使文档快照校验失效', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; const app = createApplicationHarness()
  trial.beforeCompile = () => updateVideoEditCreativeIntents(id, { drafts: [], sessions: [], resources: [] })
  try {
    await app.requireResult('change_application_entities', { summary: '创建风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style_kit', parent: { kind: 'video_edit.document', id }, items: [{ properties: { 'video_edit.style_kit.name': '并发风格', 'video_edit.style_kit.content': styleKitContent(available()) } }] }] })
    expect(owner.document.styleKits).toHaveLength(1)
    expect(owner.document.creativeIntents).toEqual({ drafts: [], sessions: [], resources: [] })
  } finally { app.dispose() }
})
it('本机库复用存储服务：坏盘保护、落盘先于发布、磁盘失败不改内存、无条目上限', () => {
  const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const publish = vi.fn(); const library = new VideoEditStyleKitLibrary(storage, publish)
  const saved = library.save(available()); const reopened = new VideoEditStyleKitLibrary(storage, publish)
  expect(reopened.custom()).toEqual([saved]); expect(publish).toHaveBeenCalledTimes(1)
  storage.setItem = () => { throw new Error('disk') }
  expect(() => library.remove(saved.id)).toThrow('disk'); expect(library.custom()).toEqual([saved])
  const raw = '{损坏'; const set = vi.fn(); const broken = new VideoEditStyleKitLibrary({ getItem: () => raw, setItem: set }, publish)
  expect(broken.loadError()).toBeTruthy(); expect(() => broken.save(available())).toThrow(); expect(set).not.toHaveBeenCalled()
  const large = new VideoEditLocalLibrary('numbers', z.array(z.number()), { getItem: () => null, setItem: vi.fn() }, vi.fn()); large.replace(Array.from({ length: 10000 }, (_, i) => i)); expect(large.custom()).toHaveLength(10000)
})
it('绑定序列可撤销、不改时间线；宿主上下文给出整份说明书；保存/重新打开保留快照，本机库独立', async () => {
  const owner = await createVideoEditTestProject(); const history = owner.past.length; const clips = owner.document.sequences[0].clips
  const value = applyStyleKitToSequence(owner.document.id, owner.activeSequenceId, available())
  expect(owner.past).toHaveLength(history + 1); expect(owner.document.sequences[0].clips).toEqual(clips)
  const summary = styleKitHostSummary(owner.document.id, owner.activeSequenceId)
  expect(summary.ref).toContain(value.id); expect(summary.summary).toContain('## 必须'); expect(summary.summary).toContain('只学手法不照搬'); expect(summary.summary).not.toContain('```ts')
  await saveVideoEdit(owner.document.id)
  expect(savedVideoEdit(owner).styleKits).toEqual([value])
  const reopened = await reopenVideoEdit(owner.document.id)
  expect(reopened.document.styleKits).toEqual([value]); expect(reopened.document.sequences[0].styleKitId).toBe(value.id)
  const personal = videoEditStyleKitLibrary.save(value); videoEditStyleKitLibrary.remove(personal.id)
  expect(reopened.document.styleKits).toEqual([value])
  const next = applyStyleKitToSequence(reopened.document.id, reopened.activeSequenceId, { ...value, name: '新版' })
  expect(next.revision).toBe(value.revision + 1); undoVideoEdit(reopened.document.id); expect(reopened.document.styleKits).toEqual([value])
})
it('所选代码片段加为参考示例，未选代码时明确拒绝', async () => {
  const owner = await createVideoEditTestProject()
  expect(() => captureVideoEditStyleExample(owner.document.id, owner.activeSequenceId, available())).toThrow('请先在时间线上选择一个代码片段')
  const items = await createVideoEditCodeItems(owner.document.id, [{ source: 'export default {name:"测试画面",width:1920,height:1080,durationSeconds:3,draw(){}}' }])
  appendVideoEditItems(owner.document.id, items, owner.activeSequenceId)
  owner.selection = owner.document.sequences[0].clips.at(-1)!.id
  const captured = captureVideoEditStyleExample(owner.document.id, owner.activeSequenceId, available())
  expect(captured.examples).toHaveLength(available().examples.length + 1); expect(captured.examples.at(-1)!.note).toBe('')
  await expect(checkStyleKit(captured)).resolves.toBeTruthy()
})
it('通用实体创建/绑定/整体改写说明书，缺章节被点名拒绝，内置只读，仍被使用的风格不能删除', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; const app = createApplicationHarness()
  try {
    expect((await app.requireResult('list_application_entities', { entityType: 'video_edit.style_preset', limit: 20 })).refs).toHaveLength(1)
    const content = styleKitContent(available())
    await app.requireResult('change_application_entities', { summary: '创建风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style_kit', parent: { kind: 'video_edit.document', id }, items: [{ properties: { 'video_edit.style_kit.name': '新风格', 'video_edit.style_kit.content': content } }] }] })
    const kit = owner.document.styleKits![0]; const ref = { kind: 'video_edit.style_kit', id: `${id}:${kit.id}` }; const seqRef = { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }
    expect((await app.change(seqRef, { 'video_edit.sequence.style_kit_id': kit.id })).ok).toBe(true)
    const guide = composeStyleGuide(parseStyleGuide(content.guide).map(section => section.title === '避免' ? { ...section, body: `${section.body}\n- 标题用衬线体` } : section))
    expect((await app.change(ref, { 'video_edit.style_kit.content': { ...content, guide } })).ok).toBe(true)
    expect(owner.document.styleKits![0].guide).toContain('- 标题用衬线体')
    const missing = await app.change(ref, { 'video_edit.style_kit.content': { guide: '## 定位\n只写了定位', examples: [] } })
    expect(missing.ok).toBe(false); expect(JSON.stringify(missing)).toContain('核心理念')
    const presetRef = { kind: 'video_edit.style_preset', id: BUILTIN_STYLE_KITS[0].id }
    expect((await app.change(presetRef, { 'video_edit.style_preset.name': '禁止覆盖' })).ok).toBe(false)
    expect((await app.call('change_application_entities', { summary: '删除仍使用的风格', changes: [{ kind: 'remove_items', entityType: ref.kind, parent: { kind: 'video_edit.document', id }, targets: [ref] }] })).ok).toBe(false)
  } finally { app.dispose() }
})
it('无效参考示例在编译/求值时阻断保存', async () => {
  const example = available().examples[0]; const broken = testFilesSource(example.source) + '{'
  expect(broken).not.toBe(testFilesSource(example.source))
  await expect(checkStyleKit({ ...available(), examples: [{ ...example, source: broken }] })).rejects.toThrow()
})
