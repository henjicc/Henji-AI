import { describe, expect, it } from 'vitest'
import {
  decodeSmartRegionLayout, encodeSmartRegionSegment, processSmartRegionMatte, rasterizeSmartRegionBoxes, resolveSmartRegionMaskParams,
  smartRegionBoxesAt, smartRegionFrameAt, smartRegionLayoutBytes, smartRegionMaskSize, smartRegionSegmentCovers, SMART_REGION_FORMAT_VERSION,
  type SmartRegionSegmentHeader,
} from './smartRegions'
import { normalizeSmartRegionRange } from '../../platform/contracts/smartRegions'

const header = (overrides: Partial<SmartRegionSegmentHeader> = {}): SmartRegionSegmentHeader => ({
  version: SMART_REGION_FORMAT_VERSION, kind: 'face', model: 'yunet', startUs: 2_000_000, endUs: 3_000_000, fps: 10, frameCount: 10, still: false,
  sourceWidth: 1920, sourceHeight: 1080, summary: { value: 1, peak: 1 }, ...overrides,
})

describe('智能区域：缓存格式与蒙版', () => {
  it('缓存文件往返：头、帧索引与压缩帧位置一致；版本不符被拒绝', () => {
    const frames = [Uint8Array.of(1, 2, 3), Uint8Array.of(4), Uint8Array.of(5, 6)]
    const bytes = encodeSmartRegionSegment(header({ kind: 'person', matte: { width: 4, height: 2 } }), frames)
    expect(smartRegionLayoutBytes(bytes.subarray(0, 16))).toBe(bytes.byteLength - 6)
    const layout = decodeSmartRegionLayout(bytes)
    expect(layout.header.matte).toEqual({ width: 4, height: 2 })
    expect(layout.frames).toEqual([{ offset: 0, length: 3 }, { offset: 3, length: 1 }, { offset: 4, length: 2 }])
    expect([...bytes.subarray(layout.dataOffset + 4, layout.dataOffset + 6)]).toEqual([5, 6])
    const stale = new Uint8Array(bytes); new DataView(stale.buffer).setUint32(4, 0, true)
    expect(() => decodeSmartRegionLayout(stale)).toThrow('版本已过期')
  })

  it('时间换帧：按分析帧率取最近一帧，越界取两端；静态图片总是第 0 帧；范围覆盖与整秒取整', () => {
    expect(smartRegionFrameAt(header(), 2_000_000)).toBe(0)
    expect(smartRegionFrameAt(header(), 2_260_000)).toBe(3)
    expect(smartRegionFrameAt(header(), 9_000_000)).toBe(9)
    expect(smartRegionFrameAt(header({ still: true }), 9_000_000)).toBe(0)
    expect(smartRegionSegmentCovers({ startUs: 2e6, endUs: 5e6 }, 2.5e6, 5e6)).toBe(true)
    expect(smartRegionSegmentCovers({ startUs: 2e6, endUs: 5e6 }, 1.5e6, 3e6)).toBe(false)
    expect(normalizeSmartRegionRange(2_300_000, 4_100_000, false)).toEqual({ startUs: 2_000_000, endUs: 5_000_000 })
    expect(normalizeSmartRegionRange(2_000_000, 2_000_000, false)).toEqual({ startUs: 2_000_000, endUs: 3_000_000 })
  })

  it('人脸框按轨迹在相邻两帧之间插值，只在一侧出现的轨迹取较近的一帧', () => {
    const boxes = header({ boxes: [[[0.1, 0.1, 0.2, 0.2, 0.9, 1], [0.7, 0.7, 0.1, 0.1, 0.9, 2]], [[0.3, 0.1, 0.2, 0.2, 0.9, 1]]], frameCount: 2 })
    const middle = smartRegionBoxesAt(boxes, 2_025_000)
    expect(middle).toHaveLength(2)
    expect(middle[0][0]).toBeCloseTo(0.15, 5)
    expect(smartRegionBoxesAt(boxes, 2_075_000).map(box => box[5])).toEqual([1])
    expect(smartRegionBoxesAt(header({ kind: 'text', boxes: [[[0, 0, 1, 1, 1, 0]], []] }), 2_075_000)).toEqual([])
  })

  it('框画成蒙版：椭圆中心为满、外部为空；扩展让区域变大，反转取反；背景默认就是人物取反', () => {
    const size = smartRegionMaskSize(1920, 1080)
    expect(size).toEqual({ width: 512, height: 288 })
    const box = [[0.4, 0.4, 0.2, 0.2, 1, 1]] as const
    const plain = rasterizeSmartRegionBoxes(box, 'ellipse', { feather: 0, expand: 0, invert: false }, 100, 100)
    expect(plain[50 * 100 + 50]).toBe(255); expect(plain[0]).toBe(0); expect(plain[50 * 100 + 63]).toBe(0)
    const grown = rasterizeSmartRegionBoxes(box, 'ellipse', { feather: 0, expand: 50, invert: false }, 100, 100)
    expect(grown[50 * 100 + 63]).toBe(255)
    const inverted = rasterizeSmartRegionBoxes(box, 'rect', { feather: 0, expand: 0, invert: true }, 100, 100)
    expect(inverted[50 * 100 + 50]).toBe(0); expect(inverted[0]).toBe(255)
    expect(resolveSmartRegionMaskParams({ regionId: 'background' })).toEqual({ feather: 10, expand: 0, invert: true })
    expect(resolveSmartRegionMaskParams({ regionId: 'background', invert: true }).invert).toBe(false)
    expect(resolveSmartRegionMaskParams({ regionId: 'face', feather: 0 })).toEqual({ feather: 0, expand: 30, invert: false })
  })

  it('人物蒙版：扩展做膨胀 / 腐蚀，羽化让边缘渐变，处理与分辨率按蒙版高度换算', () => {
    const width = 40; const height = 40
    const matte = new Uint8Array(width * height)
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) matte[y * width + x] = 255
    const grown = processSmartRegionMatte(matte, width, height, { feather: 0, expand: 50, invert: false })
    expect(grown[20 * width + 8]).toBe(255); expect(matte[20 * width + 8]).toBe(0)
    const shrunk = processSmartRegionMatte(matte, width, height, { feather: 0, expand: -50, invert: false })
    expect(shrunk[20 * width + 11]).toBe(0); expect(shrunk[20 * width + 20]).toBe(255)
    const soft = processSmartRegionMatte(matte, width, height, { feather: 100, expand: 0, invert: false })
    expect(soft[20 * width + 10]).toBeGreaterThan(0); expect(soft[20 * width + 10]).toBeLessThan(255)
    expect(soft[20 * width + 20]).toBe(255)
    const inverted = processSmartRegionMatte(matte, width, height, { feather: 0, expand: 0, invert: true })
    expect(inverted[0]).toBe(255); expect(matte[0]).toBe(0)
  })
})
