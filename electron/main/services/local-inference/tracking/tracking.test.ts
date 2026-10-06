import { describe, expect, it } from 'vitest'
import { fillVideoEditTrackHoles, videoEditTrackBoxAt, videoEditTrackMaskFromLogits } from '../../../../../src/core/videoEdit/tracking'
import { etamMemoryPlan, etamPromptFromNormalized } from './efficientTam'
import { addOnnxGraphOutputs } from './onnxGraphOutputs'
import { vitCrop, vitDecode, vitHanning } from './vitTrack'

describe('形状跟踪：记忆库装配（与 track_onnx.py 一致）', () => {
  it('正向：条件帧时间编号 6，之前第 k 帧编号 k − 1（由远到近）；指针取不晚于当前帧的条件帧与之前 1…15 帧', () => {
    const done = new Set(Array.from({ length: 40 }, (_, index) => index).filter(index => index !== 0))
    const plan = etamMemoryPlan(20, 1, [0], frame => done.has(frame), { first: 0, last: 89 })
    expect(plan.memory).toEqual([{ frame: 0, tpos: 6 }, { frame: 14, tpos: 5 }, { frame: 15, tpos: 4 }, { frame: 16, tpos: 3 }, { frame: 17, tpos: 2 }, { frame: 18, tpos: 1 }, { frame: 19, tpos: 0 }])
    expect(plan.pointers).toEqual([0, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5])
  })
  it('第 1 帧只有条件帧；反向按之后的帧取；指针数不超过 min(总帧数,16) − 1 + 条件帧，越出范围即停', () => {
    expect(etamMemoryPlan(1, 1, [0], () => false, { first: 0, last: 89 })).toEqual({ memory: [{ frame: 0, tpos: 6 }], pointers: [0] })
    const reverse = etamMemoryPlan(48, -1, [50], frame => frame === 49, { first: 40, last: 50 })
    expect(reverse.memory).toEqual([{ frame: 50, tpos: 6 }, { frame: 49, tpos: 0 }])
    expect(reverse.pointers).toEqual([50, 49])
    expect(etamMemoryPlan(30, 1, [0, 40], () => false, { first: 0, last: 89 }).pointers).toEqual([0])
  })
  it('提示：框放最前（标签 2、3），坐标 × 512', () => {
    expect(etamPromptFromNormalized({ box: [0.5, 0.25, 0.25, 0.5], points: [[0.1, 0.2, 0]] })).toEqual({ coords: [[256, 128], [384, 384], [51.2, 102.4]], labels: [2, 3, 0] })
  })
})

describe('补图输出：只在 graph 末尾追加 output，其余字节不变', () => {
  it('ModelProto 字段 7（graph）重新编码，其他字段原样保留', () => {
    // ir_version = 8（字段 1）+ graph（字段 7，内含 name = "g"）
    const model = Uint8Array.from([0x08, 0x08, 0x3a, 0x03, 0x12, 0x01, 0x67])
    const patched = addOnnxGraphOutputs(model, [{ name: 'x', elementType: 1, dims: [2] }])
    expect([...patched.subarray(0, 2)]).toEqual([0x08, 0x08])
    expect(patched[2]).toBe(0x3a)
    const graph = patched.subarray(4, 4 + patched[3])
    expect([...graph.subarray(0, 3)]).toEqual([0x12, 0x01, 0x67])
    expect(graph[3]).toBe(12 * 8 + 2)
    expect(new TextDecoder().decode(graph)).toContain('x')
  })
})

describe('物体框跟踪：OpenCV TrackerVit 的裁剪与解码', () => {
  it('裁剪：边长 ceil(√(w·h)·倍数)，C++ 截断取中心，越界补 0（右下多补一像素）', () => {
    const frame = { rgb: new Uint8Array(10 * 10 * 3).fill(200), width: 10, height: 10 }
    const crop = vitCrop(frame, { x: 6, y: 6, width: 3, height: 3 }, 2)
    expect(crop.size).toBe(6)
    // x1 = 6 + trunc(-3/2) = 5，x2 = 11 → 右边补 2 列（11 − 10 + 1）
    expect(crop.pixels[(0 * 6 + 3) * 3]).toBe(200); expect(crop.pixels[(0 * 6 + 4) * 3]).toBe(0)
  })
  it('解码：置信图乘汉宁窗取最大，偏移与尺寸换回画面；低于 0.2 不更新', () => {
    const conf = new Float32Array(256); conf[8 * 16 + 8] = 1
    const offset = new Float32Array(512); const size = new Float32Array(512).fill(0.25)
    const result = vitDecode({ conf, size, offset }, { x: 100, y: 100, width: 50, height: 50 }, 200, vitHanning())
    // 中心格（8,8）、偏移 0：中心 0.5；裁剪左上 = 100 + trunc((50 − 200) / 2) = 25；x = floor((0.5 − 0.125) × 200 + 25) = 100
    expect(result.box).toEqual({ x: 100, y: 100, width: 50, height: 50 })
    expect(vitDecode({ conf: new Float32Array(256).fill(0.1), size, offset }, { x: 0, y: 0, width: 10, height: 10 }, 20).box).toBeUndefined()
  })
})

describe('跟踪结果：显示与插值', () => {
  it('填小洞：背景里 ≤ 8 像素的连通域改成前景；大块背景不动', () => {
    const logits = new Int8Array(16 * 16).fill(10)
    logits[5 * 16 + 5] = -10; logits[5 * 16 + 6] = -10
    for (let index = 0; index < 16 * 4; index++) logits[index + 16 * 12] = -10
    fillVideoEditTrackHoles(logits, 16, 16)
    expect(logits[5 * 16 + 5]).toBeGreaterThan(0)
    expect(logits[13 * 16 + 3]).toBeLessThan(0)
  })
  it('logit 放大到画面比例，> 0 为前景；框在相邻帧之间插值，跟丢的帧取最近的有效帧', () => {
    const logits = new Float32Array(4 * 4).fill(-1); logits[5] = 5; logits[6] = 5; logits[9] = 5; logits[10] = 5
    const mask = videoEditTrackMaskFromLogits(logits, 4, 4, 8, 8)
    expect(mask[4 * 8 + 4]).toBe(255); expect(mask[0]).toBe(0)
    const header = { firstFrame: 10, fps: 10, boxes: [[0, 0, 0.1, 0.1, 1], [0.2, 0, 0.1, 0.1, 1], null, null] as Array<[number, number, number, number, number] | null> }
    expect(videoEditTrackBoxAt(header, 1_050_000)![0]).toBeCloseTo(0.1)
    expect(videoEditTrackBoxAt(header, 1_300_000)![0]).toBeCloseTo(0.2)
  })
})
