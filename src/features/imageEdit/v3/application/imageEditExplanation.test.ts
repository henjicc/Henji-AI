// @vitest-environment jsdom
import { installPaidApprovalTestBridge } from '@/tests/paidApprovalTestKit'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getDocumentOperations } from '@/features/documents/documentOperations'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { CapturedAudioBlock } from '@/features/creativeIntent'
import type { RecordingAudioPlatform, RecordingAudioResult } from '@/core/audioEdit/recordingAudio'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { ImageEditExplanation } from './imageEditExplanation'
import { imageLayoutDigest } from './imageEditLayoutResources'
import { imageEditV3LayerRef } from './imageEditDocumentRefs'
import { explanationSessionSchema } from '@/core/creativeIntent/schema'
import { confirmedExplanationBinding } from '@/core/creativeIntent/deixis'
import { explanationBodyEditor, type ExplanationBodyChanges } from '@/core/creativeIntent/semanticIntentEdits'
import type { ApplicationRef } from '@/core/application-control'

// This suite exercises the recording adapter; the formal generic transaction is
// covered independently in creativeIntentExplanation.test.ts.
vi.mock('@/core/creativeIntent/semanticIntentEdits', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/creativeIntent/semanticIntentEdits')>()
  return { ...actual, writeExplanationBody: (ref: ApplicationRef, changes: ExplanationBodyChanges) => actual.explanationBodyEditor(ref).apply(changes) }
})

vi.mock('./imageEditLayoutDraft', () => ({ imageEditLayoutDraft: () => ({ organize, move }) }))
const organize = vi.hoisted(() => vi.fn(async () => {}))
const move = vi.hoisted(() => vi.fn(async () => {}))
let wall = 0
beforeEach(() => { installHarnessNativeStorage(); installPaidApprovalTestBridge(); vi.spyOn(getDocumentOperations(), 'findDocument').mockRejectedValue(Object.assign(new Error('工具箱文档'), { name: 'DocumentNotFoundError' })); vi.stubGlobal('crypto', webcrypto); wall = 0; vi.spyOn(performance, 'now').mockImplementation(() => wall); organize.mockClear() })
afterEach(() => { vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
function setup(names: readonly string[] = ['a', 'b', 'c']) {
  const doc = createImageEditDocumentV3({ documentId: 'record-image', width: 600, height: 400 })
  doc.layers = ['a', 'b', 'c'].map((id, index) => createImageEditRasterLayerV3(id, names[index]))
  const bus = new ImageEditCommandBusV3(doc), values = new Map<string, unknown>()
  let feed: (block: CapturedAudioBlock) => void = () => {}
  const stop = vi.fn(async () => {})
  const audio: RecordingAudioPlatform = {
    write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array()), erase: vi.fn(async () => {}), release: vi.fn(async () => {}), archive: vi.fn(), restore: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    preflight: vi.fn(async () => {}),
    transcribe: vi.fn(async (): Promise<RecordingAudioResult> => ({ modelId: 'fixture.asr', providerId: 'fixture', requestId: 'fixture', transcript: { unit: 'ms', text: '这几个等距', words: [], granularity: 'word', segments: [{ text: '这几个等距', startMs: 100, endMs: 700, granularity: 'word', timing: 'precise' }] } })),
  }
  const confirm = vi.fn(async () => {})
  const microphone = vi.fn(async (_origin: number, onBlock: (block: CapturedAudioBlock) => void) => { feed = onBlock; return { stop } })
  const adapter = new ImageEditExplanation(bus, { audio, microphone, model: () => 'fixture.asr', confirm, release: vi.fn(async () => {}),
    store: async (value, kind) => { const digest = await imageLayoutDigest(value); values.set(digest, structuredClone(value)); return { resourceId: digest, digest, bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength, path: `resources/${digest.slice(7)}`, kind } },
    read: async resource => values.get(resource.resourceId), readVisual: async () => new Uint8Array([1, 2, 3]) })
  const block = (length = 48000): void => feed({ firstFrame: 0, sampleRate: 48000, samples: new Float32Array(length), monoStartUs: 0, uncertaintyUs: 1000 })
  const point = (position: [number, number] = [.4, .4], refs: ApplicationRef[] = [{ ...imageEditV3LayerRef(doc.id, 'a'), label: 'a' }], at = 300, capture?: Parameters<ImageEditExplanation['recordPointer']>[0]['capture']): void => { wall = at; adapter.recordPointer({ capture, point: position, viewPoint: [position[0] * 600, position[1] * 400], documentPoint: [position[0] * 600, position[1] * 400], refs, selectedRefs: ['a', 'b', 'c'].map(id => ({ ...imageEditV3LayerRef(doc.id, id), label: id })), phase: 'down', geometry: { compositionSize: [600, 400], validViewRect: [0, 0, 600, 400], documentToView: [1, 0, 0, 1, 0, 0], crop: [0, 0, 600, 400], pixelRatio: 1, orientationTurns: 0 } }) }
  return { adapter, audio, bus, block, point, stop, confirm, values, microphone, feed: (block: CapturedAudioBlock) => feed(block) }
}
describe('图片静态讲解宿主', () => {
  it('统一原生输入为立体声时，讲解只取起始声道并保留帧时长', async () => {
    const f = setup(); await f.adapter.start('consent')
    f.feed({ firstFrame: 0, sampleRate: 48000, channels: 2, samples: new Float32Array([.25, -.5, .25, -.5]), monoStartUs: 0, uncertaintyUs: 1000 })
    wall = 1200; await f.adapter.stop()
    expect(f.audio.write).toHaveBeenCalledWith(expect.objectContaining({ samples: new Float32Array([.25, .25]) }))
    await f.adapter.close()
  })
  it('确认前逐块预检失败不改变会话、不执行转写', async () => {
    const f = setup(); await f.adapter.start('consent'); f.block(); wall = 1200; await f.adapter.stop()
    vi.mocked(f.audio.preflight).mockRejectedValueOnce(new Error('凭据未配置'))
    await expect(f.adapter.preflightTranscription()).rejects.toThrow('凭据未配置')
    expect(f.audio.transcribe).not.toHaveBeenCalled(); expect(f.adapter.snapshot().session?.state).toBe('reviewing')
    await f.adapter.preflightTranscription(); expect(f.audio.preflight).toHaveBeenLastCalledWith(expect.objectContaining({action:'preflight',modelId:'fixture.asr'}))
    await f.adapter.close()
  })
  it('删除包含多页资源的讲解后可重新录制，目录顺序不影响命令资源契约', async () => {
    const f=setup();await f.adapter.start('consent');f.block();f.point();wall=1200
    await f.adapter.stop();await f.adapter.transcribe()
    const document=f.bus.getSnapshot().document,head=structuredClone(document.creativeIntents!)
    head.resources.sort((a,b)=>b.resourceId.localeCompare(a.resourceId))
    f.bus.dispatch({type:'document.set-creative-intents',commandId:'reverse-directory',expectedRevision:document.revision,intents:head,resources:head.resources.map(resource=>({resourceId:resource.resourceId,byteSize:resource.bytes})).sort((a,b)=>a.resourceId.localeCompare(b.resourceId))})
    const layers=structuredClone(document.layers)
    await f.adapter.remove();expect(f.adapter.snapshot().session).toBeUndefined()
    expect(f.bus.getSnapshot().document.layers).toEqual(layers)
    expect(f.bus.getSnapshot().document.creativeIntents!.sessions).toHaveLength(0)
    await f.adapter.start('second-consent');expect(f.adapter.snapshot().session!.state).toBe('recording');await f.adapter.close()
  })
  it('同名图片自动用图层位置区分，不改变稳定引用', async () => {
    const f = setup(['主图', '主图', 'c']); await f.adapter.start('consent'); f.block(); f.point(); wall = 1200
    await f.adapter.stop(); await f.adapter.transcribe()
    const review = await f.adapter.readReview((await f.adapter.transcript())[0])
    expect(review.objects?.map(object => object.label)).toEqual(['主图 · 上层', '主图 · 下层', 'c'])
    expect(review.objects?.map(object => object.ref.id)).toEqual(['a', 'b', 'c'].map(id => imageEditV3LayerRef('record-image', id).id))
    await f.adapter.close()
  })
  it('墙钟采集、分页持久化、本地转写、选中目标进入唯一随手摆服务', async () => {
    const bridge = installPaidApprovalTestBridge()
    const f = setup(); await f.adapter.start('user-consent'); f.block(); f.point(); wall = 1200
    await f.adapter.stop(); await f.adapter.transcribe()
    expect([...bridge.records.values()]).toMatchObject([{ origin: { actor: 'user' }, state: 'completed', paidReservations: [{ category: 'recognition' }] }])
    const session = explanationSessionSchema.parse(f.bus.getSnapshot().document.creativeIntents!.sessions[0])
    expect(session.mode).toBe('static'); expect(session.clockSegments.every(c => !c.start && !c.end)).toBe(true)
    const events = []; for await (const e of f.adapter.events()) events.push(e)
    expect(events.every(e => e.timeline === null && e.unavailableReason === 'static')).toBe(true)
    const entries = await f.adapter.transcript(); expect(entries[0]).toMatchObject({ text: '这几个等距', monoSpanUs: [100000, 700000] })
    const review = await f.adapter.readReview(entries[0]); expect(review.resolution.mentions[0].selected?.targetRefs).toHaveLength(3)
    expect(review.layout).toMatchObject({ action: 'distribute' }); expect(review.plan.issues).toEqual([])
    const before = structuredClone(f.bus.getSnapshot().document.layers)
    await f.adapter.organize(entries[0]); expect(organize).toHaveBeenCalledWith(['a', 'b', 'c'], 'distribute')
    expect(f.bus.getSnapshot().document.layers).toEqual(before)
    expect(f.audio.transcribe).toHaveBeenCalledTimes(1); await f.adapter.transcribe(); expect(f.audio.transcribe).toHaveBeenCalledTimes(1)
    await f.adapter.close(); expect(f.stop).toHaveBeenCalledTimes(1)
  })
  it('暂停、恢复保留 gap，不录制暂停期间的指向，关闭释放音轨', async () => {
    const f = setup(); await f.adapter.start('consent'); f.block(); wall = 1100; await f.adapter.pause(); f.point()
    wall = 1500; await f.adapter.resume(); wall = 1600; await f.adapter.stop()
    expect(f.adapter.snapshot().session!.clockSegments.some(c => c.mode === 'gap')).toBe(true)
    const events = []; for await (const e of f.adapter.events('pointer')) events.push(e)
    expect(events).toHaveLength(0); await f.adapter.close(); expect(f.stop).toHaveBeenCalledTimes(2)
  })
  it('保存失败保留封页，重试不会重复写音频或丢掉词稿', async () => {
    const f = setup(); await f.adapter.start('consent'); f.block(); wall = 1200
    f.confirm.mockRejectedValueOnce(new Error('disk'))
    await expect(f.adapter.stop()).rejects.toThrow('disk'); await f.adapter.stop()
    await f.adapter.transcribe(); expect(await f.adapter.transcript()).toHaveLength(1)
    expect(f.audio.write).toHaveBeenCalledTimes(1); await f.adapter.close()
  })
  it('录制范围必须给出，采集与停止不自动调用转写供应商', async () => {
    const f = setup(); await expect(f.adapter.start('')).rejects.toThrow('录制范围')
    expect(f.microphone).not.toHaveBeenCalled()
    await f.adapter.start('consent'); f.block(); wall = 1200; await f.adapter.stop()
    expect(f.audio.transcribe).not.toHaveBeenCalled(); await f.adapter.close()
  })
  it('把这个放到那边按词级墙钟生成位置计划，不修改作品或调用付费意图模型', async () => {
    const f = setup()
    vi.mocked(f.audio.transcribe).mockResolvedValueOnce({ modelId: 'fixture.asr', providerId: 'fixture', requestId: 'fixture', transcript: { unit: 'ms', text: '把这个放到那边', granularity: 'word', words: [], segments: [{ text: '把这个放到那边', startMs: 200, endMs: 2200, granularity: 'segment', timing: 'coarse', words: [{ text: '把这个', startMs: 200, endMs: 400, granularity: 'word', timing: 'precise' }, { text: '放到那边', startMs: 2000, endMs: 2200, granularity: 'word', timing: 'precise' }] }] } })
    await f.adapter.start('consent'); f.block(144000); f.point(); f.point([.8, .5], [], 2100); wall = 3200
    await f.adapter.stop(); await f.adapter.transcribe()
    const entry = (await f.adapter.transcript())[0], before = structuredClone(f.bus.getSnapshot().document.layers)
    const review = await f.adapter.readReview(entry)
    expect(review.plan.status).toBe('review'); expect(review.plan.changes).toHaveLength(1)
    expect(review.plan.changes[0]).toMatchObject({ targetRef: { label: 'a' }, property: 'position', after: [.8, .5] })
    expect(review.resolution.mentions.every(m => m.selected?.timeline === null)).toBe(true)
    expect(review.image).toBeUndefined(); expect(f.bus.getSnapshot().document.layers).toEqual(before)
    await f.adapter.generate([entry]);expect(move).toHaveBeenCalledWith([expect.objectContaining({status:'review',changes:expect.any(Array)})])
    expect(f.bus.getSnapshot().document.layers).toEqual(before)
    await f.adapter.close()
  })
  it('没有历史指向时人工点选可以确认对象，校正没有历史画面；取消与关闭释放点选等待', async () => {
    const f = setup()
    vi.mocked(f.audio.transcribe).mockResolvedValueOnce({ modelId: 'fixture.asr', providerId: 'fixture', requestId: 'fixture', transcript: { unit: 'ms', text: '这个', words: [], granularity: 'segment', segments: [{ text: '这个', startMs: 100, endMs: 700, granularity: 'segment', timing: 'coarse' }] } })
    await f.adapter.start('consent'); f.block(); wall = 1200; await f.adapter.stop(); await f.adapter.transcribe()
    const entry = (await f.adapter.transcript())[0], review = await f.adapter.readReview(entry)
    const picking = f.adapter.pick(entry, review.resolution.mentions[0]); expect(f.adapter.hasPendingPick()).toBe(true)
    f.adapter.acceptPick([.6, .5], [{ ...imageEditV3LayerRef('record-image', 'a'), label: 'a' }], [])
    await picking
    const corrected = await f.adapter.readReview(entry)
    expect(corrected.resolution.mentions[0].confirmedByUser).toBe(true); expect(corrected.image).toBeUndefined()
    const waiting = f.adapter.pick(entry, corrected.resolution.mentions[0]); await f.adapter.close(); await waiting
    expect(f.adapter.hasPendingPick()).toBe(false)
  })
  it('粗时间的这几个需确认完整集合，不能偷偷裁成一个图层', async () => {
    const f = setup()
    vi.mocked(f.audio.transcribe).mockResolvedValueOnce({ modelId: 'fixture.asr', providerId: 'fixture', requestId: 'fixture', transcript: { unit: 'ms', text: '这几个等距', words: [], granularity: 'segment', segments: [{ text: '这几个等距', startMs: 100, endMs: 700, granularity: 'segment', timing: 'coarse' }] } })
    await f.adapter.start('consent'); f.block(); f.point(); wall = 1200; await f.adapter.stop(); await f.adapter.transcribe()
    const entry = (await f.adapter.transcript())[0], review = await f.adapter.readReview(entry)
    expect(review.layout).toBeUndefined()
    const mention = review.resolution.mentions[0]
    const binding = confirmedExplanationBinding(mention, mention.candidates[0])
    await expect(f.adapter.bind(entry, { ...binding, targetRefs: binding.targetRefs.slice(0, 1) })).rejects.toThrow('完整候选')
    await f.adapter.bind(entry, binding)
    expect((await f.adapter.readReview(entry)).layout?.targetRefs).toHaveLength(3)
    await f.adapter.close()
  })
})

it('词稿校正只改文字；保存重开和原历史撤销不会被 collector 覆盖', async () => {
  const f = setup(); await f.adapter.start('consent'); f.block(); f.point(); wall = 1200
  await f.adapter.stop(); await f.adapter.transcribe()
  const original = (await f.adapter.transcript())[0]
  const before = structuredClone(f.adapter.snapshot().session!)
  await f.adapter.correctText(original, '这几个对齐')
  const corrected = (await f.adapter.transcript())[0]
  expect(corrected).toMatchObject({ text: '这几个对齐', originalEventRef: original.eventId, monoSpanUs: original.monoSpanUs, timelineSpans: original.timelineSpans })
  expect((await f.adapter.readReview(corrected)).layout?.action).toBe('align')
  expect(f.adapter.snapshot().session!.corrections).toHaveLength(1)
  await f.adapter.reopen(before.id)
  expect((await f.adapter.transcript())[0].text).toBe('这几个对齐')
  expect(f.bus.undo()).toBe(true)
  expect((await f.adapter.transcript())[0].text).toBe(original.text)
  await f.adapter.save()
  expect(f.bus.getSnapshot().document.creativeIntents!.sessions[0].corrections).toEqual(before.corrections)
  const editor = explanationBodyEditor({ kind: 'image_edit.explanation_body', id: `v3:record-image:${before.id}` })
  await f.adapter.remove()
  await expect(editor.restore(before)).rejects.toThrow('讲解已删除')
  await f.adapter.close()
})

it.each([false, true])('删除讲解保留正文资源并支持撤销重做，冷页=%s', async cold => {
  const f = setup(); await f.adapter.start('consent'); f.block()
  const visualId = `sha256:${'e'.repeat(64)}`; f.values.set(visualId, new Uint8Array([1, 2, 3]))
  f.point([.4, .4], [imageEditV3LayerRef('record-image', 'a')], 300, async () => ({ resource: { resourceId: visualId, digest: visualId, bytes: 3, path: `resources/${visualId.slice(7)}`, kind: 'visual' }, size: [100, 100], point: [.4, .4] }))
  wall = 1200; await f.adapter.stop(); await f.adapter.transcribe()
  const original = (await f.adapter.transcript())[0]
  await f.adapter.correctText(original, '可恢复的讲解正文')
  const session = f.adapter.snapshot().session!, privateRefs = [...session.pages.map(page => page.resourceId), ...session.visualEvidenceRefs.map(visual => visual.resourceRef.resourceId)]
  const atomicHead = structuredClone(f.bus.getSnapshot().document.creativeIntents!)
  atomicHead.sessions[0].consent!.userReceiptRef = 'atomic-consent'
  f.bus.dispatch({ type: 'document.atomic', commandId: 'private-atomic', expectedRevision: f.bus.getSnapshot().document.revision, commands: [
    { type: 'layer.update-common', commandId: 'atomic-layer', expectedRevision: f.bus.getSnapshot().document.revision, layerId: 'b', patch: { name: '保留原子编辑' } },
    { type: 'document.set-creative-intents', commandId: 'atomic-head', expectedRevision: f.bus.getSnapshot().document.revision, intents: atomicHead, resources: atomicHead.resources.map(r => ({ resourceId: r.resourceId, byteSize: r.bytes })).sort((a, b) => a.resourceId.localeCompare(b.resourceId)) },
  ] })
  f.bus.dispatch({ type: 'layer.update-common', commandId: 'keep-artwork', expectedRevision: f.bus.getSnapshot().document.revision, layerId: 'a', patch: { name: '保留作品编辑' } })
  await f.bus.undo()
  const saved = f.bus.getPersistenceSnapshot(), entries = [...saved.history.undo, ...[...saved.history.redo].reverse()]
  const pageId = `sha256:${'f'.repeat(64)}`
  const history = cold ? { ...saved.history, undo: [], redo: [], cold: {
    checkpoint: { format: 'henji-image-history' as const, version: 2 as const, documentId: saved.document.id, headRevision: saved.document.revision, snapshotVersion: saved.history.version,
      position: saved.history.undo.length, total: entries.length, pages: [{ resourceId: pageId, byteSize: 100, start: 0, count: entries.length }], resources: saved.retainedResources },
    prefixLength: entries.length, position: saved.history.undo.length, commandIds: entries.map(entry => entry.forward.commandId), resourceRoles: { images: [], sparse: [] },
  } } : saved.history
  const bus = new ImageEditCommandBusV3(saved.document, { historySnapshot: history, history: { readPage: async () => structuredClone(entries) } })
  expect(await bus.eraseExplanationSession(session.id)).toEqual([])
  expect(bus.getSnapshot().document.creativeIntents?.sessions).toEqual([])
  expect(await bus.undo()).toBe(true)
  expect(bus.getSnapshot().document.creativeIntents?.sessions[0].id).toBe(session.id)
  expect(await bus.redo()).toBe(true)
  expect(bus.getSnapshot().document.creativeIntents?.sessions).toEqual([])
  const retained = bus.getPersistenceSnapshot().retainedResources.map(ref => ref.resourceId)
  for (const id of privateRefs) expect(retained).toContain(id)
  await f.adapter.close()
})

it('删除保存失败后重试不会把 collector 正文重新写回', async () => {
  const f = setup(); await f.adapter.start('consent'); f.block(); f.point(); wall = 1200
  await f.adapter.stop(); await f.adapter.transcribe()
  const session = f.adapter.snapshot().session!, original = (await f.adapter.transcript())[0]
  f.confirm.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('save failed'))
  await expect(f.adapter.remove()).rejects.toThrow('save failed')
  expect(f.bus.getSnapshot().document.creativeIntents!.sessions).toEqual([])
  await expect(f.adapter.correctText(original, '不能复活')).rejects.toThrow()
  await f.adapter.remove()
  expect(f.adapter.snapshot().session).toBeUndefined()
  expect(f.bus.getSnapshot().document.creativeIntents?.sessions).toEqual([])
  for (const ref of session.pages) expect(f.values.has(ref.resourceId)).toBe(true)
  await f.adapter.close()
})
