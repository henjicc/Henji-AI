// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { closeVideoEditProject, listVideoEditInstances, saveVideoEdit, undoVideoEdit, editVideoProject, getActiveVideoEditSequence, appendVideoEditMedia } from './videoEditService'
import { createVideoEditCodeItems, createVideoEditCodeMaterials, createVideoEditCodeVersions, createVideoEditFilterMaterials, createVideoEditCodeAssetInstance } from './videoEditCodeService'
import { appendVideoEditItems, createVideoEditGraphicItem, createVideoEditAdjustmentItem } from './videoEditProjectItems'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { VideoEditCollectionExecutor } from './videoEditExecutors'
import { prepareVideoEditCodeCandidate, commitVideoEditCodeCandidate, disposeVideoEditCodeCandidate } from './videoEditCodeCandidates'
import { bindVideoEditCodeImage, chooseVideoEditCodeImage } from './videoEditCodeImages'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { videoEditComposition, createVideoEditDocument } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { duplicateVideoEditSequence, editVideoSequence } from './videoEditService'
import { createVideoEditEffect, updateVideoEditEffect, reorderVideoEditEffects, copyVideoEditEffects, deleteVideoEditEffects, createVideoEditTransition, updateVideoEditTransition, deleteVideoEditTransition } from './videoEditCompositing'
import { readVideoEditCodeEditor } from './videoEditCodeParameters'
import { videoEditGraphicObjectId } from './videoEditCompositeEntities'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { CodeAsset } from '@/core/videoEdit/codeAsset'
import { decodeCodeAsset, encodeCodeAsset } from '@/core/videoEdit/codeAsset'
import { collectVideoEditCodeAsset, importVideoEditCodeAsset } from './videoEditCodeAssets'
import { assetApplicationService } from '@/features/assets/application/assetApplicationService'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import * as mediaService from './videoEditMedia'
import { openSeededVideoEdit, replaceSavedVideoEdit, savedVideoEdit, reopenVideoEdit, createLegacyTrackVideoEditProject } from './videoEditDocumentTestKit'

const boundary = vi.hoisted(() => ({ compileGate: undefined as Promise<void> | undefined, trialGate: undefined as Promise<void> | undefined, compileCalls: 0, trialCalls: 0, failTrial: false, proveFilters: false, filterProofs: 0, activeRenderers: 0, disposedCompilers: 0, dimensions: [] as number[][], presentedFrames: [] as number[] }))
// Only thread/pixel boundaries are replaced. AST language checks, domain
// validation, public tool registry, transactions and save/reopen are real.
vi.mock('../engine/videoEditCodeCompiler', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  return { VideoEditCodeCompiler: class {
    async compile(source: string) { boundary.compileCalls++; await boundary.compileGate; return compileCodeMaterial(source) }
    dispose() { boundary.disposedCompilers++ }
  } }
})
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor(private document: VideoEditComposition) { boundary.activeRenderers++; boundary.dimensions.push([document.width, document.height]) }
  async updateDocument(document: VideoEditComposition) { this.document = document }
  async present(frame: number) {
    boundary.trialCalls++; boundary.presentedFrames.push(frame); await boundary.trialGate
    if (boundary.failTrial) throw new Error('GPU trial rejected')
    if (boundary.proveFilters) {
      const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
      const { emitCodeMaterialFilter } = await import('../engine/codeGpuFilter')
      const { videoEditVisibleTracks } = await import('@/core/videoEdit/document')
      const { videoEditTransitionsAt } = await import('@/core/videoEdit/transitions')
      const visible = videoEditVisibleTracks(this.document); const windows = videoEditTransitionsAt(this.document, frame)
      for (const clip of this.document.clips) if (visible.has(clip.track) && (frame >= clip.start && frame < clip.start + clip.duration || windows.some(window => [window.left.id, window.right.id].includes(clip.id)))) {
        if (clip.kind === 'adjustment' && clip.opacity === 0) continue
        for (const effect of clip.effects ?? []) if (effect.enabled && effect.amount > 0) {
          const source = this.document.codeMaterials!.find(definition => definition.id === effect.code.definitionId)!.versions.find(version => version.id === effect.code.versionId)!.source
          boundary.filterProofs++; emitCodeMaterialFilter(compileCodeMaterial(source), frame < clip.start || frame >= clip.start + clip.duration)
        }
      }
    }
    return { presented: true, bitmap: { close() {} } }
  }
  async dispose() { boundary.activeRenderers-- }
} }))
const source = `export default {apiVersion:1,name:"原创移动圆",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:4,seed:7,parameters:{amount:{type:"number",title:"透明度",default:.5,min:0,max:1,step:.01,animatable:true}},render(ctx){return [ellipse({x:100+ctx.time*20,y:100,width:500,height:500,fill:[0,1,1,ctx.params.amount]})];}}`
const files = new Map<string, string>()
const filterSource = 'export default {apiVersion:1,name:"原创滤镜",kind:"filter",mode:"static",width:3840,height:2160,durationSeconds:10,seed:1,parameters:{gain:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01}},render(ctx){const c=sample(ctx.u,ctx.v);return rgba(c.r*ctx.params.gain,c.g,c.b,c.a);}}'
const codeAssetFixture = (codeSource = source): CodeAsset => ({ format: 'henji-code-asset', version: 1, name: '可编辑资产', sourceVersion: { apiVersion: 1, languageVersion: codeSource.includes('type:"image"') ? 2 : 1, source: codeSource }, parameters: { amount: .7 }, curves: { amount: [{ id: 'asset-key', sourceInUs: 1_000_000, sourceRemainder: { numerator: 1, denominator: 3 }, value: .9, interpolation: 'ease' }] }, images: [] })
const importPublication = (asset = codeAssetFixture()) => ({ asset, media: [], mediaIds: new Map<string, string>(), origin: { assetId: 'fixed-asset', contentIdentity: 'a'.repeat(64) }, beforePublish: async () => undefined })
function collectionBoundary() {
  const bytes = new Map<string, Uint8Array>(); const assets = new Map<string, AssetRecord>(); const platform = getPlatform()
  vi.spyOn(platform.system.fs, 'exists').mockImplementation(async path => bytes.has(path))
  vi.spyOn(platform.system.fs, 'writeFile').mockImplementation(async (path, value, options) => { if (options?.exclusive && bytes.has(path)) throw new Error('exists'); bytes.set(path, value) })
  vi.spyOn(platform.system.fs, 'readFile').mockImplementation(async path => bytes.get(path)!)
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockImplementation(async path => ({ sizeBytes: bytes.get(path)?.length ?? 10, fileModifiedAt: 20, contentIdentity: 'a'.repeat(64) }))
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => {
    const asset: AssetRecord = { id: `asset-${assets.size}`, mediaType: input.mediaType, filePath: input.filePath, displayName: input.displayName ?? '代码素材', displayUrl: 'henji-media://local/code', thumbnailUrl: null, thumbnailPath: null, source: input.source, mimeType: 'application/x-henji-code', sizeBytes: bytes.get(input.filePath)!.length, fileModifiedAt: 20, contentIdentity: 'a'.repeat(64), inspectionStatus: 'ready', inspectionError: null, width: null, height: null, durationSeconds: null, tags: [], libraryIds: [], createdAt: 1, updatedAt: 2, lastUsedAt: null }
    assets.set(asset.id, asset); return asset
  })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => assets.get(id)!)
  return { bytes, platform }
}
it('公共图形效果转场实体原子增改删、精确回执、锁定与保存重开均消费正式状态', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const seq = owner.activeSequenceId; const app = createApplicationHarness()
  const project = { kind: 'video_edit.document', id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${seq}` }
  const create = async (entityType: string, parent: { kind: string; id: string }, items: Array<{ properties: Record<string, unknown> }>) => app.call('change_application_entities', { summary: '验证真实图层集合', changes: [{ kind: 'create_items', entityType, parent, items }] }, (await app.read(parent)).revisions as Record<string, number>)
  try {
    expect(await create('video_edit.item', project, [{ properties: { 'video_edit.item.kind': 'graphic', 'video_edit.item.graphic_kind': 'solid', 'video_edit.item.name': '公共纯色', 'video_edit.item.graphic_width': 3840, 'video_edit.item.graphic_height': 2160 } }])).toMatchObject({ ok: true })
    const item = owner.document.items[0]; const [left, right] = appendVideoEditItems(id, [item.id, item.id], seq)
    editVideoProject(id, document => { document.sequences[0].clips[0].graphic!.objects[0].id = '对象:冒号'; return document })
    const clipRef = { kind: 'video_edit.clip', id: `${id}:${left}` }; const objectRef = { kind: 'video_edit.graphic_object', id: `${id}:${videoEditGraphicObjectId(left, '对象:冒号')}` }
    expect(((await app.read(objectRef, ['video_edit.graphic_object.name'])).properties as Record<string, unknown>)['video_edit.graphic_object.name']).toBe('纯色')
    const before = owner.past.length
    expect(await app.change(objectRef, { 'video_edit.graphic_object.name': '改名的对象', 'video_edit.graphic_object.parameters': { ...item.graphic!.objects[0].parameters, rotation: 25 } })).toMatchObject({ ok: true })
    expect(owner.past).toHaveLength(before + 1); expect(getActiveVideoEditSequence(owner).clips[0].graphic!.objects[0].parameters.rotation).toBe(25)
    expect(await create('video_edit.graphic_object', clipRef, [{ properties: { 'video_edit.graphic_object.kind': 'ellipse', 'video_edit.graphic_object.name': '圆', 'video_edit.graphic_object.parameters': { width: 100 } } }])).toMatchObject({ ok: true })
    const objects = getActiveVideoEditSequence(owner).clips[0].graphic!.objects
    expect(await app.change(clipRef, { 'video_edit.clip.graphic_object_ids': objects.map(object => object.id).reverse() })).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips[0].graphic!.objects[0].name).toBe('圆')
    const [definitionId] = await createVideoEditCodeMaterials(id, [{ source: filterSource }])
    const created = await create('video_edit.effect', clipRef, [{ properties: { 'video_edit.effect.definition_id': definitionId, 'video_edit.effect.name': '公共效果' } }])
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]; const effectRef = { kind: 'video_edit.effect', id: `${id}:${effect.id}` }
    expect(await app.change(effectRef, { 'video_edit.effect.enabled': false, 'video_edit.effect.amount': .4, 'video_edit.effect.parameters': { gain: .8 } })).toMatchObject({ ok: true })
    expect((await app.read(effectRef, ['video_edit.effect.enabled', 'video_edit.effect.amount', 'video_edit.effect.parameters'])).properties).toMatchObject({ 'video_edit.effect.enabled': false, 'video_edit.effect.amount': .4, 'video_edit.effect.parameters': { gain: .8 } })
    const transitioning = await create('video_edit.transition', sequenceRef, [{ properties: { 'video_edit.transition.left_clip_id': left, 'video_edit.transition.right_clip_id': right, 'video_edit.transition.duration_frames': 10 } }])
    expect(transitioning, JSON.stringify(transitioning)).toMatchObject({ ok: true })
    const transition = getActiveVideoEditSequence(owner).transitions![0]; const transitionRef = { kind: 'video_edit.transition', id: `${id}:${transition.id}` }
    expect(await app.change(transitionRef, { 'video_edit.transition.duration_frames': 12 })).toMatchObject({ ok: true })
    const stable = owner.document; const history = owner.past.length
    for (const [ref, properties] of [[clipRef, { 'video_edit.clip.effects': [] }], [sequenceRef, { 'video_edit.sequence.transitions': [] }], [objectRef, { 'video_edit.graphic_object.kind': 'text' }], [effectRef, { 'video_edit.effect.version_id': 'foreign' }], [transitionRef, { 'video_edit.transition.duration_frames': 500 }]] as const) expect((await app.change(ref, properties)).ok).toBe(false)
    expect(owner.document).toBe(stable); expect(owner.past).toHaveLength(history)
    boundary.failTrial = true; expect((await app.change(effectRef, { 'video_edit.effect.amount': .6 })).ok).toBe(false); boundary.failTrial = false
    expect(owner.document).toBe(stable); expect(owner.past).toHaveLength(history)
    editVideoSequence(id, seq, sequence => { sequence.tracks.find(track => track.index === 1)!.locked = true; return sequence })
    expect((await app.change(objectRef, { 'video_edit.graphic_object.name': '不应写入' })).ok).toBe(false)
    editVideoSequence(id, seq, sequence => { sequence.tracks.find(track => track.index === 1)!.locked = false; return sequence })
    const retimed = await app.change(sequenceRef, { 'video_edit.sequence.frame_rate': { numerator: 60, denominator: 1 } })
    expect(retimed, JSON.stringify(retimed)).toMatchObject({ ok: true }); expect(getActiveVideoEditSequence(owner).transitions![0].durationFrames).toBe(24)
    expect(retimed.ok && retimed.data.effects).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'video_edit.transition', origin: { kind: 'cascade', declarationId: 'video_edit.transition_update' } })]))
    await saveVideoEdit(id); const saved = structuredClone(owner.document); await closeVideoEditProject(id)
    const reopened = await reopenVideoEdit(owner.document.id); expect(reopened.document).toEqual({ ...saved, revision: 0 })
    expect(((await app.read(effectRef, ['video_edit.effect.amount'])).properties as Record<string, unknown>)['video_edit.effect.amount']).toBe(.4)
    const removed = await app.requireResult('change_application_entities', { summary: '移除图形片段及关联内容', changes: [{ kind: 'remove_items', entityType: 'video_edit.clip', parent: sequenceRef, targets: [clipRef] }] }, (await app.read(sequenceRef)).revisions as Record<string, number>)
    expect(getActiveVideoEditSequence(reopened).clips.some(clip => clip.id === left)).toBe(false); expect(getActiveVideoEditSequence(reopened).transitions).toEqual([])
    expect(removed.effects).toEqual(expect.arrayContaining(['video_edit.graphic_object', 'video_edit.effect', 'video_edit.transition'].map(entityType => expect.objectContaining({ entityType, effect: 'delete', origin: { kind: 'cascade', declarationId: `${entityType}_delete` } }))))
    undoVideoEdit(id); expect(getActiveVideoEditSequence(reopened).clips.some(clip => clip.id === left)).toBe(true); expect(getActiveVideoEditSequence(reopened).transitions).toHaveLength(1)
  } finally { app.dispose() }
})
it('隐藏或关闭滤镜的候选仍进入真实范围证明，负转场不安全源码不发布', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const seq = owner.activeSequenceId
  const item = createVideoEditGraphicItem(id, { kind: 'rect' }); const [left, right] = appendVideoEditItems(id, [item, item], seq)
  const [definitionId] = await createVideoEditCodeMaterials(id, [{ source: filterSource }])
  const effectId = await createVideoEditEffect({ projectId: id, sequenceId: seq, clipId: right }, { definitionId })
  editVideoSequence(id, seq, sequence => { sequence.clips.find(clip => clip.id === right)!.sourceInUs = 1_000_000; return sequence })
  await createVideoEditTransition(id, seq, { leftClipId: left, rightClipId: right, durationFrames: 10 })
  const unsafe = 'export default {apiVersion:1,name:"负时钟证明",kind:"filter",mode:"dynamic",width:3840,height:2160,durationSeconds:30,seed:1,parameters:{gain:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01}},render(ctx){return rgba(clamp(1/(ctx.localTime+.5),0,1),0,0,1);}}'
  boundary.proveFilters = true
  for (const hidden of ['disabled', 'zero', 'track'] as const) {
    editVideoSequence(id, seq, sequence => { const clip = sequence.clips.find(clip => clip.id === right)!; clip.effects![0].enabled = hidden !== 'disabled'; clip.effects![0].amount = hidden === 'zero' ? 0 : 1; sequence.tracks.find(track => track.index === clip.track)!.enabled = hidden !== 'track'; return sequence })
    const baseline = owner.document; const history = owner.past.length; const proofs = boundary.filterProofs
    const editor = readVideoEditCodeEditor(id, seq, right, effectId)
    await expect(prepareVideoEditCodeCandidate(editor.target, unsafe)).rejects.toThrow(/范围|除|零|divis|分母/i)
    expect(boundary.filterProofs).toBeGreaterThan(proofs); expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history); expect(boundary.activeRenderers).toBe(0)
  }
  editVideoSequence(id, seq, sequence => { sequence.tracks.find(track => track.index === 1)!.enabled = true; return sequence })
  const adjustmentItem = createVideoEditAdjustmentItem(id); const [adjustmentClipId] = appendVideoEditItems(id, [adjustmentItem], seq, { frame: 0, track: 2 })
  const adjustmentEffect = await createVideoEditEffect({ projectId: id, sequenceId: seq, clipId: adjustmentClipId }, { definitionId })
  editVideoSequence(id, seq, sequence => { sequence.clips.find(clip => clip.id === adjustmentClipId)!.opacity = 0; return sequence })
  const baseline = owner.document; const history = owner.past.length; const proofs = boundary.filterProofs
  const adjustmentEditor = readVideoEditCodeEditor(id, seq, adjustmentClipId, adjustmentEffect)
  await expect(prepareVideoEditCodeCandidate(adjustmentEditor.target, unsafe.replace('ctx.localTime+.5', 'ctx.localTime'))).rejects.toThrow(/范围|除|零|divis|分母/i)
  expect(boundary.filterProofs).toBeGreaterThan(proofs); expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history); expect(boundary.activeRenderers).toBe(0)
})
it('滤镜创作入口在发布前拒绝生成源码，检查通过后只新增滤镜定义', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const baseline = owner.document; const history = owner.past.length
  await expect(createVideoEditFilterMaterials(owner.document.id, [{ source }])).rejects.toThrow('输入滤镜')
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history); expect(boundary.activeRenderers).toBe(0)
  const [id] = await createVideoEditFilterMaterials(owner.document.id, [{ source: filterSource }])
  expect(owner.document.codeMaterials!.map(definition => definition.id)).toEqual([id]); expect(owner.document.items).toEqual([])
  expect(owner.past).toHaveLength(history + 1); expect(boundary.activeRenderers).toBe(0)
})
it('效果链排序开关复制同源提交，转场检查首末和窗口边界，失败不留下状态', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  const itemId = createVideoEditGraphicItem(projectId, { kind: 'rect' }); const [leftClipId, rightClipId] = appendVideoEditItems(projectId, [itemId, itemId], sequenceId)
  const [definitionId] = await createVideoEditCodeMaterials(projectId, [{ source: filterSource }])
  const target = { projectId, sequenceId, clipId: leftClipId }; const history = owner.past.length
  const first = await createVideoEditEffect(target, { definitionId }); const second = await createVideoEditEffect(target, { definitionId, name: '第二效果' })
  expect(owner.past).toHaveLength(history + 2)
  await reorderVideoEditEffects(target, [second, first]); await updateVideoEditEffect(target, second, { enabled: false, amount: .25 })
  expect(getActiveVideoEditSequence(owner).clips[0].effects).toMatchObject([{ id: second, enabled: false, amount: .25 }, { id: first }])
  await copyVideoEditEffects({ ...target, clipId: rightClipId }, target)
  const right = getActiveVideoEditSequence(owner).clips[1]
  expect(right.effects!.map(effect => effect.name)).toEqual(['第二效果', '原创滤镜'])
  expect(right.effects!.map(effect => effect.id)).not.toContain(first); expect(right.effects![1].code).not.toBe(getActiveVideoEditSequence(owner).clips[0].effects![1].code)
  boundary.presentedFrames = []
  const transitionId = await createVideoEditTransition(projectId, sequenceId, { leftClipId, rightClipId, durationFrames: 10 })
  expect(new Set(boundary.presentedFrames)).toEqual(new Set([0, 89, 90, 179, 85, 94]))
  await updateVideoEditTransition(projectId, sequenceId, transitionId, 8)
  expect(getActiveVideoEditSequence(owner).transitions![0].durationFrames).toBe(8)
  const stable = owner.document; const past = owner.past.length
  await expect(reorderVideoEditEffects(target, [first, first])).rejects.toThrow('顺序')
  await expect(createVideoEditEffect(target, { definitionId: 'missing' })).rejects.toThrow('不属于')
  await expect(updateVideoEditTransition(projectId, sequenceId, transitionId, 500)).rejects.toThrow('窗口')
  boundary.failTrial = true
  await expect(updateVideoEditEffect(target, first, { amount: .5 })).rejects.toThrow('GPU trial')
  expect(owner.document).toBe(stable); expect(owner.past).toHaveLength(past); expect(boundary.activeRenderers).toBe(0)
  boundary.failTrial = false
  await deleteVideoEditEffects(target, [first]); await deleteVideoEditTransition(projectId, sequenceId, transitionId)
  expect(getActiveVideoEditSequence(owner).transitions).toEqual([])
  undoVideoEdit(projectId); expect(getActiveVideoEditSequence(owner).transitions).toHaveLength(1)
})
it('效果源码候选只迁移指定稳定实例，并检查转场边界后单笔保存', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  const itemId = createVideoEditGraphicItem(projectId, { kind: 'rect' }); const [leftClipId, rightClipId] = appendVideoEditItems(projectId, [itemId, itemId], sequenceId)
  const [definitionId] = await createVideoEditCodeMaterials(projectId, [{ source: filterSource }])
  const target = { projectId, sequenceId, clipId: rightClipId }
  const first = await createVideoEditEffect(target, { definitionId }); const second = await createVideoEditEffect(target, { definitionId })
  await createVideoEditTransition(projectId, sequenceId, { leftClipId, rightClipId, durationFrames: 10 })
  const editor = readVideoEditCodeEditor(projectId, sequenceId, rightClipId, second)
  const baseline = owner.document; const history = owner.past.length; boundary.presentedFrames = []
  const candidate = await prepareVideoEditCodeCandidate(editor.target, filterSource.replace('c.r*ctx.params.gain', 'c.g*ctx.params.gain'))
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  expect(new Set(boundary.presentedFrames)).toEqual(new Set([90, 179, 85, 94]))
  commitVideoEditCodeCandidate(candidate)
  expect(owner.past).toHaveLength(history + 1)
  expect(readVideoEditCodeEditor(projectId, sequenceId, rightClipId, first).target.versionId).toBe(editor.target.versionId)
  expect(readVideoEditCodeEditor(projectId, sequenceId, rightClipId, second).target.versionId).toBe(candidate.versionId)
  expect(owner.document.items).toHaveLength(1)
})
it('原创滤镜先完整试渲染后只发布源码定义，追加滤镜版本保持类型与既有引用', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const history = owner.past.length
  const [definitionId] = await createVideoEditCodeMaterials(id, [{ source: filterSource }])
  expect(boundary.trialCalls).toBe(1); expect(boundary.activeRenderers).toBe(0); expect(boundary.dimensions).toEqual([[3840, 2160]])
  expect(owner.document.items).toEqual([]); expect(owner.document.media).toEqual([]); expect(owner.past).toHaveLength(history + 1)
  const original = owner.document.codeMaterials![0]; expect(original.id).toBe(definitionId)
  const [versionId] = await createVideoEditCodeVersions(id, [{ definitionId, source: filterSource.replace('default:.5', 'default:.7') }])
  expect(owner.document.codeMaterials![0].defaultVersionId).toBe(original.defaultVersionId)
  expect(owner.document.codeMaterials![0].versions).toHaveLength(2); expect(versionId).not.toBe(original.defaultVersionId)
  const stable = owner.document; const count = owner.past.length
  await expect(createVideoEditCodeVersions(id, [{ definitionId, source }])).rejects.toThrow('不能在同一定义中互换')
  await expect(createVideoEditCodeItems(id, [{ source: filterSource }])).rejects.toThrow('不能直接')
  await expect(createVideoEditCodeMaterials(id, [{ source: filterSource, binId: 'fake-bin' }])).rejects.toThrow('素材箱')
  expect(owner.document).toBe(stable); expect(owner.past).toHaveLength(count)
  await saveVideoEdit(id); const reopened = await reopenVideoEdit(owner.document.id)
  expect(reopened.document.codeMaterials).toEqual(owner.document.codeMaterials); expect(reopened.document.items).toEqual([])
})
it('滤镜试渲染失败、取消和剪辑变化都不发布部分源码或留下历史', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const baseline = owner.document; const history = owner.past.length
  boundary.failTrial = true
  await expect(createVideoEditCodeMaterials(id, [{ source: filterSource }])).rejects.toThrow('GPU trial')
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history); expect(boundary.activeRenderers).toBe(0)
  boundary.failTrial = false
  let release!: () => void; boundary.trialGate = new Promise(resolve => { release = resolve })
  const controller = new AbortController(); const pending = createVideoEditCodeMaterials(id, [{ source: filterSource }], controller.signal)
  const rejected = expect(pending).rejects.toThrow('取消')
  await vi.waitFor(() => expect(boundary.activeRenderers).toBe(1)); controller.abort(new Error('主动取消')); release(); await rejected
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history); expect(boundary.activeRenderers).toBe(0)
})
it('保存重开检查非默认滤镜固定版本，复制效果独立，滤镜类型和范围失败没有额外写入', async () => {
  const document = createVideoEditDocument('真实固定滤镜'); const sequence = document.sequences[0]
  document.items = [{ id: 'text', name: '文字', kind: 'text' }]
  const filterSource = `export default {apiVersion:1,name:"单输入",kind:"filter",mode:"static",width:1920,height:1080,durationSeconds:10,seed:1,parameters:{amount:{type:"number",title:"强度",default:.5,min:0,max:1,step:.01,animatable:true}},render(ctx){const c=sample(ctx.u,ctx.v);return rgba(c.r*ctx.params.amount,c.g,c.b,c.a);}}`
  document.codeMaterials = [{ id: 'filter', name: '滤镜', defaultVersionId: 'default', versions: [{ id: 'default', apiVersion: 1, languageVersion: 1, source: filterSource }, { id: 'held', apiVersion: 1, languageVersion: 1, source: filterSource.replace('default:.5', 'default:.8') }] }]
  const clip = makeVideoEditItemClip(document, 'text', sequence.id, { frame: 0, duration: 30 })
  clip.effects = [{ id: 'fixed-effect', name: '滤镜', enabled: true, amount: .7, code: { definitionId: 'filter', versionId: 'held', parameters: { amount: .6 } } }]
  sequence.clips = [clip]
  const owner = await openSeededVideoEdit(document); const id = owner.document.id
  expect(boundary.compileCalls).toBe(2)
  expect(readVideoEditCodeMetadata(owner, owner.document)(owner.document.sequences[0].clips[0].effects![0].code).parameters[0].default).toBe(.8)
  const duplicateId = duplicateVideoEditSequence(id, sequence.id)
  const duplicate = owner.document.sequences.find(value => value.id === duplicateId)!
  expect(duplicate.clips[0].effects![0].id).not.toBe('fixed-effect')
  editVideoSequence(id, duplicateId, draft => { draft.clips[0].effects![0].code.parameters.amount = .2; return draft })
  expect(owner.document.sequences[0].clips[0].effects![0].code.parameters.amount).toBe(.6)
  const before = owner.document; const past = owner.past.length
  expect(() => editVideoSequence(id, duplicateId, draft => { draft.clips[0].effects![0].code.parameters.amount = 4; return draft })).toThrow()
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(past)
  await saveVideoEdit(id); const saved = structuredClone(owner.document)
  const reopened = await reopenVideoEdit(id)
  expect(reopened.document).toEqual({ ...saved, revision: 0 })
  expect(boundary.compileCalls).toBe(4)
  const invalid = structuredClone(document); invalid.id = 'wrong-effect-kind'; invalid.codeMaterials![0].versions[1].source = source
  await expect(openSeededVideoEdit(invalid)).rejects.toThrow('单输入滤镜')
  expect(listVideoEditInstances()).toEqual([reopened])
})
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  Object.assign(boundary, { compileGate: undefined, trialGate: undefined, compileCalls: 0, trialCalls: 0, failTrial: false, proveFilters: false, filterProofs: 0, activeRenderers: 0, disposedCompilers: 0, dimensions: [], presentedFrames: [] })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/code-project.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
})
afterEach(async () => { for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('候选返回前渲染器释放失败时仍关闭候选画面并释放试渲染队列', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const close = vi.fn()
  vi.spyOn(VideoEditRenderSession.prototype, 'present').mockResolvedValueOnce({ id: 1, presented: true, bitmap: { width: 1, height: 1, close } })
  vi.spyOn(VideoEditRenderSession.prototype, 'dispose').mockRejectedValueOnce(new Error('释放失败'))
  const input = [{ document: videoEditComposition(owner.document, owner.activeSequenceId), frame: 0 }]
  await expect(trialVideoEditCodeFrames(input, new AbortController().signal, true)).rejects.toThrow('释放失败')
  expect(close).toHaveBeenCalledOnce(); expect(boundary.activeRenderers).toBe(0)
  await expect(trialVideoEditCodeFrames(input, new AbortController().signal)).resolves.toBeUndefined()
  expect(boundary.activeRenderers).toBe(0)
})

it('公共集合提交新源码、实例参数独立、保存重开只保存源码版本，手动与工具共用撤销', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id; const app = createApplicationHarness()
  try {
    const parent = { kind: 'video_edit.document', id }; const baseline = await app.read(parent)
    const created = await app.call('change_application_entities', { summary: '创作新的透明动态图形', changes: [{ kind: 'create_items', entityType: 'video_edit.code_material', parent, items: [{ properties: { 'video_edit.code_material.source': source } }] }] }, baseline.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    expect(instance.past).toHaveLength(1); expect(boundary.dimensions).toEqual([[3840, 2160]]); expect(boundary.activeRenderers).toBe(0)
    const definition = instance.document.codeMaterials![0]; const item = instance.document.items[0]
    const materialRef = { kind: 'video_edit.code_material', id: `${id}:${definition.id}` }
    expect((await app.read(materialRef, ['video_edit.code_material.source'])).properties).toEqual({ 'video_edit.code_material.source': source })
    expect((await app.change(materialRef, { 'video_edit.code_material.source': source.replace('seed:7', 'seed:8') })).ok).toBe(false)
    const sequenceRef = { kind: 'video_edit.sequence', id: `${id}:${instance.activeSequenceId}` }
    const collectionBaseline = await app.read(sequenceRef)
    const inserted = await app.call('change_application_entities', { summary: '创建独立代码片段参数', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.name': item.name, 'video_edit.clip.kind': 'code', 'video_edit.clip.code_parameters': { amount: .6 } } }] }] }, collectionBaseline.revisions as Record<string, number>)
    expect(inserted, JSON.stringify(inserted)).toMatchObject({ ok: true })
    appendVideoEditItems(id, [item.id], instance.activeSequenceId, { frame: 0, track: 2 })
    const clips = getActiveVideoEditSequence(instance).clips
    const ref = { kind: 'video_edit.clip', id: `${id}:${clips[0].id}` }
    const compileCount = boundary.compileCalls
    const updated = await app.change(ref, { 'video_edit.clip.code_parameters': { amount: .8 } })
    expect(updated, JSON.stringify(updated)).toMatchObject({ ok: true }); expect(boundary.compileCalls).toBe(compileCount)
    expect(getActiveVideoEditSequence(instance).clips.map(clip => clip.code!.parameters.amount)).toEqual([.8, .5]); expect(instance.document.items[0].code!.parameters.amount).toBe(.5)
    const before = instance.document
    expect((await app.change(ref, { 'video_edit.clip.code_parameters': { amount: 2 } })).ok).toBe(false); expect(instance.document).toBe(before)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(instance).clips[0].code!.parameters.amount).toBe(.6)
    undoVideoEdit(id, true); await saveVideoEdit(id)
    const saved = JSON.stringify(savedVideoEdit(instance))!
    expect(saved).not.toMatch(/"(instructions|program|metadata|shader|draws)"/)
    await closeVideoEditProject(id); const reopened = await reopenVideoEdit(instance.document.id)
    expect(reopened.document.codeMaterials).toEqual(instance.document.codeMaterials)
    expect(getActiveVideoEditSequence(reopened).clips[0].code!.parameters.amount).toBe(.8)
    expect(readVideoEditCodeMetadata(reopened, reopened.document)(reopened.document.items[0].code!).mode).toBe('dynamic')
    expect(boundary.activeRenderers).toBe(0); expect(boundary.disposedCompilers).toBeGreaterThan(0)
  } finally { app.dispose() }
})

it('非法源码与试渲染失败均不入库，不留下历史或像素资源，成功重试仍是一笔编辑', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id; const before = instance.document
  await expect(createVideoEditCodeItems(id, [{ source: source.replace('return [ellipse', 'while(true){} return [ellipse') }])).rejects.toThrow()
  boundary.failTrial = true
  await expect(createVideoEditCodeItems(id, [{ source }])).rejects.toThrow('GPU trial rejected')
  expect(instance.document).toBe(before); expect(instance.past).toHaveLength(0); expect(boundary.activeRenderers).toBe(0)
  expect(savedVideoEdit(instance).items).toEqual([])
  boundary.failTrial = false; await createVideoEditCodeItems(id, [{ source }])
  expect(instance.document.items).toHaveLength(1); expect(instance.past).toHaveLength(1)
  const good = instance.document
  await expect(createVideoEditCodeItems(id, [{ source, binId: 'missing' }])).rejects.toThrow('素材箱')
  expect(instance.document).toBe(good); expect(boundary.activeRenderers).toBe(0)
})

it('试渲染晚到不能覆盖期间的手动修改，旧会话编译不能写入重开的同ID剪辑', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id
  let release!: () => void
  boundary.trialGate = new Promise<void>(resolve => { release = resolve })
  const creating = createVideoEditCodeItems(id, [{ source }])
  await vi.waitFor(() => expect(boundary.trialCalls).toBe(1))
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '检查期间的手动编辑' }) }))
  release(); await expect(creating).rejects.toThrow('剪辑已修改')
  expect(instance.document.sequences[0].name).toBe('检查期间的手动编辑'); expect(instance.document.items).toEqual([]); expect(instance.past).toHaveLength(1)
  boundary.trialGate = undefined
  boundary.compileGate = new Promise<void>(resolve => { release = resolve })
  const count = boundary.compileCalls; const pending = createVideoEditCodeItems(id, [{ source }])
  await vi.waitFor(() => expect(boundary.compileCalls).toBe(count + 1))
  await closeVideoEditProject(id); const reopened = await reopenVideoEdit(instance.document.id)
  release(); await expect(pending).rejects.toThrow('原剪辑已关闭')
  expect(reopened.document.items).toEqual([]); expect(reopened.past).toHaveLength(0); expect(boundary.activeRenderers).toBe(0)
})

it('磁盘替换固定版本或未检查引用不能进入剪辑，失败打开释放源码线程并保留原文件', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id
  await createVideoEditCodeItems(id, [{ source }]); const original = instance.document
  expect(() => editVideoProject(id, document => { document.codeMaterials![0].versions[0].source = source.replace('seed:7', 'seed:8'); return document })).toThrow('被替换')
  expect(instance.document).toBe(original)
  editVideoProject(id, document => ({ ...document, items: [] }))
  expect(() => editVideoProject(id, document => { document.codeMaterials![0].versions[0].source = source.replace('seed:7', 'seed:8'); return document })).toThrow('被替换')
  await closeVideoEditProject(id)
  const raw = savedVideoEdit(instance); raw.codeMaterials![0].versions[0].source = 'export default {render(){while(true){}}}'
  replaceSavedVideoEdit(id, raw); const invalid = JSON.stringify(savedVideoEdit(instance))
  const disposed = boundary.disposedCompilers
  await expect(reopenVideoEdit(id)).rejects.toThrow()
  expect(listVideoEditInstances()).toEqual([]); expect(JSON.stringify(savedVideoEdit(instance))).toBe(invalid); expect(boundary.disposedCompilers).toBeGreaterThan(disposed)
})

it('试渲染无回执在期限内释放队列和资源，随后候选可正常创建', async () => {
  const instance = (await createLegacyTrackVideoEditProject())
  vi.useFakeTimers()
  try {
    boundary.trialGate = new Promise(() => {})
    const rejected = expect(createVideoEditCodeItems(instance.document.id, [{ source }])).rejects.toThrow('超过30秒')
    await vi.waitFor(() => expect(boundary.trialCalls).toBe(1))
    await vi.advanceTimersByTimeAsync(30_001); await rejected
    expect(boundary.activeRenderers).toBe(0); expect(instance.document.items).toEqual([]); expect(instance.past).toHaveLength(0)
    boundary.trialGate = undefined
    await createVideoEditCodeItems(instance.document.id, [{ source }]); expect(instance.document.items).toHaveLength(1); expect(boundary.activeRenderers).toBe(0)
  } finally { vi.useRealTimers() }
})

it('公共集合的显式请求取消进入同一候选流程，不提交晚到画面', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const controller = new AbortController()
  let release!: () => void
  boundary.trialGate = new Promise<void>(resolve => { release = resolve })
  const executor = new VideoEditCollectionExecutor('video_edit.code_material')
  const rejected = expect(executor.apply({ kind: 'collection', entityType: executor.entityType, parent: { kind: 'video_edit.document', id: instance.document.id }, expectedRevisions: {}, operation: { kind: 'create', items: [{ properties: { 'video_edit.code_material.source': source } }] } }, { requestId: 'cancel-create', exposure: 'assistant', permissions: new Set(['video_edit:read', 'video_edit:write']), acceptedDataClasses: new Set(['C1']), signal: controller.signal })).rejects.toThrow('请求取消')
  await vi.waitFor(() => expect(boundary.trialCalls).toBe(1)); controller.abort(new Error('请求取消')); await rejected
  expect(instance.document.items).toEqual([]); expect(instance.past).toHaveLength(0); expect(boundary.activeRenderers).toBe(0)
  release()
})

it('候选显示迁移影响，确认后只绑定原片段一次撤销，明确批量更新同原版本片段', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const [item] = await createVideoEditCodeItems(id, [{ source }])
  appendVideoEditItems(id, [item, item], owner.activeSequenceId, { frame: 0 })
  const first = getActiveVideoEditSequence(owner).clips[0]
  editVideoProject(id, document => { document.sequences[0].clips[0].code!.curves = { amount: [{ id: 'curve', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: .7, interpolation: 'linear' }] }; return document })
  const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId: first.id, versionId: first.code!.versionId }
  const baseline = owner.document; const history = owner.past.length
  const candidate = await prepareVideoEditCodeCandidate(target, source.replaceAll('amount', 'opacity'))
  expect(candidate.clipCount).toBe(1); expect(candidate.impacts).toEqual([expect.objectContaining({ key: 'amount', resetValue: true, removeCurve: true })])
  expect(owner.document).toBe(baseline); expect(boundary.activeRenderers).toBe(0)
  expect(() => commitVideoEditCodeCandidate(candidate)).toThrow('确认')
  expect(() => commitVideoEditCodeCandidate({ ...candidate }, true)).toThrow('失效')
  const version = commitVideoEditCodeCandidate(candidate, true)
  expect(owner.past).toHaveLength(history + 1); expect(getActiveVideoEditSequence(owner).clips.map(clip => clip.code!.versionId)).toEqual([version, target.versionId])
  expect(getActiveVideoEditSequence(owner).clips[0].code).toMatchObject({ parameters: { opacity: .5 } })
  expect(getActiveVideoEditSequence(owner).clips[0].code).not.toHaveProperty('curves')
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].code!.curves!.amount).toHaveLength(1)
  const bulk = await prepareVideoEditCodeCandidate(target, source.replace('seed:7', 'seed:8'), 'matching')
  expect(bulk.clipCount).toBe(2); commitVideoEditCodeCandidate(bulk)
  expect(new Set(getActiveVideoEditSequence(owner).clips.map(clip => clip.code!.versionId))).toEqual(new Set([bulk.versionId]))
  expect(getActiveVideoEditSequence(owner).clips[0].code!.curves!.amount).toHaveLength(1)
})

it('取消或剪辑变化释放候选，非法源码和GPU失败保留最后有效源码与历史', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const [item] = await createVideoEditCodeItems(id, [{ source }]); appendVideoEditItems(id, [item], owner.activeSequenceId)
  const clip = getActiveVideoEditSequence(owner).clips[0]
  const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId: clip.id, versionId: clip.code!.versionId }
  const baseline = owner.document; const history = owner.past.length
  await expect(prepareVideoEditCodeCandidate(target, source.replace('return [', 'while(true){}return ['))).rejects.toThrow()
  boundary.failTrial = true; await expect(prepareVideoEditCodeCandidate(target, source.replace('seed:7', 'seed:9'))).rejects.toThrow('GPU trial rejected'); boundary.failTrial = false
  expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
  const candidate = await prepareVideoEditCodeCandidate(target, source.replace('seed:7', 'seed:9'))
  disposeVideoEditCodeCandidate(candidate); expect(() => commitVideoEditCodeCandidate(candidate)).toThrow('失效')
  let release!: () => void; boundary.trialGate = new Promise<void>(resolve => { release = resolve })
  const trialCount = boundary.trialCalls
  const pending = prepareVideoEditCodeCandidate(target, source.replace('seed:7', 'seed:10'))
  await vi.waitFor(() => expect(boundary.trialCalls).toBe(trialCount + 1))
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '期间编辑' }) })); release()
  await expect(pending).rejects.toThrow('内容已改变'); expect(owner.document.sequences[0].name).toBe('期间编辑'); expect(boundary.activeRenderers).toBe(0)
})

it('MCP只追加检查后的不可变版本，显式版本/参数/曲线事务共用手动保存与撤销', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const app = createApplicationHarness()
  try {
    const [item] = await createVideoEditCodeItems(id, [{ source }]); appendVideoEditItems(id, [item], owner.activeSequenceId)
    const definition = owner.document.codeMaterials![0]; const clip = getActiveVideoEditSequence(owner).clips[0]
    const ref = { kind: 'video_edit.clip', id: `${id}:${clip.id}` }; const parent = { kind: 'video_edit.document', id }
    const read = await app.read(parent)
    const created = await app.call('change_application_entities', { summary: '检查并保存新源码版本', changes: [{ kind: 'create_items', entityType: 'video_edit.code_version', parent, items: [{ properties: { 'video_edit.code_version.source': source.replace('max:1', 'max:2'), 'video_edit.code_version.definition_id': definition.id } }] }] }, read.revisions as Record<string, number>)
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const version = owner.document.codeMaterials![0].versions[1].id
    expect(owner.document.codeMaterials![0].defaultVersionId).toBe(definition.defaultVersionId); expect(getActiveVideoEditSequence(owner).clips[0].code!.versionId).toBe(clip.code!.versionId)
    const curves = { amount: [{ id: 'public-curve', sourceInUs: 1001, sourceRemainder: { numerator: 1, denominator: 3 }, value: 1.5, interpolation: 'ease' }] }
    const changed = await app.change(ref, { 'video_edit.clip.code_version_id': version, 'video_edit.clip.code_parameters': { amount: 1.2 }, 'video_edit.clip.code_curves': curves })
    expect(changed, JSON.stringify(changed)).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.clip.code_version_id', 'video_edit.clip.code_curves'])).properties).toEqual({ 'video_edit.clip.code_version_id': version, 'video_edit.clip.code_curves': curves })
    const before = owner.document
    expect((await app.change(ref, { 'video_edit.clip.code_curves': { amount: [{ ...curves.amount[0], value: 3 }] } })).ok).toBe(false); expect(owner.document).toBe(before)
    expect((await app.change({ kind: 'video_edit.code_version', id: `${id}:${version}` }, { 'video_edit.code_version.source': source })).ok).toBe(false)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].code!.versionId).toBe(clip.code!.versionId)
    undoVideoEdit(id, true); await saveVideoEdit(id); await closeVideoEditProject(id)
    const reopened = await reopenVideoEdit(owner.document.id)
    expect(getActiveVideoEditSequence(reopened).clips[0].code).toMatchObject({ versionId: version, parameters: { amount: 1.2 }, curves })
  } finally { app.dispose() }
})

it('图片参数引用原媒体，经同一候选检查后写入；失败无半导入，MCP回读与手动一致', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const app = createApplicationHarness()
  const imageSource = 'export default {apiVersion:1,name:"透明图片",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:4,seed:1,parameters:{logo:{type:"image",title:"徽标",default:null,animatable:false}},render(ctx){return [image({source:ctx.params.logo,x:0,y:0,width:100,height:100})];}}'
  try {
    const [item] = await createVideoEditCodeItems(id, [{ source: imageSource }]); appendVideoEditItems(id, [item], owner.activeSequenceId)
    const clip = getActiveVideoEditSequence(owner).clips[0]
    const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId: clip.id, versionId: clip.code!.versionId }
    let select!: (path: string) => void
    vi.spyOn(getPlatform().system.dialog, 'open').mockImplementationOnce(() => new Promise<string>(resolve => { select = resolve }))
    const trialsBeforeDialog = boundary.trialCalls
    const selecting = chooseVideoEditCodeImage(target, 'logo')
    editVideoProject(id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '图片选择期间的修改' }) })); const dialogBaseline = owner.document
    select('D:/picked.png'); await expect(selecting).rejects.toThrow('内容已改变')
    expect(owner.document).toBe(dialogBaseline); expect(boundary.trialCalls).toBe(trialsBeforeDialog)
    appendVideoEditMedia(id, { id: 'image', kind: 'image', path: 'D:/original.png', name: '原图', width: 3840, height: 2160, durationSeconds: 0, assetId: 'original-asset' })
    const before = owner.document; const history = owner.past.length
    boundary.failTrial = true; await expect(bindVideoEditCodeImage(target, 'logo', { kind: 'media', mediaId: 'image' })).rejects.toThrow('GPU trial rejected'); boundary.failTrial = false
    expect(owner.document).toBe(before)
    await bindVideoEditCodeImage(target, 'logo', { kind: 'media', mediaId: 'image' })
    expect(owner.past).toHaveLength(history + 1)
    const ref = { kind: 'video_edit.clip', id: `${id}:${clip.id}` }
    expect((await app.read(ref, ['video_edit.clip.code_parameters'])).properties).toEqual({ 'video_edit.clip.code_parameters': { logo: { kind: 'image', mediaId: 'image' } } })
    expect((await app.change(ref, { 'video_edit.clip.code_parameters': { logo: { kind: 'image', mediaId: 'foreign' } } })).ok).toBe(false)
    const collectionBefore = owner.document; const collectionHistory = owner.past.length
    for (const [entityType, properties] of [
      ['video_edit.item', { 'video_edit.item.name': '伪造代码项', 'video_edit.item.kind': 'code', 'video_edit.item.code': { ...clip.code!, parameters: { logo: { kind: 'image', mediaId: 'image' } } } }],
      ['video_edit.sequence', { 'video_edit.sequence.name': '隐藏片段', 'video_edit.sequence.clips': [getActiveVideoEditSequence(owner).clips[0]] }],
    ] as const) {
      const parent = { kind: 'video_edit.document', id }
      expect(await app.call('change_application_entities', { summary: '检查集合边界', changes: [{ kind: 'create_items', entityType, parent, items: [{ properties }] }] }, (await app.read(parent)).revisions as Record<string, number>)).toMatchObject({ ok: false })
      expect(owner.document).toBe(collectionBefore); expect(owner.past).toHaveLength(collectionHistory)
    }
    const parent = { kind: 'video_edit.sequence', id: `${id}:${owner.activeSequenceId}` }
    const creating = { summary: '创建引用图片的代码实例', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent, items: [{ properties: { 'video_edit.clip.item_id': item, 'video_edit.clip.kind': 'code', 'video_edit.clip.name': '图片实例', 'video_edit.clip.code_parameters': { logo: { kind: 'image', mediaId: 'image' } } } }] }] }
    boundary.failTrial = true
    expect(await app.call('change_application_entities', creating, (await app.read(parent)).revisions as Record<string, number>)).toMatchObject({ ok: false })
    expect(owner.document).toBe(collectionBefore); expect(owner.past).toHaveLength(collectionHistory)
    boundary.failTrial = false
    expect(await app.call('change_application_entities', creating, (await app.read(parent)).revisions as Record<string, number>)).toMatchObject({ ok: true })
    expect(owner.past).toHaveLength(collectionHistory + 1); undoVideoEdit(id)
    undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].code!.parameters.logo).toBeNull()
    vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
    vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/')
    vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }))
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3840, height: 2160, close }))
    const original = owner.document; boundary.failTrial = true
    await expect(bindVideoEditCodeImage(target, 'logo', { kind: 'file', path: 'D:/new-original.png' })).rejects.toThrow('GPU trial rejected')
    expect(owner.document).toBe(original); expect(owner.document.media).toHaveLength(1)
    boundary.failTrial = false; const historyBefore = owner.past.length
    await bindVideoEditCodeImage(target, 'logo', { kind: 'file', path: 'D:/new-original.png' })
    expect(owner.past).toHaveLength(historyBefore + 1); expect(owner.document.media.at(-1)!.path).toBe('D:/new-original.png'); expect(close).toHaveBeenCalledTimes(2)
    const mediaId = owner.document.media.at(-1)!.id
    expect(getActiveVideoEditSequence(owner).clips[0].code!.parameters.logo).toEqual({ kind: 'image', mediaId })
    await saveVideoEdit(id); await closeVideoEditProject(id); const reopened = await reopenVideoEdit(owner.document.id)
    expect(getActiveVideoEditSequence(reopened).clips[0].code!.parameters.logo).toEqual({ kind: 'image', mediaId })
    expect(reopened.document.media.at(-1)!.path).toBe('D:/new-original.png')
  } finally { app.dispose(); vi.unstubAllGlobals() }
})

it.each(['cancel', 'edit'] as const)('图片候选试渲染已结束后发生%s，发布瞬间守卫拒绝旧草稿', async action => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const imageSource = 'export default {apiVersion:1,name:"图片守卫",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:4,seed:1,parameters:{logo:{type:"image",title:"徽标",default:null,animatable:false}},render(ctx){return [image({source:ctx.params.logo,x:0,y:0,width:100,height:100})];}}'
  const [item] = await createVideoEditCodeItems(id, [{ source: imageSource }]); appendVideoEditItems(id, [item], owner.activeSequenceId)
  appendVideoEditMedia(id, { id: 'guard-image', name: '原图', kind: 'image', path: 'D:/guard.png', width: 100, height: 100, durationSeconds: 0 })
  const clip = getActiveVideoEditSequence(owner).clips[0]
  const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId: clip.id, versionId: clip.code!.versionId }
  const controller = new AbortController(); const detach = controller.signal.removeEventListener.bind(controller.signal)
  let baseline = owner.document; let scheduled = false
  vi.spyOn(controller.signal, 'removeEventListener').mockImplementation((type, callback, options) => {
    detach(type, callback, options)
    if (type === 'abort' && !scheduled) { scheduled = true; queueMicrotask(() => {
      if (action === 'cancel') controller.abort(new Error('候选完成后取消'))
      else { editVideoProject(id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '候选完成后的手动修改' }) })); baseline = owner.document }
    }) }
  })
  await expect(bindVideoEditCodeImage(target, 'logo', { kind: 'media', mediaId: 'guard-image' }, controller.signal)).rejects.toThrow(action === 'cancel' ? '候选完成后取消' : '内容已改变')
  expect(scheduled).toBe(true); expect(owner.document).toBe(baseline)
  expect(getActiveVideoEditSequence(owner).clips[0].code!.parameters.logo).toBeNull()
})

it('滤镜维持单输入边界，不能声明图片资源或把其它参数当作图片绑定', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const app = createApplicationHarness()
  const imageFilter = filterSource.replace('parameters:{', 'parameters:{logo:{type:"image",title:"徽标",default:null,animatable:false},')
  try {
    const item = createVideoEditGraphicItem(id, { kind: 'rect' }); const [clipId] = appendVideoEditItems(id, [item], owner.activeSequenceId)
    const original = owner.document; const originalHistory = owner.past.length
    await expect(createVideoEditFilterMaterials(id, [{ source: imageFilter }])).rejects.toThrow('图片资源参数仅用于生成器')
    expect(owner.document).toBe(original); expect(owner.past).toHaveLength(originalHistory)
    const [definitionId] = await createVideoEditFilterMaterials(id, [{ source: filterSource }])
    const target = { projectId: id, sequenceId: owner.activeSequenceId, clipId }
    const effectId = await createVideoEditEffect(target, { definitionId })
    const effect = getActiveVideoEditSequence(owner).clips.find(clip => clip.id === clipId)!.effects![0]
    const imageTarget = { ...target, effectId, versionId: effect.code.versionId }
    appendVideoEditMedia(id, { id: 'fx-image', kind: 'image', path: 'D:/original-fx.png', name: '滤镜图片', width: 3840, height: 2160, durationSeconds: 0 })
    const before = owner.document; const history = owner.past.length
    await expect(bindVideoEditCodeImage(imageTarget, 'gain', { kind: 'media', mediaId: 'fx-image' })).rejects.toThrow('此参数不是图片引用')
    expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
    const ref = { kind: 'video_edit.effect', id: `${id}:${effectId}` }
    expect((await app.read(ref, ['video_edit.effect.parameters'])).properties).toMatchObject({ 'video_edit.effect.parameters': { gain: .5 } })
    await expect(bindVideoEditCodeImage({ ...imageTarget, versionId: 'foreign' }, 'logo', null)).rejects.toThrow('源码版本已改变')
    expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
  } finally { app.dispose(); vi.unstubAllGlobals() }
})

it('批量候选绑定已有源码版本只检查选定原版本集合，不重复检查已使用新版本的其他片段', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const [item] = await createVideoEditCodeItems(id, [{ source }]); appendVideoEditItems(id, [item, item], owner.activeSequenceId)
  const definition = owner.document.codeMaterials![0]; const nextSource = source.replace('seed:7', 'seed:12')
  const [newVersion] = await createVideoEditCodeVersions(id, [{ definitionId: definition.id, source: nextSource }])
  const first = getActiveVideoEditSequence(owner).clips[0]
  editVideoProject(id, document => {
    document.sequences[0].clips.push(...Array.from({ length: 33 }, (_, index) => ({ ...first, id: `already-new-${index}`, start: (index + 2) * first.duration, code: { ...first.code!, versionId: newVersion } })))
    return document
  })
  const count = boundary.trialCalls
  const candidate = await prepareVideoEditCodeCandidate({ projectId: id, sequenceId: owner.activeSequenceId, clipId: first.id, versionId: first.code!.versionId }, nextSource, 'matching')
  expect(candidate.clipCount).toBe(2); expect(candidate.versionId).toBe(newVersion); expect(boundary.trialCalls - count).toBe(5)
  disposeVideoEditCodeCandidate(candidate)
})

it('代码资产原始参数和有理源曲线一次发布、保存重开、单次撤销，固定源码不依赖源剪辑', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const before = owner.past.length
  const result = await createVideoEditCodeAssetInstance(id, importPublication())
  expect(owner.past).toHaveLength(before + 1); expect(boundary.activeRenderers).toBe(0)
  const code = owner.document.items.find(item => item.id === result.itemId)!.code!
  expect(code.parameters).toEqual({ amount: .7 }); expect(code.curves).toEqual(codeAssetFixture().curves)
  expect(owner.document.codeMaterials![0].versions[0].assetOrigin).toEqual(importPublication().origin)
  await saveVideoEdit(id); const reopened = await reopenVideoEdit(id)
  expect(reopened.document.items[0].code).toEqual(code); expect(reopened.document.codeMaterials![0].versions[0].source).toBe(source)
  const next = await createVideoEditCodeAssetInstance(id, importPublication())
  expect(reopened.document.items).toHaveLength(2); undoVideoEdit(id)
  expect(reopened.document.items.some(item => item.id === next.itemId)).toBe(false); expect(reopened.document.items[0].code).toEqual(code)
})
it('代码资产图片局部ID重映射和依赖媒体在同一次历史提交中发布', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const imageSource = 'export default {apiVersion:1,name:"图片资产",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:4,seed:1,parameters:{logo:{type:"image",title:"徽标",default:null,animatable:false}},render(ctx){return [image({source:ctx.params.logo,x:0,y:0,width:100,height:100})];}}'
  const publication = importPublication({ ...codeAssetFixture(imageSource), parameters: { logo: { kind: 'image', mediaId: 'old-image' } }, curves: undefined, images: [{ id: 'old-image', path: 'D:/original.png', content: { sizeBytes: 10, fileModifiedAt: 20, contentIdentity: 'b'.repeat(64) } }] })
  const media = { id: 'new-image', kind: 'image' as const, name: '原图片', path: 'D:/original.png', width: 100, height: 100, durationSeconds: 0, assetContent: publication.asset.images[0].content, sourceRevision: 'fixed-source' }
  const before = owner.past.length
  await createVideoEditCodeAssetInstance(id, { ...publication, media: [media], mediaIds: new Map([['old-image', media.id]]) })
  expect(owner.past).toHaveLength(before + 1); expect(owner.document.media).toEqual([media]); expect(owner.document.items[0].code!.parameters.logo).toEqual({ kind: 'image', mediaId: 'new-image' })
  undoVideoEdit(id); expect(owner.document.media).toEqual([]); expect(owner.document.items).toEqual([]); expect(owner.document.codeMaterials ?? []).toEqual([])
})
it('代码资产不匹配语言、参数或图片映射均拒绝且不发布部分定义', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const baseline = owner.document
  for (const asset of [{ ...codeAssetFixture(), sourceVersion: { ...codeAssetFixture().sourceVersion, languageVersion: 2 as const } }, { ...codeAssetFixture(), parameters: { amount: 100 } }, { ...codeAssetFixture(), parameters: { amount: { kind: 'image' as const, mediaId: 'not-mapped' } } }]) {
    await expect(createVideoEditCodeAssetInstance(id, importPublication(asset))).rejects.toThrow()
    expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(0); expect(boundary.activeRenderers).toBe(0)
  }
})
it('代码资产filter强制检查隐藏真实目标并保留参数，不制造素材项；动态源时长和锁定拒绝', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const [item] = await createVideoEditCodeItems(id, [{ source }]); const [clipId] = appendVideoEditItems(id, [item], owner.activeSequenceId)
  editVideoSequence(id, owner.activeSequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, opacity: 0 })), tracks: sequence.tracks.map(track => ({ ...track, enabled: false })) }))
  const filterTarget = { sequenceId: owner.activeSequenceId, clipId }; const asset = { ...codeAssetFixture(filterSource), parameters: { gain: .8 }, curves: undefined }; const before = owner.past.length
  boundary.proveFilters = true
  await createVideoEditCodeAssetInstance(id, { ...importPublication(asset), filterTarget }, 'selected-bin-is-not-a-filter-location')
  expect(boundary.filterProofs).toBeGreaterThan(0); expect(owner.past).toHaveLength(before + 1); expect(owner.document.items).toHaveLength(1)
  const clip = getActiveVideoEditSequence(owner).clips[0]; expect(clip.opacity).toBe(0); expect(clip.effects![0].code.parameters.gain).toBe(.8)
  const baseline = owner.document
  await expect(createVideoEditCodeAssetInstance(id, { ...importPublication({ ...asset, sourceVersion: { ...asset.sourceVersion, source: filterSource.replace('mode:"static"', 'mode:"dynamic"').replace('durationSeconds:10', 'durationSeconds:1') } }), filterTarget })).rejects.toThrow()
  expect(owner.document).toBe(baseline)
  editVideoSequence(id, owner.activeSequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, locked: true })) }))
  const locked = owner.document; await expect(createVideoEditCodeAssetInstance(id, { ...importPublication(asset), filterTarget })).rejects.toThrow('锁定'); expect(owner.document).toBe(locked)
})
it.each(['cancel', 'edit', 'identity'] as const)('代码资产最终%s检查不发布旧候选或泄漏资源', async action => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const baseline = owner.document; const controller = new AbortController()
  await expect(createVideoEditCodeAssetInstance(id, { ...importPublication(), beforePublish: async () => {
    if (action === 'cancel') controller.abort(new Error('已取消'))
    if (action === 'edit') editVideoProject(id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '后续手工修改' }) }))
    if (action === 'identity') throw new Error('原文件身份已变')
  } }, undefined, controller.signal)).rejects.toThrow()
  expect(owner.document.items).toHaveLength(0); expect(owner.document.codeMaterials ?? []).toHaveLength(0); expect(boundary.activeRenderers).toBe(0)
  if (action !== 'edit') { expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(0) } else expect(owner.document.sequences[0].name).toBe('后续手工修改')
})
it('代码资产未授权图片在任何媒体探测之前被拒绝，原目标零改动', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const baseline = owner.document
  const imageSource = 'export default {apiVersion:1,name:"图片资产",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:4,seed:1,parameters:{logo:{type:"image",title:"徽标",default:null,animatable:false}},render(ctx){return [image({source:ctx.params.logo,x:0,y:0,width:100,height:100})];}}'
  const manifest = { ...codeAssetFixture(imageSource), parameters: { logo: { kind: 'image' as const, mediaId: 'original' } }, curves: undefined, images: [{ id: 'original', path: 'D:/unauthorized/original.png', content: { sizeBytes: 10, fileModifiedAt: 20, contentIdentity: 'b'.repeat(64) } }] }
  const bytes = encodeCodeAsset(manifest)
  vi.spyOn(assetApplicationService, 'inspect').mockResolvedValue({ id: 'code-asset', mediaType: 'code', filePath: 'D:/asset.henji-code', inspectionStatus: 'ready', sizeBytes: bytes.length, fileModifiedAt: 20, contentIdentity: 'a'.repeat(64) } as AssetRecord)
  vi.spyOn(getPlatform().system.fs, 'readFile').mockResolvedValue(bytes)
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockRejectedValue(new Error('未获得读取权限'))
  const probe = vi.spyOn(mediaService, 'inspectVideoEditMedia'); const allow = vi.spyOn(getPlatform().media, 'allowRoot')
  await expect(importVideoEditCodeAsset(owner.document.id, 'code-asset')).rejects.toThrow('读取权限')
  expect(probe).not.toHaveBeenCalled(); expect(allow).not.toHaveBeenCalled(); expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(0)
})

it('代码资产收录失败保留清单；重试不再选路径、写文件、编译或生成历史，保存的是原参数与曲线', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const created = await createVideoEditCodeAssetInstance(id, importPublication()); const baseline = owner.document; const history = owner.past.length
  const { bytes, platform } = collectionBoundary(); const compiled = boundary.compileCalls; const rendered = boundary.trialCalls
  vi.mocked(platform.system.dialog.save).mockClear()
  vi.mocked(platform.system.dialog.save).mockResolvedValue('D:/original.henji-code')
  vi.mocked(platform.assetLibrary.createAsset).mockRejectedValueOnce(new Error('暂不可收录'))
  const target = { kind: 'item' as const, itemId: created.itemId! }
  await expect(collectVideoEditCodeAsset(id, target)).rejects.toThrow('暂不可收录')
  expect(bytes.has('D:/original.henji-code')).toBe(true)
  const manifest = decodeCodeAsset(bytes.get('D:/original.henji-code')!)
  expect(manifest.parameters.amount).toBe(.7); expect(manifest.curves).toEqual(codeAssetFixture().curves)
  expect(manifest.sourceVersion).toEqual(codeAssetFixture().sourceVersion); expect('assetOrigin' in manifest.sourceVersion).toBe(false)
  expect(await collectVideoEditCodeAsset(id, target)).toMatchObject({ mediaType: 'code', filePath: 'D:/original.henji-code', source: 'video-edit' })
  expect(platform.system.fs.writeFile).toHaveBeenCalledOnce(); expect(platform.system.dialog.save).toHaveBeenCalledOnce()
  expect(boundary.compileCalls).toBe(compiled); expect(boundary.trialCalls).toBe(rendered); expect(owner.document).toBe(baseline); expect(owner.past).toHaveLength(history)
})

it('公共收录引用确切附加效果，清单不包含选中片段的生成器；跨剪辑目标拒绝', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const [item] = await createVideoEditCodeItems(id, [{ source }]); const [clipId] = appendVideoEditItems(id, [item], owner.activeSequenceId)
  const asset = { ...codeAssetFixture(filterSource), parameters: { gain: .8 }, curves: undefined }
  await createVideoEditCodeAssetInstance(id, { ...importPublication(asset), filterTarget: { sequenceId: owner.activeSequenceId, clipId } })
  const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]; const { bytes, platform } = collectionBoundary()
  vi.mocked(platform.system.dialog.save).mockResolvedValue('D:/filter.henji-code')
  const app = createApplicationHarness()
  try {
    const input = { documentRef: { kind: 'video_edit.document', id }, targetRef: { kind: 'video_edit.effect', id: `${id}:${effect.id}` } }
    const result = await app.call('collect_video_edit_code_asset', input)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { resultRef: { kind: 'asset' }, verification: { verified: true } } })
    expect(decodeCodeAsset(bytes.get('D:/filter.henji-code')!)).toMatchObject({ sourceVersion: { source: filterSource }, parameters: { gain: .8 } })
    expect((await app.call('collect_video_edit_code_asset', { ...input, documentRef: { kind: 'video_edit.document', id: 'other-project' } })).ok).toBe(false)
    expect(platform.system.fs.writeFile).toHaveBeenCalledOnce()
  } finally { app.dispose() }
})

it('代码清单选择路径期间剪辑修改或取消不写文件、不收录资产', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const created = await createVideoEditCodeAssetInstance(id, importPublication())
  const { platform } = collectionBoundary(); const target = { kind: 'item' as const, itemId: created.itemId! }
  vi.mocked(platform.system.dialog.save).mockImplementationOnce(async () => { editVideoProject(id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '保存期间的新名称' }) })); return 'D:/late.henji-code' })
  await expect(collectVideoEditCodeAsset(id, target)).rejects.toThrow('已有修改')
  vi.mocked(platform.system.dialog.save).mockResolvedValueOnce(null)
  expect(await collectVideoEditCodeAsset(id, target)).toBeNull()
  expect(platform.system.fs.writeFile).not.toHaveBeenCalled(); expect(platform.assetLibrary.createAsset).not.toHaveBeenCalled(); expect(owner.document.sequences[0].name).toBe('保存期间的新名称')
})

it.each([false, true])('旧无身份图片正式重探测：尺寸变化%s；同尺寸刷新原会话版本，保留正式资产绑定', async resized => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  editVideoProject(id, document => ({ ...document, media: [{ id: 'existing-image', name: '原图片', kind: 'image', path: 'D:/original.png', width: 100, height: 100, durationSeconds: 0, sourceRevision: 'cached-original', assetId: 'current-real-asset' }] }))
  const baseline = owner.document
  const imageSource = 'export default {apiVersion:1,name:"图片资产",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:4,seed:1,parameters:{logo:{type:"image",title:"徽标",default:null,animatable:false}},render(ctx){return [image({source:ctx.params.logo,x:0,y:0,width:100,height:100})];}}'
  const manifest: CodeAsset = { ...codeAssetFixture(imageSource), parameters: { logo: { kind: 'image', mediaId: 'local-image' } }, curves: undefined, images: [{ id: 'local-image', path: 'D:/original.png', assetId: 'deleted-source-asset', content: { sizeBytes: 10, fileModifiedAt: 20, contentIdentity: 'a'.repeat(64) } }] }
  const { bytes } = collectionBoundary(); bytes.set('D:/source.henji-code', encodeCodeAsset(manifest))
  vi.spyOn(assetApplicationService, 'inspect').mockResolvedValue({ id: 'code-asset', mediaType: 'code', filePath: 'D:/source.henji-code', inspectionStatus: 'ready', sizeBytes: bytes.get('D:/source.henji-code')!.length, fileModifiedAt: 20, contentIdentity: 'a'.repeat(64) } as AssetRecord)
  const probe = vi.spyOn(mediaService, 'inspectVideoEditMedia').mockResolvedValue({ id: 'temporary-probe-id', name: '探测图', kind: 'image', path: 'D:/original.png', width: resized ? 200 : 100, height: 100, durationSeconds: 0 })
  if (resized) { await expect(importVideoEditCodeAsset(id, 'code-asset')).rejects.toThrow('重新定位'); expect(owner.document).toBe(baseline) }
  else {
    await importVideoEditCodeAsset(id, 'code-asset')
    expect(owner.document.media).toHaveLength(1)
    expect(owner.document.media[0]).toMatchObject({ id: 'existing-image', assetId: 'current-real-asset', assetContent: manifest.images[0].content })
    expect(owner.document.media[0].sourceRevision).not.toBe('cached-original')
    expect(owner.document.items[0].code!.parameters.logo).toEqual({ kind: 'image', mediaId: 'existing-image' })
  }
  expect(probe).toHaveBeenCalledOnce(); expect(boundary.activeRenderers).toBe(0)
})

it('真正新原图片依赖经正式导入 facade 固定身份、保存重开与一次撤销，不伪造库记录', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id
  const imageSource = 'export default {apiVersion:1,name:"图片资产",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:4,seed:1,parameters:{logo:{type:"image",title:"徽标",default:null,animatable:false}},render(ctx){return [image({source:ctx.params.logo,x:0,y:0,width:100,height:100})];}}'
  const manifest: CodeAsset = { ...codeAssetFixture(imageSource), parameters: { logo: { kind: 'image', mediaId: 'local-image' } }, curves: undefined, images: [{ id: 'local-image', path: 'D:/original.png', assetId: 'deleted-source-asset', content: { sizeBytes: 10, fileModifiedAt: 20, contentIdentity: 'a'.repeat(64) } }] }
  const { bytes } = collectionBoundary(); bytes.set('D:/source.henji-code', encodeCodeAsset(manifest))
  vi.spyOn(assetApplicationService, 'inspect').mockResolvedValue({ id: 'code-asset', mediaType: 'code', filePath: 'D:/source.henji-code', inspectionStatus: 'ready', sizeBytes: bytes.get('D:/source.henji-code')!.length, fileModifiedAt: 20, contentIdentity: 'a'.repeat(64) } as AssetRecord)
  vi.spyOn(mediaService, 'inspectVideoEditMedia').mockResolvedValue({ id: 'fresh-image', name: '原图', kind: 'image', path: 'D:/original.png', width: 100, height: 100, durationSeconds: 0 })
  await importVideoEditCodeAsset(id, 'code-asset')
  expect(owner.past).toHaveLength(1); expect(owner.document.media[0]).toMatchObject({ id: 'fresh-image', assetContent: manifest.images[0].content }); expect(owner.document.media[0].assetId).toBeUndefined()
  expect(owner.document.items[0].code!.parameters.logo).toEqual({ kind: 'image', mediaId: 'fresh-image' })
  undoVideoEdit(id); expect(owner.document.media).toHaveLength(0); expect(owner.document.items).toHaveLength(0)
  await importVideoEditCodeAsset(id, 'code-asset'); await saveVideoEdit(id)
  const reopened = await reopenVideoEdit(id)
  expect(reopened.document.media[0].assetContent).toEqual(manifest.images[0].content); expect(reopened.document.media[0].assetId).toBeUndefined(); expect(reopened.document.items[0].code!.parameters.logo).toEqual({ kind: 'image', mediaId: 'fresh-image' })
})
