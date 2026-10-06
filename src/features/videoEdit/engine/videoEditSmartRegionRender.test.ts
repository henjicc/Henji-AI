import { afterEach, describe, expect, it, vi } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { buildVideoEditCompositePlan } from '@/core/videoEdit/compositing'
import { createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { encodeSmartRegionSegment, SMART_REGION_FORMAT_VERSION, type SmartRegionSegmentHeader } from '@/core/videoEdit/smartRegions'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { renderVideoEditCompositeScene, videoEditCompositeSurfaceKeys } from './videoEditCompositeScene'
import { VideoEditCodePicture } from './videoEditCodeGpu'
import type { PreparedVideoEditEffect } from './videoEditCodeSources'
import { setVideoEditSmartRegionSegments, videoEditSmartRegionMask } from './videoEditSmartRegionMasks'

const device = {} as GpuDevice
const texture = (): GpuTexture => ({ createView: () => ({}), destroy: () => {} })
const picture = (width = 1920, height = 1080): VideoEditCodePicture => new VideoEditCodePicture(texture(), width, height, device)

function clip(patch: Partial<VideoEditClip> = {}): VideoEditClip {
  return { id: 'c', itemId: 'i', name: 'c', kind: 'video', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 },
    x: 0.2, y: -0.1, scale: 0.5, rotation: 15, opacity: 0.8, brightness: 1.2, volume: 1, text: '',
    effects: [{ id: 'e', name: '马赛克', enabled: true, amount: 0.75, builtin: { id: 'mosaic', params: {} }, mask: { regionId: 'face' } }], ...patch }
}

describe('智能区域：合成场景', () => {
  it('带区域的效果：上传蒙版、按片段位置画到序列尺寸，再只在区域内按强度混入；保留两张共用画面', async () => {
    const owner = clip()
    const document: VideoEditComposition = { ...createVideoEditSequence(), width: 1920, height: 1080, fps: 30, clips: [owner], media: [], items: [], revision: 0 }
    const nodes = buildVideoEditCompositePlan([owner])
    const keys = videoEditCompositeSurfaceKeys(nodes)
    expect(keys.has('composite:mask:source') && keys.has('composite:mask:document')).toBe(true)
    const calls: string[] = []
    const targets = new Map<string, VideoEditCodePicture>()
    const runtime = {
      target: vi.fn(async (key: string, width: number, height: number) => { calls.push(`target:${key}`); if (!targets.has(key)) targets.set(key, picture(width, height)); return targets.get(key)! }),
      builtin: vi.fn(async (key: string) => { calls.push(`builtin:${key}`); return picture() }),
      uploadMask: vi.fn(async (key: string, width: number, height: number) => { calls.push(`upload:${key}:${width}x${height}`); return picture(width, height) }),
      maskedMix: vi.fn(async (key: string, _base: VideoEditCodePicture, _effected: VideoEditCodePicture, _region: VideoEditCodePicture, amount: number) => { calls.push(`maskedMix:${key}:${amount}`); return picture() }),
      mix: vi.fn(), filter: vi.fn(), transition: vi.fn(),
    }
    const draws: Array<{ clips: VideoEditClip[]; target?: VideoEditCodePicture }> = []
    const compositor = {
      code: async () => runtime as never,
      draw: vi.fn(async (_document: VideoEditComposition, clips: VideoEditClip[], _pictures: unknown[], _present: () => boolean, _deadline?: number, target?: VideoEditCodePicture) => { draws.push({ clips, target }); return { presented: true, completion: Promise.resolve() } }),
    }
    const mask = { width: 512, height: 288, data: new Uint8Array(512 * 288) }
    const prepared = new Map<string, PreparedVideoEditEffect[]>([['c', [{ effect: owner.effects![0], builtin: owner.effects![0].builtin!, mask }]]])
    const result = await renderVideoEditCompositeScene(document, nodes, new Map([['c', picture()]]), prepared, compositor, 0, () => true)
    await result.completion
    expect(calls).toEqual(['target:composite:clip:c:0', 'builtin:composite:clip:c:1', 'upload:composite:mask:source:512x288', 'target:composite:mask:document', 'maskedMix:composite:clip:c:2:0.75'])
    // 第二次绘制就是蒙版：同一片段的位置、缩放、旋转，不带亮度与不透明度，画进序列尺寸的蒙版画面。
    const regionDraw = draws[1]
    expect(regionDraw.target).toBe(targets.get('composite:mask:document'))
    expect(regionDraw.clips[0]).toMatchObject({ x: 0.2, y: -0.1, scale: 0.5, rotation: 15, brightness: 1, opacity: 1 })
  })
})

describe('智能区域：Worker 读取缓存', () => {
  afterEach(() => { vi.unstubAllGlobals(); setVideoEditSmartRegionSegments({}) })

  function serve(files: Record<string, Uint8Array>): void {
    const fetch = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      const bytes = files[url]
      if (!bytes) return new Response(null, { status: 404 })
      const [, start, end] = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? '') ?? []
      if (start === undefined) return new Response(bytes as BlobPart, { status: 200 })
      return new Response(bytes.slice(Number(start), Math.min(bytes.length, Number(end) + 1)) as BlobPart, { status: 206 })
    })
    vi.stubGlobal('fetch', fetch)
  }
  const header = (patch: Partial<SmartRegionSegmentHeader>): SmartRegionSegmentHeader => ({
    version: SMART_REGION_FORMAT_VERSION, kind: 'person', model: 'rvm', startUs: 1_000_000, endUs: 2_000_000, fps: 10, frameCount: 10, still: false,
    sourceWidth: 1920, sourceHeight: 1080, summary: { value: 0.5, peak: 0 }, ...patch,
  })

  it('人物蒙版：按时间取帧、分段读取并解压，按参数处理（背景 = 取反）；没有覆盖的时间返回 undefined', async () => {
    const frames = Array.from({ length: 10 }, (_, index) => new Uint8Array(4 * 2).fill(index * 20))
    serve({ 'henji-media://local/a.hsrg': encodeSmartRegionSegment(header({ matte: { width: 4, height: 2 } }), frames.map(frame => deflateRawSync(frame))) })
    setVideoEditSmartRegionSegments({ 'henji-media://local/m.mp4': { person: [{ url: 'henji-media://local/a.hsrg', startUs: 1_000_000, endUs: 2_000_000, still: false }] } })
    const person = await videoEditSmartRegionMask('henji-media://local/m.mp4', { regionId: 'person', feather: 0, expand: 0 }, 1_300_000)
    expect(person).toMatchObject({ width: 4, height: 2 }); expect([...person!.data]).toEqual(new Array(8).fill(60))
    const background = await videoEditSmartRegionMask('henji-media://local/m.mp4', { regionId: 'background', feather: 0, expand: 0 }, 1_300_000)
    expect([...background!.data]).toEqual(new Array(8).fill(195))
    expect(await videoEditSmartRegionMask('henji-media://local/m.mp4', { regionId: 'person' }, 5_000_000)).toBeUndefined()
    expect(await videoEditSmartRegionMask('henji-media://local/other.mp4', { regionId: 'face' }, 1_300_000)).toBeUndefined()
  })

  it('人脸：框画成椭圆蒙版（长边 512）；静态图片的段落任何时间都用', async () => {
    serve({ 'henji-media://local/f.hsrg': encodeSmartRegionSegment(header({ kind: 'face', model: 'yunet', still: true, startUs: 0, endUs: 0, frameCount: 1, boxes: [[[0.4, 0.4, 0.2, 0.2, 0.9, 1]]] })) })
    setVideoEditSmartRegionSegments({ 'henji-media://local/p.png': { face: [{ url: 'henji-media://local/f.hsrg', startUs: 0, endUs: 0, still: true }] } })
    const face = await videoEditSmartRegionMask('henji-media://local/p.png', { regionId: 'face', feather: 0, expand: 0 }, 99_000_000)
    expect(face).toMatchObject({ width: 512, height: 288 })
    expect(face!.data[144 * 512 + 256]).toBe(255); expect(face!.data[0]).toBe(0)
  })
})
