import { deflateRawSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { encodeSmartRegionSegment, type SmartRegionSegmentHeader } from '@/core/videoEdit/smartRegions'
import { setVideoEditSmartRegionSegments, videoEditSmartRegionAttentionBox } from './videoEditSmartRegionMasks'
import { analyzeVideoEditReframe } from './videoEditReframeAnalysis'
import { createVideoEditDocument, videoEditComposition } from '@/core/videoEdit/document'
import { evaluateVideoEditKeyframes } from '@/core/videoEdit/keyframes'

afterEach(() => { setVideoEditSmartRegionSegments({}); vi.unstubAllGlobals() })
function serve(header: SmartRegionSegmentHeader, frames: Uint8Array[] = []): void {
  const encoded = encodeSmartRegionSegment(header, frames)
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec((init.headers as Record<string, string>).Range)!
    return new Response(encoded.slice(Number(range[1]), Number(range[2]) + 1).buffer, { status: 206 })
  }))
  setVideoEditSmartRegionSegments({ media: { [header.kind]: [{ url: 'henji-media://cache/result', startUs: header.startUs, endUs: header.endUs, still: false }] } })
}
const base: SmartRegionSegmentHeader = { version: 1, kind: 'face', model: 'test', startUs: 0, endUs: 3000000, fps: 30, frameCount: 90, still: false, sourceWidth: 1920, sourceHeight: 1080, summary: { value: 1, peak: 1 } }
it('读取现有框容器，选最大人脸并复用 Range 读取；不能冒充未覆盖的分析', async () => {
  serve({ ...base, boxes: Array.from({ length: 90 }, () => [[.45, .2, .08, .2, .9, 1], [.1, .1, .02, .02, .9, 2]]) })
  expect(await videoEditSmartRegionAttentionBox('media', 'face', 1000000)).toEqual({ x: .45, y: .2, width: .08, height: .2 })
  await videoEditSmartRegionAttentionBox('media', 'face', 1033333)
  expect(fetch).toHaveBeenCalledTimes(1)
  await expect(videoEditSmartRegionAttentionBox('media', 'face', 4000000)).rejects.toThrow('未覆盖')
})
it('人物蒙版复用原 deflate 容器，阈值求外接框；同分析帧只解压一次，空蒙版为未检出', async () => {
  serve({ ...base, kind: 'person', frameCount: 2, fps: 1, endUs: 2000000, matte: { width: 2, height: 2 } }, [new Uint8Array(deflateRawSync(new Uint8Array([0, 255, 0, 255]))), new Uint8Array(deflateRawSync(new Uint8Array(4)))])
  expect(await videoEditSmartRegionAttentionBox('media', 'person', 0)).toEqual({ x: .5, y: 0, width: .5, height: 1 })
  await videoEditSmartRegionAttentionBox('media', 'person', 0)
  expect(await videoEditSmartRegionAttentionBox('media', 'person', 1000000)).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('真实缓存读取到正式求值，生成运动关键帧；时间和几何沿现有序列契约', async () => {
  serve({ ...base, boxes: Array.from({ length: 90 }, () => [[.45, .2, .08, .2, .9, 1]]) })
  const document = createVideoEditDocument('采访'); const sequence = document.sequences[0]
  document.media = [{ id: 'm', path: 'media', name: '采访', kind: 'video', width: 1920, height: 1080, durationSeconds: 3 }]
  document.items = [{ id: 'item', name: '采访', kind: 'video', mediaId: 'm' }]
  sequence.clips = [{ id: 'clip', itemId: 'item', name: '采访', kind: 'video', track: sequence.tracks.find(track => track.kind === 'video')!.index, start: 0, duration: 90, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }]
  const result = await analyzeVideoEditReframe({ composition: videoEditComposition(document, sequence.id), clipId: 'clip', target: { width: 1080, height: 1920 }, settings: { attention: 'face', motion: 'default' }, segments: { media: { face: [{ url: 'henji-media://cache/result', startUs: 0, endUs: 3000000, still: false }] } }, tracks: {}, cuts: [] })
  expect(result.missingFrames).toBe(0)
  expect(evaluateVideoEditKeyframes(result.clip.curves!.scale, 45, 1)).toBeCloseTo(256 / 81)
  expect(result.clip.curves!.x).toHaveLength(2)
})
