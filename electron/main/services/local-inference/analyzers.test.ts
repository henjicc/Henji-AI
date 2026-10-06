import { describe, expect, it } from 'vitest'
import { float16Bits, float16ToUnorm8Table, float16Value, unorm8ToFloat16Table } from './fp16'
import { decodeYunet, yunetInput, YUNET_INPUT_SIZE, type FaceDetection } from './analyzers/yunet'
import { trackFaces } from './analyzers/faceTracker'
import { rvmInputSize, rvmMatte, rvmSourceTensor, selfieMatte } from './analyzers/matting'
import { ppocrInputSize, stabilizeTextFrames, textBoxesFromMap } from './analyzers/textDetection'
import { analysisFfmpegArgs, rawFrames } from './frameReader'
import { executionProviderOrder } from './providers'

/** 构造 YuNet 输出：在步长 `stride` 的 (row, column) 格子放一个人脸。 */
function yunetOutputs(faces: Array<{ stride: 8 | 16 | 32; row: number; column: number; size: number; score: number }>): Record<string, Float32Array> {
  const outputs: Record<string, Float32Array> = {}
  for (const stride of [8, 16, 32]) {
    const count = (YUNET_INPUT_SIZE / stride) ** 2
    outputs[`cls_${stride}`] = new Float32Array(count); outputs[`obj_${stride}`] = new Float32Array(count)
    outputs[`bbox_${stride}`] = new Float32Array(count * 4); outputs[`kps_${stride}`] = new Float32Array(count * 10)
  }
  for (const face of faces) {
    const index = face.row * (YUNET_INPUT_SIZE / face.stride) + face.column
    outputs[`cls_${face.stride}`][index] = face.score; outputs[`obj_${face.stride}`][index] = face.score
    outputs[`bbox_${face.stride}`].set([0.5, 0.5, Math.log(face.size / face.stride), Math.log(face.size / face.stride)], index * 4)
  }
  return outputs
}

describe('本地推理：预处理与后处理', () => {
  it('半精度：常用值往返一致，查表与逐个换算相同', () => {
    for (const value of [0, 1, 0.5, 0.25, -2, 65504]) expect(float16Value(float16Bits(value))).toBe(value)
    expect(float16Value(float16Bits(1 / 3))).toBeCloseTo(1 / 3, 3)
    const toHalf = unorm8ToFloat16Table(); const toByte = float16ToUnorm8Table()
    for (let index = 0; index < 256; index++) expect(toByte[toHalf[index]]).toBe(index)
    expect(toByte[float16Bits(1.4)]).toBe(255); expect(toByte[float16Bits(-0.2)]).toBe(0)
  })

  it('YuNet：画面放在 640 画布左上角并转为 BGR；解码出归一化框并做非极大值抑制', () => {
    const rgb = Uint8Array.of(10, 20, 30, 40, 50, 60)
    const input = yunetInput(rgb, 2, 1)
    const plane = YUNET_INPUT_SIZE ** 2
    expect([input[0], input[plane], input[2 * plane]]).toEqual([30, 20, 10])
    expect([input[1], input[plane + 1], input[2 * plane + 1]]).toEqual([60, 50, 40])
    expect(input[YUNET_INPUT_SIZE]).toBe(0)
    // 640×360 的画面：步长 16 第 10 行第 20 列，中心 (328, 168)，边长 64；同一张脸在步长 8 上有一个低分重复，被抑制。
    const faces = decodeYunet(yunetOutputs([{ stride: 16, row: 10, column: 20, size: 64, score: 0.9 }, { stride: 8, row: 20, column: 40, size: 60, score: 0.7 }, { stride: 32, row: 1, column: 1, size: 40, score: 0.3 }]), 640, 360)
    expect(faces).toHaveLength(1)
    expect(faces[0].x).toBeCloseTo(296 / 640, 4); expect(faces[0].y).toBeCloseTo(136 / 360, 4)
    expect(faces[0].width).toBeCloseTo(64 / 640, 4); expect(faces[0].height).toBeCloseTo(64 / 360, 4)
    expect(faces[0].score).toBeCloseTo(0.9, 5)
  })

  it('人脸跟踪：连续命中才确认并补上试探帧，单帧误检丢弃，丢失时按轨迹继续覆盖到上限', () => {
    const face = (x: number): FaceDetection => ({ x, y: 0.2, width: 0.1, height: 0.15, score: 0.7 })
    const detections: FaceDetection[][] = [
      [face(0.10)], [face(0.11)], [face(0.12)], [], [], [face(0.15)],
      [{ x: 0.8, y: 0.8, width: 0.05, height: 0.05, score: 0.65 }], // 单帧误检
      [], [], [], [], [], [], [],
    ]
    const boxes = trackFaces(detections, { fps: 10, coastSeconds: 0.3 })
    // 第 0 帧是试探帧，确认后补上。
    expect(boxes[0]).toHaveLength(1)
    expect(boxes.slice(0, 6).every(frame => frame.length === 1 && frame[0][5] === 1)).toBe(true)
    // 第 3、4 帧没检测到，按预测继续覆盖，位置沿运动方向前进。
    expect(boxes[3][0][0]).toBeGreaterThan(boxes[2][0][0] - 0.005)
    // 误检不输出；丢失后最多再覆盖 3 帧（0.3 秒）。
    expect(boxes[6].every(box => box[5] === 1)).toBe(true)
    expect(boxes.slice(6).filter(frame => frame.length).length).toBe(3)
  })

  it('高置信度的人脸单帧即确认；两个人分别编号', () => {
    const boxes = trackFaces([[{ x: 0.1, y: 0.1, width: 0.1, height: 0.1, score: 0.95 }, { x: 0.6, y: 0.1, width: 0.1, height: 0.1, score: 0.95 }]], { fps: 30 })
    expect(boxes[0].map(box => box[5]).sort()).toEqual([1, 2])
  })

  it('RVM：尺寸按 16 对齐、长边 512；输入为半精度平面，输出半精度转字节', () => {
    expect(rvmInputSize(1920, 1080)).toEqual({ width: 512, height: 288 })
    expect(rvmInputSize(1080, 1920)).toEqual({ width: 288, height: 512 })
    const tensor = rvmSourceTensor(Uint8Array.of(255, 0, 51), 1, 1)
    expect([...tensor].map(float16Value)).toEqual([1, 0, float16Value(float16Bits(0.2))])
    expect([...rvmMatte(Uint16Array.of(float16Bits(1), float16Bits(0), float16Bits(0.5)))]).toEqual([255, 0, 128])
  })

  it('Selfie：256×256 输出按显示比例重采样', () => {
    const alphas = new Float32Array(256 * 256)
    for (let y = 0; y < 256; y++) for (let x = 128; x < 256; x++) alphas[y * 256 + x] = 1
    const matte = selfieMatte(alphas, 16, 9)
    expect(matte[0]).toBe(0); expect(matte[15]).toBe(255); expect(matte.length).toBe(144)
  })

  it('文字检测：尺寸按 32 对齐；连通域成框并外扩，低分区域丢弃；相邻帧并集去闪烁', () => {
    expect(ppocrInputSize(1920, 1080)).toEqual({ width: 736, height: 416 })
    const width = 40; const height = 20
    const map = new Float32Array(width * height)
    for (let y = 8; y < 12; y++) for (let x = 5; x < 25; x++) map[y * width + x] = 0.9
    for (let y = 2; y < 6; y++) for (let x = 30; x < 36; x++) map[y * width + x] = 0.4 // 平均分不够
    const boxes = textBoxesFromMap(map, width, height)
    expect(boxes).toHaveLength(1)
    const [x, y, w, h, score] = boxes[0]
    expect(x).toBeLessThan(5 / width); expect(y).toBeLessThan(8 / height)
    expect(x + w).toBeGreaterThan(25 / width); expect(y + h).toBeGreaterThan(12 / height)
    expect(score).toBe(0.9)
    const stable = stabilizeTextFrames([[boxes[0]], [], [boxes[0]]])
    expect(stable[1]).toHaveLength(1)
  })

  it('FFmpeg 取帧参数：视频精确定位并按固定帧率输出原始帧，静态图片只取一帧；字节流按帧切分', async () => {
    const video = analysisFfmpegArgs({ source: '/m/a.mp4', seekSeconds: 1.5, durationSeconds: 2, fps: 30 }, { width: 512, height: 288 })
    expect(video.join(' ')).toContain('-ss 1.500000 -i /m/a.mp4 -t 2.000000')
    expect(video.join(' ')).toContain('-vf fps=fps=30:round=near,scale=512:288:flags=area')
    expect(video.slice(-5)).toEqual(['-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
    const still = analysisFfmpegArgs({ source: '/m/a.png', seekSeconds: 0, durationSeconds: null, fps: 1 }, { width: 256, height: 256 })
    expect(still).not.toContain('-ss'); expect(still.join(' ')).toContain('-vf scale=256:256:flags=area -frames:v 1')
    async function* chunks(): AsyncGenerator<Uint8Array> { yield Uint8Array.of(1, 2, 3, 4); yield Uint8Array.of(5, 6, 7, 8, 9) }
    const frames: number[][] = []
    for await (const frame of rawFrames(chunks(), 3)) frames.push([...frame])
    expect(frames).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
  })

  it('执行提供者顺序：Windows DirectML、macOS CoreML，最后都是 CPU', () => {
    expect(executionProviderOrder('win32')).toEqual(['dml', 'cpu'])
    expect(executionProviderOrder('darwin')).toEqual(['coreml', 'cpu'])
    expect(executionProviderOrder('linux')).toEqual(['cpu'])
    expect(executionProviderOrder('linux', { cuda: true })).toEqual(['cuda', 'cpu'])
  })
})
