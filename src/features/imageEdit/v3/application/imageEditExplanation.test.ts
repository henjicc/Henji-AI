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

vi.mock('./imageEditLayoutDraft', () => ({ imageEditLayoutDraft: () => ({ organize: organize }) }))
const organize = vi.hoisted(() => vi.fn(async () => {}))
let wall = 0
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); wall = 0; vi.spyOn(performance, 'now').mockImplementation(() => wall); organize.mockClear() })
afterEach(() => { vi.restoreAllMocks() })
function setup() {
  const doc = createImageEditDocumentV3({ documentId: 'record-image', width: 600, height: 400 })
  doc.layers = ['a', 'b', 'c'].map(id => createImageEditRasterLayerV3(id, id))
  const bus = new ImageEditCommandBusV3(doc), values = new Map<string, unknown>()
  let feed: (block: CapturedAudioBlock) => void = () => {}
  const stop = vi.fn(async () => {})
  const audio: RecordingAudioPlatform = {
    microphone: vi.fn(async () => {}), write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array()), erase: vi.fn(async () => {}), release: vi.fn(async () => {}), archive: vi.fn(), restore: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    transcribe: vi.fn(async (): Promise<RecordingAudioResult> => ({ modelId: 'fixture.asr', providerId: 'fixture', requestId: 'fixture', transcript: { unit: 'ms', text: '这几个等距', words: [], granularity: 'word', segments: [{ text: '这几个等距', startMs: 100, endMs: 700, granularity: 'word', timing: 'precise' }] } })),
  }
  const confirm = vi.fn(async () => {})
  const adapter = new ImageEditExplanation(bus, { audio, microphone: vi.fn(async (_origin, onBlock) => { feed = onBlock; return { stop } }), model: () => 'fixture.asr', confirm, release: vi.fn(async () => {}),
    store: async (value, kind) => { const digest = await imageLayoutDigest(value); values.set(digest, structuredClone(value)); return { resourceId: digest, digest, bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength, path: `resources/${digest.slice(7)}`, kind } },
    read: async resource => values.get(resource.resourceId), readVisual: async () => new Uint8Array([1, 2, 3]) })
  const block = (length = 48000): void => feed({ firstFrame: 0, sampleRate: 48000, samples: new Float32Array(length), monoStartUs: 0, uncertaintyUs: 1000 })
  const point = (position: [number, number] = [.4, .4], refs = [{ ...imageEditV3LayerRef(doc.id, 'a'), label: 'a' }], at = 300): void => { wall = at; adapter.recordPointer({ point: position, viewPoint: [position[0] * 600, position[1] * 400], documentPoint: [position[0] * 600, position[1] * 400], refs, selectedRefs: ['a', 'b', 'c'].map(id => ({ ...imageEditV3LayerRef(doc.id, id), label: id })), phase: 'down', geometry: { compositionSize: [600, 400], validViewRect: [0, 0, 600, 400], documentToView: [1, 0, 0, 1, 0, 0], crop: [0, 0, 600, 400], pixelRatio: 1, orientationTurns: 0 } }) }
  return { adapter, audio, bus, block, point, stop, confirm, values }
}
describe('图片静态讲解宿主', () => {
  it('墙钟采集、分页持久化、本地转写、选中目标进入唯一随手摆服务', async () => {
    const f = setup(); await f.adapter.start('user-consent'); f.block(); f.point(); wall = 1200
    await f.adapter.stop(); await f.adapter.transcribe('upload-consent')
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
    expect(f.audio.transcribe).toHaveBeenCalledTimes(1); await f.adapter.transcribe('upload-consent'); expect(f.audio.transcribe).toHaveBeenCalledTimes(1)
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
    await f.adapter.transcribe('upload'); expect(await f.adapter.transcript()).toHaveLength(1)
    expect(f.audio.write).toHaveBeenCalledTimes(1); await f.adapter.close()
  })
  it('没有人工同意不打开麦克风，转写前不调用供应商', async () => {
    const f = setup(); await expect(f.adapter.start('')).rejects.toThrow('确认'); expect(f.audio.microphone).not.toHaveBeenCalled()
    await f.adapter.start('consent'); f.block(); wall = 1200; await f.adapter.stop()
    expect(f.audio.transcribe).not.toHaveBeenCalled(); await expect(f.adapter.transcribe('')).rejects.toThrow('授权'); await f.adapter.close()
  })
  it('把这个放到那边按词级墙钟生成位置计划，不修改作品或调用付费意图模型', async () => {
    const f = setup()
    vi.mocked(f.audio.transcribe).mockResolvedValueOnce({ modelId: 'fixture.asr', providerId: 'fixture', requestId: 'fixture', transcript: { unit: 'ms', text: '把这个放到那边', granularity: 'word', words: [], segments: [{ text: '把这个放到那边', startMs: 200, endMs: 2200, granularity: 'segment', timing: 'coarse', words: [{ text: '把这个', startMs: 200, endMs: 400, granularity: 'word', timing: 'precise' }, { text: '放到那边', startMs: 2000, endMs: 2200, granularity: 'word', timing: 'precise' }] }] } })
    await f.adapter.start('consent'); f.block(144000); f.point(); f.point([.8, .5], [], 2100); wall = 3200
    await f.adapter.stop(); await f.adapter.transcribe('upload')
    const entry = (await f.adapter.transcript())[0], before = structuredClone(f.bus.getSnapshot().document.layers)
    const review = await f.adapter.readReview(entry)
    expect(review.plan.status).toBe('review'); expect(review.plan.changes).toHaveLength(1)
    expect(review.plan.changes[0]).toMatchObject({ targetRef: { label: 'a' }, property: 'position', after: [.8, .5] })
    expect(review.resolution.mentions.every(m => m.selected?.timeline === null)).toBe(true)
    expect(review.image).toBeUndefined(); expect(f.bus.getSnapshot().document.layers).toEqual(before)
    await f.adapter.close()
  })
  it('没有历史指向时人工点选可以确认对象，校正没有历史画面；取消与关闭释放点选等待', async () => {
    const f = setup()
    vi.mocked(f.audio.transcribe).mockResolvedValueOnce({ modelId: 'fixture.asr', providerId: 'fixture', requestId: 'fixture', transcript: { unit: 'ms', text: '这个', words: [], granularity: 'segment', segments: [{ text: '这个', startMs: 100, endMs: 700, granularity: 'segment', timing: 'coarse' }] } })
    await f.adapter.start('consent'); f.block(); wall = 1200; await f.adapter.stop(); await f.adapter.transcribe('upload')
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
    await f.adapter.start('consent'); f.block(); f.point(); wall = 1200; await f.adapter.stop(); await f.adapter.transcribe('upload')
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
