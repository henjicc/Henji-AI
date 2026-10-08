// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits, savedVideoEdit, reopenVideoEdit } from './videoEditDocumentTestKit'
import { applyStyleKitToSequence, applyStyleKitToClips, captureVideoEditStyleSample, extractVideoEditWorkStyle, checkStyleKit, styleKitHostSummary } from './videoEditStyleKits'
import { insertVideoEditStyleSample } from './videoEditStyleSamples'
import { VideoEditStyleKitLibrary, videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'
import { VideoEditLocalLibrary } from './videoEditLocalLibrary'
import { BUILTIN_STYLE_KITS, availableStyleKitFonts } from '@/core/videoEdit/styleKitPresets'
import { styleKitContent } from '@/core/videoEdit/styleKit'
import { undoVideoEdit, saveVideoEdit, editVideoProject } from './videoEditService'
import { releaseVideoEditCodeCompiler } from './videoEditCodeState'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { evaluateCodeMaterial } from '@/core/videoEdit/codeMaterial/evaluate'
import { measureCodeText } from '../videoEditGlyphMetrics'
import { createVideoEditCodeItems } from './videoEditCodeService'
import { appendVideoEditItems } from './videoEditProjectItems'
const trial = vi.hoisted(() => ({ fail: false, documents: [] as VideoEditComposition[] }))
vi.mock('../engine/videoEditCodeCompiler', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  return { VideoEditCodeCompiler: class { async compile(source: string) { return compileCodeMaterial(source) } dispose() {} } }
})
vi.mock('../engine/videoEditRenderSession', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  const { resolveVideoEditStyleKit } = await import('@/core/videoEdit/styleKit')
  return { VideoEditRenderSession: class {
    constructor(private document: VideoEditComposition) {}
    setTracks() {}
    async updateDocument(document: VideoEditComposition) { this.document = document }
    async present(frame: number) {
      if (trial.fail) throw new Error('试绘失败')
      trial.documents.push(this.document)
      for (const clip of this.document.clips) if (clip.code) {
        const version = this.document.codeMaterials!.find(value => value.id === clip.code!.definitionId)!.versions.find(value => value.id === clip.code!.versionId)!
        const program = compileCodeMaterial(version.source); const time = (frame - clip.start) / this.document.fps
        evaluateCodeMaterial(program, { time, localTime: time, sequenceTime: frame / this.document.fps, width: program.width, height: program.height, frame, fps: this.document.fps, style: resolveVideoEditStyleKit(this.document, this.document, clip)?.tokens }, clip.code.parameters, { measureText: measureCodeText })
      }
      return { presented: true, bitmap: { close() {} } }
    }
    async dispose() {}
  } }
})
beforeEach(() => { installHarnessNativeStorage(); videoEditStyleKitLibrary.replace([]); trial.fail = false; trial.documents = []; vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } }) })
afterEach(async () => { await closeAllVideoEdits(); releaseVideoEditCodeCompiler(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
const available = () => availableStyleKitFonts(BUILTIN_STYLE_KITS[0], [])
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
it('序列应用可撤销，主进程外层保存/重新打开保留风格快照；本机库独立', async () => {
  const owner = await createVideoEditTestProject(); const history = owner.past.length
  const value = applyStyleKitToSequence(owner.document.id, owner.activeSequenceId, available())
  expect(owner.past).toHaveLength(history + 1); expect(styleKitHostSummary(owner.document.id, owner.activeSequenceId).summary).toContain('read_application_entity')
  await saveVideoEdit(owner.document.id)
  expect(savedVideoEdit(owner).styleKits).toEqual([value])
  const reopened = await reopenVideoEdit(owner.document.id)
  expect(reopened.document.styleKits).toEqual([value]); expect(reopened.document.sequences[0].styleKitId).toBe(value.id)
  const personal = videoEditStyleKitLibrary.save(value); videoEditStyleKitLibrary.remove(personal.id)
  expect(reopened.document.styleKits).toEqual([value])
  const next = applyStyleKitToSequence(reopened.document.id, reopened.activeSequenceId, { ...value, name: '新版' })
  expect(next.revision).toBe(value.revision + 1); undoVideoEdit(reopened.document.id); expect(reopened.document.styleKits).toEqual([value])
})
it('组件真实编译/求值、试绘、绑定与落位一次发布；失败不留下素材与风格', async () => {
  const owner = await createVideoEditTestProject(); const before = owner.document; const history = owner.past.length
  trial.fail = true
  await expect(insertVideoEditStyleSample(owner.document.id, owner.activeSequenceId, available(), 'title')).rejects.toThrow('试绘失败')
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
  trial.fail = false
  const ids = await insertVideoEditStyleSample(owner.document.id, owner.activeSequenceId, available(), 'title')
  expect(ids).toHaveLength(1); expect(owner.past).toHaveLength(history + 1)
  expect(trial.documents.every(document => document.styleKitId && document.styleKits?.length)).toBe(true)
  const captured = captureVideoEditStyleSample(owner.document.id, owner.activeSequenceId, available()); expect(captured.samples).toHaveLength(4)
  undoVideoEdit(owner.document.id); expect(owner.document.items).toEqual(before.items); expect(owner.document.styleKits).toEqual(before.styleKits)
})
it('通用实体创建/绑定/改内容、候选提取和插入能力通过正式注册、保存与回执', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; const app = createApplicationHarness()
  try {
    expect((await app.requireResult('list_application_entities', { entityType: 'video_edit.style_preset', limit: 20 })).refs).toHaveLength(6)
    const content = styleKitContent(available())
    await app.requireResult('change_application_entities', { summary: '创建风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style_kit', parent: { kind: 'video_edit.document', id }, items: [{ properties: { 'video_edit.style_kit.name': '新风格', 'video_edit.style_kit.content': content } }] }] })
    const kit = owner.document.styleKits![0]; const ref = { kind: 'video_edit.style_kit', id: `${id}:${kit.id}` }; const seqRef = { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }
    expect((await app.change(seqRef, { 'video_edit.sequence.style_kit_id': kit.id })).ok).toBe(true)
    expect((await app.change(ref, { 'video_edit.style_kit.content': { ...content, rules: '标题不用衬线体' } })).ok).toBe(true)
    expect(owner.document.styleKits![0].rules).toBe('标题不用衬线体')
    const snapshot = owner.document
    const candidate = await app.requireResult('extract_video_edit_work_style', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: seqRef })
    expect(candidate).toHaveProperty('content.tokens'); expect(owner.document).toBe(snapshot)
    const inserted = await app.requireResult('insert_video_edit_style_component', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: seqRef, styleRef: ref, sampleId: 'data', frame: 10 })
    expect(inserted.verified).toBe(true); expect(savedVideoEdit(owner).sequences[0].clips).toHaveLength(1)
    const clip = owner.document.sequences[0].clips[0]; const other = applyStyleKitToClips(id, owner.activeSequenceId, availableStyleKitFonts(BUILTIN_STYLE_KITS[1], []), [clip.id])
    expect(owner.document.sequences[0].clips[0].styleKitId).toBe(other.id); expect(owner.document.sequences[0].styleKitId).toBe(kit.id)
    expect((await app.change({ kind: 'video_edit.clip', id: `${id}:${clip.id}` }, { 'video_edit.clip.style_kit_id': '' })).ok).toBe(true)
    expect(owner.document.sequences[0].clips[0].styleKitId).toBeUndefined()
    const presetRef = { kind: 'video_edit.style_preset', id: 'builtin:style:0' }
    expect((await app.change(presetRef, { 'video_edit.style_preset.name': '禁止覆盖' })).ok).toBe(false)
    expect((await app.call('change_application_entities', { summary: '删除仍使用的风格', changes: [{ kind: 'remove_items', entityType: ref.kind, parent: { kind: 'video_edit.document', id }, targets: [ref] }] })).ok).toBe(false)
  } finally { app.dispose() }
})
it('作品提取是候选，取消不写；无效样例在编译/求值时阻断保存', async () => {
  const owner = await createVideoEditTestProject(); const before = owner.document
  const value = await extractVideoEditWorkStyle(owner.document.id, owner.activeSequenceId, '候选')
  expect(value.name).toBe('候选'); expect(owner.document).toBe(before)
  await expect(extractVideoEditWorkStyle(owner.document.id, owner.activeSequenceId, '取消', AbortSignal.abort())).rejects.toThrow()
  const sample = available().samples[0]; const invalid = { ...available(), samples: [{ ...sample, source: sample.source.replace('s.typeScale.xl * ctx.height', '1 / ctx.time') }] }
  await expect(checkStyleKit(invalid)).rejects.toThrow()
  editVideoProject(owner.document.id, document => ({ ...document, name: '候选不会改这份工程' }))
})
it('参数声明区分贝塞尔与RGBA：缓动四元组不取色，组件颜色字段可以取色', async () => {
  for (const useColor of [false, true]) {
    const owner = await createVideoEditTestProject()
    const src = `export default {apiVersion:1,languageVersion:3,name:"取色契约",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:10,seed:1,types:{light:{title:"灯光",layout:"row",fields:{color:{type:"color",title:"颜色",default:[1,0,0,1]}}}},parameters:{bg:{type:"easing",title:"缓动",default:[.25,0,.75,1]},range:{type:"range",title:"区间",min:0,max:1,step:.01,default:[0,1]}${useColor ? ',lamp:{type:"light",title:"主光",default:{}}' : ''}},render(ctx){return [];}}`
    const items = await createVideoEditCodeItems(owner.document.id, [{ source: src }])
    appendVideoEditItems(owner.document.id, items, owner.activeSequenceId)
    const result = await extractVideoEditWorkStyle(owner.document.id, owner.activeSequenceId, '参数取色')
    if (useColor) expect(result.tokens.palette).not.toEqual(BUILTIN_STYLE_KITS[0].tokens.palette)
    else expect(result.tokens.palette).toEqual(BUILTIN_STYLE_KITS[0].tokens.palette)
  }
})
