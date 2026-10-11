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
  const block = (): void => feed({ firstFrame: 0, sampleRate: 48000, samples: new Float32Array(48000), monoStartUs: 0, uncertaintyUs: 1000 })
  const point = (): void => { wall = 300; adapter.recordPointer({ point: [.4, .4], viewPoint: [240, 160], documentPoint: [240, 160], refs: [{ ...imageEditV3LayerRef(doc.id, 'a'), label: 'a' }], selectedRefs: ['a', 'b', 'c'].map(id => imageEditV3LayerRef(doc.id, id)), phase: 'down', geometry: { compositionSize: [600, 400], validViewRect: [0, 0, 600, 400], documentToView: [1, 0, 0, 1, 0, 0], crop: [0, 0, 600, 400], pixelRatio: 1, orientationTurns: 0 } }) }
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
})
