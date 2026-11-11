// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MaskLiveRaster } from './maskLiveRaster'
import { rasterizeQuickMaskCoverage } from './regionAdapter'
import type { MaskEditorDocument, MaskMark } from './types'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: () => undefined,
  })) as never)
})

function coverageOf(raster: MaskLiveRaster): Float32Array {
  return (raster as unknown as { output: Float32Array }).output
}

const WIDTH = 64
const HEIGHT = 48
const doc = (strokes: MaskMark[]): MaskEditorDocument => ({ version: 1, sourceRef: 'src', width: WIDTH, height: HEIGHT, strokes })

/** 按点逐段送进来，模拟拖动过程中一帧一帧地画。 */
function drawLive(raster: MaskLiveRaster, mark: MaskMark): void {
  raster.begin({ ...mark, points: mark.points.slice(0, 1) })
  for (let count = 2; count <= mark.points.length; count++) raster.update({ ...mark, points: mark.points.slice(0, count) })
  raster.end()
}

describe('整张遮罩的实时绘制', () => {
  it('软边画笔逐段画出的结果与按文档整张求值逐像素一致，笔画内重叠不变深', () => {
    const first: MaskMark = { id: 'a', kind: 'stroke', mode: 'paint', size: 18, hardness: 0.4, points: [{ x: 8, y: 10 }, { x: 30, y: 12 }, { x: 52, y: 30 }, { x: 20, y: 30 }, { x: 10, y: 12 }] }
    const second: MaskMark = { id: 'b', kind: 'stroke', mode: 'erase', size: 10, hardness: 1, points: [{ x: 5, y: 40 }, { x: 60, y: 8 }] }
    const raster = new MaskLiveRaster(WIDTH, HEIGHT, [255, 0, 0], 0.5)
    drawLive(raster, first)
    drawLive(raster, second)
    const expected = rasterizeQuickMaskCoverage(doc([first, second]), { x: 0, y: 0, width: WIDTH, height: HEIGHT })
    const live = coverageOf(raster)
    let maxDiff = 0
    for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i] - live[i]))
    expect(maxDiff).toBeLessThan(1e-5)
    expect(Math.max(...live)).toBeLessThanOrEqual(1)
  })

  it('形状拖动中变小时，旧范围多出来的部分还原成开始前的样子', () => {
    const raster = new MaskLiveRaster(WIDTH, HEIGHT, [255, 0, 0], 0.5)
    const start = { x: 10, y: 10 }
    raster.begin({ id: 'r', kind: 'rectangle', mode: 'paint', points: [start, { x: 50, y: 40 }] })
    raster.update({ id: 'r', kind: 'rectangle', mode: 'paint', points: [start, { x: 20, y: 20 }] })
    raster.end()
    const expected = rasterizeQuickMaskCoverage(doc([{ id: 'r', kind: 'rectangle', mode: 'paint', points: [start, { x: 20, y: 20 }] }]), { x: 0, y: 0, width: WIDTH, height: HEIGHT })
    expect(Array.from(coverageOf(raster))).toEqual(Array.from(expected))
  })
})
