import { refreshMemory } from '@/features/assistant/memory/memoryService'
// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { testCodeSource } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { STYLE_GUIDE_SECTIONS } from '@/core/videoEdit/styles/styleGuide'
import { videoEditStyleContentHash } from '@/core/videoEdit/styles/styleSchemas'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits, savedVideoEdit } from './videoEditDocumentTestKit'
import { videoEditStyleLibrary } from './videoEditStyleLibrary'
import { addTestTitleTemplate, createTestStyleLibraryIo } from './videoEditStyleTestKit'
import { videoEditPresetPreferences } from './videoEditPresetPreferences'
import { exportVideoEditStylePackage, importVideoEditStylePackage, type VideoEditStylePackageIo } from './videoEditStylePackages'
import { videoEditStyleHostSummary } from './videoEditStyles'
import { applyVideoEditTemplate, createVideoEditTemplate, detachVideoEditTemplateInstances, promoteVideoEditTemplate, updateVideoEditTemplate, videoEditTemplateInstances } from './videoEditTemplates'
import { createVideoEditCodeItems } from './videoEditCodeService'
import { editVideoProject, requireVideoEditInstance, undoVideoEdit } from './videoEditService'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { readVideoEditCodeMetadata, releaseVideoEditCodeCompiler } from './videoEditCodeState'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'

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
    async replaceContent(document: VideoEditComposition) { this.document = document }
    async present() {
      for (const clip of this.document.clips) if (clip.code) {
        const version = this.document.codeMaterials!.find(value => value.id === clip.code!.definitionId)!.versions.find(value => value.id === clip.code!.versionId)!
        testAuthorProgram(testAuthorBundle(testCodeSource(this.document, version)))
      }
      return { presented: true, bitmap: { close() {}, width: 320, height: 180 } }
    }
    async dispose() {}
  } }
})
const CARD = `export default { name: "档案人名条", kind: "generator", mode: "dynamic", durationSeconds: 4,
  params: [{ key: "name", type: "text", title: "姓名", default: "林一", maxLength: 40, layer: "card" }],
  layers(params, width, height) { return [{ id: "card", bounds: [0, 0, width, height], draw(ctx) { ctx.fillStyle = "${BLACK_HEX}"; ctx.fillRect(0, 0, width, height) } }] } }
`
let io: ReturnType<typeof createTestStyleLibraryIo>
beforeEach(async () => {
  installHarnessNativeStorage(); await refreshMemory(); io = createTestStyleLibraryIo(); videoEditStyleLibrary.reset(io, undefined); videoEditPresetPreferences.replace([])
  vi.stubGlobal('OffscreenCanvas', class { width: number; height: number; constructor(width: number, height: number) { this.width = width; this.height = height } getContext() { return { font: '', drawImage() {}, measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } async convertToBlob() { return new Blob(['frame']) } })
})
afterEach(async () => { await closeAllVideoEdits(); releaseVideoEditCodeCompiler(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage(); io.dispose() })

it('内置六套风格随资源分发：顺序、说明书栏目齐全、已渲染且没有待更新', async () => {
  await videoEditStyleLibrary.ready()
  const styles = videoEditStyleLibrary.listStyles()
  expect(styles.map(entry => entry.style.id)).toEqual(['restrained', 'tech-info', 'explainer', 'variety', 'promo', 'warm-documentary'])
  for (const entry of styles) {
    expect(entry.builtin).toBe(true); expect(entry.stale, entry.style.id).toBe(false)
    expect(entry.media.preview && entry.media.thumbnail).toBeTruthy(); expect(entry.media.anchors).toHaveLength(entry.style.sample.anchors.length)
    for (const spec of STYLE_GUIDE_SECTIONS) expect(entry.style.guide, `${entry.style.id} ${spec.title}`).toContain(`## ${spec.title}`)
    const code = entry.style.sample.code.files[entry.style.sample.code.entry]
    expect(code).toContain('kind: "generator"'); expect(code).not.toMatch(/document\.|window\./)
  }
  await expect(videoEditStyleLibrary.saveStyle({ ...styles[0].style, name: '改内置' })).rejects.toThrow('内置风格只读')
})

it('通用实体：创建个人风格自带说明书栏目与标准样片，改说明书不升版本，默认风格可读写，内置拒绝修改', async () => {
  const owner = await createVideoEditTestProject(); const parent = { kind: 'video_edit.document', id: owner.document.id }; const app = createApplicationHarness()
  try {
    const created = await app.requireResult('change_application_entities', { summary: '新建风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style', parent, items: [{ properties: { 'video_edit.style.name': '节点光迹', 'video_edit.style.description': '中性节点与绿色信号' } }] }] }) as { resultRefs: Array<{ kind: string; id: string }> }
    const ref = created.resultRefs.find(value => value.kind === 'video_edit.style')!
    const read = await app.read(ref, ['video_edit.style.guide', 'video_edit.style.version', 'video_edit.style.missing_sections', 'video_edit.style.sample']) as { properties: Record<string, unknown> }
    expect(read.properties['video_edit.style.version']).toBe(0)
    expect(read.properties['video_edit.style.guide']).toContain('# 节点光迹')
    expect((read.properties['video_edit.style.missing_sections'] as string[]).length).toBe(STYLE_GUIDE_SECTIONS.length)
    expect(JSON.stringify(read.properties['video_edit.style.sample'])).toContain('风格样片')
    expect((await app.change(ref, { 'video_edit.style.guide': '# 节点光迹\n\n## 定位\n给 AI 工作流讲解用。', 'video_edit.style.is_default': true })).ok).toBe(true)
    expect(videoEditStyleLibrary.requireStyle(ref.id)).toMatchObject({ stale: true, style: { version: 0 } })
    expect(videoEditStyleLibrary.defaultStyleId()).toBe(ref.id)
    expect((await app.change({ kind: 'video_edit.style', id: 'restrained' }, { 'video_edit.style.name': '改名' })).ok).toBe(false)
    expect((await app.change({ kind: 'video_edit.style', id: 'restrained' }, { 'video_edit.style.is_default': true })).ok).toBe(true)
    expect(videoEditStyleLibrary.defaultStyleId()).toBe('restrained')
    // 风格文件确实落在风格库目录里，删除只删个人风格。
    expect(fs.existsSync(path.join(await io.root(), 'styles', ref.id, 'style.json'))).toBe(true)
    await app.requireResult('change_application_entities', { summary: '删除风格', changes: [{ kind: 'remove_items', entityType: 'video_edit.style', parent, targets: [ref] }] }, (await app.read(ref, ['video_edit.style.name'])).revisions as Record<string, number>)
    expect(videoEditStyleLibrary.findStyle(ref.id)).toBeUndefined()
  } finally { app.dispose() }
})

it('库模板：内容变了版本加 1，只改名称或所属风格不升；风格删除后成员模板保留', async () => {
  await videoEditStyleLibrary.ready()
  const style = (await videoEditStyleLibrary.saveStyle({ ...videoEditStyleLibrary.requireStyle('restrained').style, id: 'mine', name: '我的风格' })).style
  const body = { kind: 'code' as const, code: { entry: 'index.js', files: { 'index.js': CARD } } }
  let template = (await videoEditStyleLibrary.saveTemplate({ id: 'card', name: '档案人名条', description: '', version: 1, contentHash: '', updatedAt: new Date().toISOString(), style: { id: style.id, version: style.version }, body })).template
  expect(template.version).toBe(1); expect(template.contentHash).toMatch(/^[a-f0-9]{64}$/)
  template = (await videoEditStyleLibrary.saveTemplate({ ...template, name: '人名条' })).template; expect(template.version).toBe(1)
  template = (await videoEditStyleLibrary.saveTemplate({ ...template, body: { ...body, code: { ...body.code, files: { 'index.js': CARD.replace('林一', '林二') } } } })).template; expect(template.version).toBe(2)
  expect(videoEditStyleLibrary.listTemplates('mine').map(value => value.template.id)).toEqual(['card'])
  await videoEditStyleLibrary.removeStyle('mine')
  expect(videoEditStyleLibrary.requireTemplate('card').template.style).toBeNull()
})

it('风格包往返：导出带说明书、样片、成员模板与预览，导入只解析和保存，标记为导入，冲突要确认覆盖', async () => {
  await videoEditStyleLibrary.ready()
  const source = videoEditStyleLibrary.requireStyle('restrained')
  await videoEditStyleLibrary.saveStyle({ ...source.style, id: 'shared', name: '分享风格' }, await videoEditStyleLibrary.readStyleMedia('restrained'))
  await videoEditStyleLibrary.saveTemplate({ id: 'shared-card', name: '人名条', description: '', version: 1, contentHash: '', updatedAt: new Date().toISOString(), style: { id: 'shared', version: 3 }, body: { kind: 'code', code: { entry: 'index.js', files: { 'index.js': CARD } } } })
  const files = new Map<string, string>()
  const fileIo: VideoEditStylePackageIo = { read: async file => files.get(file)!, write: async (file, text) => { files.set(file, text) }, exists: async file => files.has(file) }
  const exported = await exportVideoEditStylePackage('shared', 'D:/out/分享风格.henjistyle', {}, fileIo)
  expect(exported.templates).toHaveLength(1); expect(exported.bytes).toBeGreaterThan(100_000)
  await expect(exportVideoEditStylePackage('shared', 'D:/out/分享风格.henjistyle', {}, fileIo)).rejects.toThrow('已存在')
  await expect(exportVideoEditStylePackage('shared', 'D:/out/分享风格.json', {}, fileIo)).rejects.toThrow('.henjistyle')
  const text = files.get('D:/out/分享风格.henjistyle')!
  expect(JSON.parse(text)).toMatchObject({ version: 2, minReaderVersion: 1, content: { format: 'henji-video-style', style: { id: 'shared', version: 3 } } })
  // 另一台机器：全新风格库。
  const other = createTestStyleLibraryIo(); videoEditStyleLibrary.reset(other, undefined)
  try {
    const imported = await importVideoEditStylePackage('D:/out/分享风格.henjistyle', {}, fileIo)
    expect(imported.style).toMatchObject({ id: 'shared', version: 3, imported: true, contentHash: source.style.contentHash })
    const entry = videoEditStyleLibrary.requireStyle('shared')
    expect(entry.stale).toBe(false); expect(entry.media.anchors).toHaveLength(5)
    expect(fs.readFileSync(entry.media.preview!).equals(fs.readFileSync(source.media.preview!))).toBe(true)
    expect(videoEditStyleLibrary.requireTemplate('shared-card').template).toMatchObject({ imported: true, style: { id: 'shared' } })
    await expect(importVideoEditStylePackage('D:/out/分享风格.henjistyle', {}, fileIo)).rejects.toThrow('replace')
    expect((await importVideoEditStylePackage('D:/out/分享风格.henjistyle', { replace: true }, fileIo)).replaced).toBe(true)
    files.set('D:/bad.henjistyle', text.replace('"format":"henji-video-style"', '"format":"other"'))
    await expect(importVideoEditStylePackage('D:/bad.henjistyle', {}, fileIo)).rejects.toThrow('风格包内容无效')
    files.set('D:/newer.henjistyle', JSON.stringify({ version: 9, minReaderVersion: 9, content: {} }))
    await expect(importVideoEditStylePackage('D:/newer.henjistyle', {}, fileIo)).rejects.toThrow('更新版本')
    // 导出内置风格再导入：与内置同一标识时另起标识，不覆盖内置。
    videoEditStyleLibrary.reset(io, undefined)
    await exportVideoEditStylePackage('restrained', 'D:/out/克制.henjistyle', {}, fileIo)
    videoEditStyleLibrary.reset(other, undefined)
    const copy = await importVideoEditStylePackage('D:/out/克制.henjistyle', {}, fileIo)
    expect(copy.style.id).not.toBe('restrained'); expect(videoEditStyleLibrary.requireStyle('restrained').builtin).toBe(true)
  } finally { other.dispose() }
})

it('绑定风格：复制进工程并绑定，换风格与降级要确认，库里更新后提示并可升级；宿主上下文给出说明书与默认风格', async () => {
  await videoEditStyleLibrary.ready()
  const owner = await createVideoEditTestProject(); const projectId = owner.document.id; const app = createApplicationHarness()
  const documentRef = { kind: 'video_edit.document', id: projectId }; const sequenceRef = { kind: 'video_edit.sequence', id: `${projectId}:${owner.activeSequenceId}` }
  try {
    expect(videoEditStyleHostSummary(projectId, owner.activeSequenceId).summary).toContain('没有默认风格')
    const bound = await app.requireResult('bind_video_edit_style', { documentRef, sequenceRef, styleRef: { kind: 'video_edit.style', id: 'restrained' } }) as { version: number; verification: { verified: boolean } }
    expect(bound).toMatchObject({ version: 3, verification: { verified: true } })
    expect(savedVideoEdit(owner)).toMatchObject({ styles: [{ id: 'restrained', version: 3 }], sequences: [{ styleId: 'restrained' }] })
    const summary = videoEditStyleHostSummary(projectId, owner.activeSequenceId)
    expect(summary).toMatchObject({ ref: `video_edit.project_style:${projectId}:restrained`, version: 3 }); expect(summary.summary).toContain('## 不变量与自由度')
    const conflict = await app.call('bind_video_edit_style', { documentRef, sequenceRef, styleRef: { kind: 'video_edit.style', id: 'variety' } })
    expect(JSON.stringify(conflict)).toContain('replace:true')
    // 风格库里同一风格更新到 v4：工程副本只提示，绑定同一风格即升级。
    const personal = await videoEditStyleLibrary.saveStyle({ ...videoEditStyleLibrary.requireStyle('restrained').style, id: 'restrained-plus', name: '克制增强' })
    await app.requireResult('bind_video_edit_style', { documentRef, sequenceRef, styleRef: { kind: 'video_edit.style', id: 'restrained-plus' }, replace: true })
    await videoEditStyleLibrary.saveStyle({ ...personal.style, version: 4 })
    const copy = await app.read({ kind: 'video_edit.project_style', id: `${projectId}:restrained-plus` }, ['video_edit.project_style.version', 'video_edit.project_style.library_version'])
    expect(copy.properties).toEqual({ 'video_edit.project_style.version': 3, 'video_edit.project_style.library_version': 4 })
    expect(videoEditStyleHostSummary(projectId, owner.activeSequenceId).summary).toContain('已更新到 v4')
    const upgraded = await app.requireResult('bind_video_edit_style', { documentRef, sequenceRef, styleRef: { kind: 'video_edit.style', id: 'restrained-plus' } }) as { upgraded: boolean; version: number }
    expect(upgraded).toMatchObject({ upgraded: true, version: 4 })
    // 取消绑定走通用属性。
    expect((await app.change(sequenceRef, { 'video_edit.sequence.style_id': '' })).ok).toBe(true)
    expect(requireVideoEditInstance(projectId).document.sequences[0].styleId).toBeUndefined()
  } finally { app.dispose() }
})

it('原生模板：固化所选文字图形，应用出联动实例；更新内容时各实例保留文字一起刷新；分离后不再跟随；取消登记保留片段', async () => {
  const owner = await createVideoEditTestProject(); const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  const first = await addTestTitleTemplate(projectId, sequenceId)
  const template = requireVideoEditInstance(projectId).document.templates![0]
  expect(requireVideoEditInstance(projectId).document.sequences[0].clips.find(clip => clip.id === first)?.templateId).toBe(template.id)
  const second = (await applyVideoEditTemplate(projectId, sequenceId, 'project', template.id, { placement: { frame: 200 }, texts: ['王二', '摄影师'] })).clipIds[0]
  const doc = (): ReturnType<typeof requireVideoEditInstance>['document'] => requireVideoEditInstance(projectId).document
  const texts = (id: string): string[] => doc().sequences[0].clips.find(clip => clip.id === id)!.graphic!.objects.filter(object => object.kind === 'text').map(object => String(object.parameters.text))
  expect(texts(second)).toEqual(['王二', '摄影师']); expect(videoEditTemplateInstances(doc(), template)).toHaveLength(2)
  // 把第一个实例的底板改成别的颜色，登记成模板新内容：第二个实例跟着变，文字保持“王二”。
  editVideoProject(projectId, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => clip.id === first ? { ...clip, graphic: { ...clip.graphic!, objects: clip.graphic!.objects.map(object => object.kind === 'rect' ? { ...object, parameters: { ...object.parameters, fill: [1, 0, 0, 1] } } : object) } } : clip) })) }))
  const updated = await updateVideoEditTemplate(projectId, template.id, { kind: 'clips', sequenceId, clipIds: [first] })
  expect(updated).toMatchObject({ instances: 2, template: { version: 2 } })
  const rect = doc().sequences[0].clips.find(clip => clip.id === second)!.graphic!.objects.find(object => object.kind === 'rect')!
  expect(rect.parameters.fill).toEqual([1, 0, 0, 1]); expect(texts(second)).toEqual(['王二', '摄影师'])
  undoVideoEdit(projectId); expect(doc().templates![0].version).toBe(1)
  await updateVideoEditTemplate(projectId, template.id, { kind: 'clips', sequenceId, clipIds: [first] })
  await detachVideoEditTemplateInstances(projectId, sequenceId, [second])
  expect(doc().sequences[0].clips.find(clip => clip.id === second)?.templateId).toBeUndefined()
  expect(videoEditTemplateInstances(doc(), doc().templates![0])).toHaveLength(1)
  // 固化：所选两个片段登记成一个新模板，原片段即是实例；不能重复登记。
  const created = await createVideoEditTemplate(projectId, sequenceId, [second], { name: '王二人名条', description: '摄影师出场' })
  expect(created.template.body.kind).toBe('native'); expect(doc().sequences[0].clips.find(clip => clip.id === second)?.templateId).toBe(created.template.id)
  await expect(createVideoEditTemplate(projectId, sequenceId, [second], { name: '再来' })).rejects.toThrow('已经是模板')
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.project_template', id: `${projectId}:${created.template.id}` }
    expect((await app.change(ref, { 'video_edit.project_template.name': '摄影师人名条' })).ok).toBe(true)
    expect(doc().templates!.find(value => value.id === created.template.id)!).toMatchObject({ name: '摄影师人名条', version: 1 })
    const baseline = await app.read(ref, ['video_edit.project_template.instance_refs']) as { properties: Record<string, unknown>; revisions: unknown }
    expect(baseline.properties['video_edit.project_template.instance_refs']).toEqual([{ kind: 'video_edit.clip', id: `${projectId}:${second}` }])
    await app.requireResult('change_application_entities', { summary: '取消登记', changes: [{ kind: 'remove_items', entityType: 'video_edit.project_template', parent: { kind: 'video_edit.document', id: projectId }, targets: [ref] }] }, baseline.revisions as Record<string, number>)
    expect(doc().templates!.some(value => value.id === created.template.id)).toBe(false)
    expect(doc().sequences[0].clips.find(clip => clip.id === second)).toBeTruthy(); expect(doc().sequences[0].clips.find(clip => clip.id === second)?.templateId).toBeUndefined()
  } finally { app.dispose() }
})

it('代码模板：固化代码片段并设为全局；别的工程第一次应用时复制登记、之后复用；库里升级后经同意刷新全部实例；分离复制成独立代码', async () => {
  await videoEditStyleLibrary.ready()
  const owner = await createVideoEditTestProject(); const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  const [itemId] = await createVideoEditCodeItems(projectId, [{ files: { 'index.js': CARD }, entry: 'index.js', name: '档案人名条' }])
  const placed = makeVideoEditItemClip(requireVideoEditInstance(projectId).document, itemId, sequenceId, { frame: 0 }, readVideoEditCodeMetadata(requireVideoEditInstance(projectId), requireVideoEditInstance(projectId).document))
  editVideoProject(projectId, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: [...sequence.clips, placed] })) }))
  const created = await createVideoEditTemplate(projectId, sequenceId, [placed.id], { name: '档案人名条', description: '人物首次出场介绍姓名', styleId: 'restrained', global: true })
  expect(created.template).toMatchObject({ body: { kind: 'code' }, style: { id: 'restrained', version: 3 }, origin: { id: created.library!.id, version: 1 } })
  expect(created.library!.body.kind).toBe('code'); expect(JSON.stringify(created.library!.body)).toContain('档案人名条')
  // 另一个工程：第一次应用复制登记，第二次复用同一份，实例联动同一个代码定义。
  const other = await createVideoEditTestProject(); const otherId = other.document.id
  const a = await applyVideoEditTemplate(otherId, other.activeSequenceId, 'library', created.library!.id, { parameters: { name: '王二' } })
  const b = await applyVideoEditTemplate(otherId, other.activeSequenceId, 'library', created.library!.id, { placement: { frame: 150 } })
  expect([a.copied, b.copied]).toEqual([true, false]); expect(b.template.id).toBe(a.template.id)
  const otherDoc = (): ReturnType<typeof requireVideoEditInstance>['document'] => requireVideoEditInstance(otherId).document
  expect(otherDoc().templates).toHaveLength(1); expect(otherDoc().templates![0].origin).toEqual({ id: created.library!.id, version: 1 })
  const clips = otherDoc().sequences[0].clips.filter(clip => clip.code)
  expect(clips).toHaveLength(2); expect(new Set(clips.map(clip => clip.code!.definitionId)).size).toBe(1)
  expect(clips.find(clip => clip.id === a.clipIds[0])!.code!.parameters.name).toBe('王二')
  // 库模板升级到 v2：工程副本只提示；确认后两个实例一起换成新版本，参数保留。
  await videoEditStyleLibrary.saveTemplate({ ...videoEditStyleLibrary.requireTemplate(created.library!.id).template, body: { kind: 'code', code: { entry: 'index.js', files: { 'index.js': CARD.replace(BLACK_HEX, WHITE_HEX) } } } })
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.project_template', id: `${otherId}:${a.template.id}` }
    expect(((await app.read(ref, ['video_edit.project_template.library_version'])) as { properties: Record<string, unknown> }).properties['video_edit.project_template.library_version']).toBe(2)
    const result = await app.requireResult('update_video_edit_template', { templateRef: ref, content: { kind: 'library', confirmed: true } }) as { instanceCount: number; version: number }
    expect(result).toMatchObject({ instanceCount: 2, version: 2 })
    const versions = otherDoc().sequences[0].clips.filter(clip => clip.code).map(clip => clip.code!.versionId)
    const definition = otherDoc().codeMaterials!.find(value => value.id === clips[0].code!.definitionId)!
    expect(new Set(versions)).toEqual(new Set([definition.defaultVersionId])); expect(definition.versions).toHaveLength(2)
    expect(otherDoc().sequences[0].clips.find(clip => clip.id === a.clipIds[0])!.code!.parameters.name).toBe('王二')
    expect(otherDoc().templates![0].origin).toEqual({ id: created.library!.id, version: 2 })
    // 分离：复制成独立代码定义，保留参数，之后模板只剩一个实例。
    const detached = await app.requireResult('detach_video_edit_template_instance', { documentRef: { kind: 'video_edit.document', id: otherId }, sequenceRef: { kind: 'video_edit.sequence', id: `${otherId}:${other.activeSequenceId}` }, clipRefs: [{ kind: 'video_edit.clip', id: `${otherId}:${a.clipIds[0]}` }] }) as { verification: { verified: boolean } }
    expect(detached.verification.verified).toBe(true)
    const separate = otherDoc().sequences[0].clips.find(clip => clip.id === a.clipIds[0])!
    expect(separate.code!.definitionId).not.toBe(definition.id); expect(separate.code!.parameters.name).toBe('王二')
    expect(videoEditTemplateInstances(otherDoc(), otherDoc().templates![0])).toHaveLength(1)
    // 设为全局（更新来源）：库模板版本按内容变化。
    const promoted = await promoteVideoEditTemplate(otherId, a.template.id)
    expect(promoted.library.id).toBe(created.library!.id)
  } finally { app.dispose() }
})

it('旧本机风格库与标题模板第一次加载时转存进风格库，原键不改写，再次加载不重复', async () => {
  const kits = { version: 3, content: [{ id: 'old-kit', name: '旧风格', revision: 4, guide: '## 定位\n温暖的纪录片\n\n## 避免\n回弹入场', examples: [{ id: 'e', title: '开场', note: '演示错峰', source: CARD }] }] }
  const storage = new Map<string, string>([['video-edit-style-kits', JSON.stringify(kits)], ['video-edit-title-templates', JSON.stringify({ version: 6, content: [{ id: 'mine', name: '我的人名条', kind: 'lower_third', parameters: { text: '姓名' } }] })]])
  const legacy = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } }
  const before = new Map(storage)
  videoEditStyleLibrary.reset(io, legacy); await videoEditStyleLibrary.ready()
  const style = videoEditStyleLibrary.requireStyle('old-kit').style
  expect(style).toMatchObject({ name: '旧风格', version: 5, description: '温暖的纪录片' })
  expect(style.guide).toContain('不做（原“避免”）'); expect(style.guide).toContain('### 开场'); expect(style.sample.code.files[style.sample.code.entry]).toContain('档案人名条')
  expect(videoEditStyleLibrary.requireTemplate('mine').template.body.kind).toBe('native')
  expect(storage.get('video-edit-style-kits')).toBe(before.get('video-edit-style-kits'))
  await videoEditStyleLibrary.removeStyle('old-kit')
  videoEditStyleLibrary.reset(io, legacy); await videoEditStyleLibrary.ready()
  expect(videoEditStyleLibrary.findStyle('old-kit')).toBeUndefined()
  expect(await videoEditStyleContentHash(style)).toMatch(/^[a-f0-9]{64}$/)
})

it('内置样片是本仓库的作者模块：能加载、声明生成器并按标准分镜返回图层', async () => {
  const { testAuthorModule } = await import('../engine/videoEditAuthorTestFixtures')
  const { authorEffectMetadata } = await import('../engine/videoEditAuthorParameters')
  await videoEditStyleLibrary.ready()
  for (const entry of videoEditStyleLibrary.listStyles().filter(value => value.builtin)) {
    const effect = testAuthorModule(entry.style.sample.code.files[entry.style.sample.code.entry])
    expect(authorEffectMetadata(effect), entry.style.id).toMatchObject({ kind: 'generator', mode: 'dynamic' })
    for (const time of entry.style.sample.anchors) {
      const layers = effect.layers!({}, 1280, 720, {}, { time, frameDuration: 1 / 24, clip: { time, duration: 8 } } as never)
      expect(layers.length, `${entry.style.id}@${time}`).toBeGreaterThan(3)
      for (const layer of layers) if (layer.pose) { expect(layer.bounds, entry.style.id).toBeTruthy(); layer.pose(time) }
    }
  }
})


it('内置风格使用者偏好升版并持久保存，随风格包导出', async () => {
  await videoEditStyleLibrary.ready()
  const before = videoEditStyleLibrary.requireStyle('restrained').style
  const userPreferences = [{ id: 'spacing', content: '这个风格的文字多留一点空白。', source: 'user' as const, revision: 1, updatedAt: new Date().toISOString() }]
  const saved = await videoEditStyleLibrary.saveStyle({ ...before, version: before.version + 1, userPreferences }, undefined, true)
  expect(saved.style.version).toBe(before.version + 1)
  expect(saved.builtin).toBe(true)
  expect(saved.stale).toBe(false)
  videoEditStyleLibrary.reset(io, undefined)
  await videoEditStyleLibrary.ready()
  expect(videoEditStyleLibrary.requireStyle('restrained').style.userPreferences).toEqual(userPreferences)
  let text = ''
  await exportVideoEditStylePackage('restrained', 'D:/out/偏好.henjistyle', {}, { read: async () => text, exists: async () => false, write: async (_file, value) => { text = value } })
  expect(JSON.parse(text).content.style.userPreferences).toEqual(userPreferences)
})
