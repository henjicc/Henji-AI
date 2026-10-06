import type { LocalModelRunner } from '../analysis'

/*
 * 物体框跟踪 VitTrack（OpenCV Zoo object_tracking_vittrack_2023sep，任务 4.10）：按 OpenCV 4.12
 * `modules/video/src/tracking/tracker_vit.cpp` 移植（裁剪、补边、线性缩放、汉宁窗、阈值、框换算一致，整数运算按 C++ 截断规则）。
 * 唯一的有意差异是归一化：OpenCV 用 `(1.0 / stdvalue)` 求每通道缩放，而 cv::Scalar 的除法按四元数求逆，
 * 结果 G、R 两个通道的缩放变成负数（实测 cv2.TrackerVit 的框与按此复现的结果逐帧吻合）。这里用模型训练时的
 * ImageNet 均值方差（RGB 顺序）：合成真值上平均 IoU 0.676 → 0.813（任务文件“选型依据”）。
 * 原生测试与 Python 参考（同一流程 + onnxruntime）逐帧对照。
 */

export const VIT_TEMPLATE_SIZE = 128
export const VIT_SEARCH_SIZE = 256
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
/** OpenCV TrackerVit::Params 的默认阈值。 */
export const VIT_SCORE_THRESHOLD = 0.2

export interface VitRect { x: number; y: number; width: number; height: number }
export interface VitFrame { rgb: Uint8Array; width: number; height: number }

/** C++ 整数除法（向零截断）。 */
const div = (a: number, b: number): number => Math.trunc(a / b)

/**
 * OpenCV crop_image：以框为中心取边长 ceil(√(w·h) × factor) 的正方形，越界部分补 0（含 OpenCV 右、下边多补一像素的写法）。
 * 返回 RGB 的正方形与边长。
 */
export function vitCrop(frame: VitFrame, box: VitRect, factor: number): { pixels: Uint8Array; size: number } {
  const size = Math.ceil(Math.sqrt(box.width * box.height) * factor)
  const x1 = box.x + div(box.width - size, 2); const x2 = x1 + size
  const y1 = box.y + div(box.height - size, 2); const y2 = y1 + size
  const x1Pad = Math.max(0, -x1); const y1Pad = Math.max(0, -y1)
  const x2Pad = Math.max(x2 - frame.width + 1, 0); const y2Pad = Math.max(y2 - frame.height + 1, 0)
  const roiX = x1 + x1Pad; const roiY = y1 + y1Pad
  const roiWidth = x2 - x2Pad - x1 - x1Pad; const roiHeight = y2 - y2Pad - y1 - y1Pad
  if (size <= 0 || roiWidth <= 0 || roiHeight <= 0) throw new Error('跟踪框完全落在画面外。')
  const pixels = new Uint8Array(size * size * 3)
  for (let y = 0; y < roiHeight; y++) {
    for (let x = 0; x < roiWidth; x++) {
      const source = ((roiY + y) * frame.width + roiX + x) * 3; const target = ((y1Pad + y) * size + x1Pad + x) * 3
      pixels[target] = frame.rgb[source]; pixels[target + 1] = frame.rgb[source + 1]; pixels[target + 2] = frame.rgb[source + 2]
    }
  }
  return { pixels, size }
}

/** cv::resize INTER_LINEAR（像素中心对齐、边缘夹取，8 位四舍五入）后按 ImageNet 均值方差归一化成 CHW（RGB 顺序）。 */
export function vitBlob(crop: { pixels: Uint8Array; size: number }, target: number): Float32Array {
  const output = new Float32Array(3 * target * target)
  const scale = crop.size / target; const plane = target * target
  for (let y = 0; y < target; y++) {
    let fy = (y + 0.5) * scale - 0.5; let y0 = Math.floor(fy); let ty = fy - y0
    if (y0 < 0) { y0 = 0; ty = 0; fy = 0 }
    const y1 = Math.min(crop.size - 1, y0 + 1); if (y0 >= crop.size - 1) { y0 = crop.size - 1; ty = 0 }
    for (let x = 0; x < target; x++) {
      let fx = (x + 0.5) * scale - 0.5; let x0 = Math.floor(fx); let tx = fx - x0
      if (x0 < 0) { x0 = 0; tx = 0; fx = 0 }
      const x1 = Math.min(crop.size - 1, x0 + 1); if (x0 >= crop.size - 1) { x0 = crop.size - 1; tx = 0 }
      for (let channel = 0; channel < 3; channel++) {
        const at = (yy: number, xx: number): number => crop.pixels[(yy * crop.size + xx) * 3 + channel]
        const value = Math.round((at(y0, x0) * (1 - tx) + at(y0, x1) * tx) * (1 - ty) + (at(y1, x0) * (1 - tx) + at(y1, x1) * tx) * ty)
        output[channel * plane + y * target + x] = (value / 255 - MEAN[channel]) / STD[channel]
      }
    }
  }
  return output
}

/** OpenCV hann2d(16×16, centered=true)。 */
export function vitHanning(size = 16): Float32Array {
  const line = Array.from({ length: size }, (_, index) => Math.fround(0.5 * (1 - Math.cos(Math.fround(2 * Math.PI / (size + 1)) * (index + 1)))))
  const output = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) output[y * size + x] = line[y] * line[x]
  return output
}

/**
 * 解码一帧的网络输出（OpenCV update 的后半段）：置信图乘汉宁窗取最大（行优先第一个），过阈值时按偏移与尺寸图换回画面坐标。
 * 返回新框与分数；分数不过阈值时 box 为 undefined（OpenCV 返回 false，保留上一帧的框继续找）。
 */
export function vitDecode(outputs: { conf: Float32Array; size: Float32Array; offset: Float32Array }, last: VitRect, cropSize: number, hanning = vitHanning()): { box?: VitRect; score: number } {
  let best = -Infinity; let bestIndex = 0
  for (let index = 0; index < 256; index++) {
    const value = Math.fround(outputs.conf[index] * hanning[index])
    if (value > best) { best = value; bestIndex = index }
  }
  if (best < VIT_SCORE_THRESHOLD) return { score: best }
  const mx = bestIndex % 16; const my = Math.floor(bestIndex / 16)
  const cx = Math.fround((mx + outputs.offset[my * 16 + mx]) / 16)
  const cy = Math.fround((my + outputs.offset[256 + my * 16 + mx]) / 16)
  const w = outputs.size[my * 16 + mx]; const h = outputs.size[256 + my * 16 + mx]
  const x0 = last.x + div(last.width - cropSize, 2); const y0 = last.y + div(last.height - cropSize, 2)
  const x1 = Math.fround(cx - w / 2); const y1 = Math.fround(cy - h / 2)
  return { score: best, box: { x: Math.floor(x1 * cropSize + x0), y: Math.floor(y1 * cropSize + y0), width: Math.floor(w * cropSize), height: Math.floor(h * cropSize) } }
}

/** 一个跟踪器：init 记下模板（只在提示帧取一次），update 逐帧在上一帧框周围 4 倍范围里找。 */
export class VitTracker {
  private template?: Float32Array
  private last?: VitRect
  private readonly hanning = vitHanning()
  constructor(private readonly runner: LocalModelRunner) {}

  init(frame: VitFrame, box: VitRect): void {
    this.template = vitBlob(vitCrop(frame, box, 2), VIT_TEMPLATE_SIZE)
    this.last = { ...box }
  }

  /** 接着上次的位置继续（续跟时：模板仍取自提示帧，位置取上一次跟到的框）。 */
  resume(frame: VitFrame, prompt: VitRect, last: VitRect): void { this.init(frame, prompt); this.last = { ...last } }

  async update(frame: VitFrame): Promise<{ box?: VitRect; score: number }> {
    if (!this.template || !this.last) throw new Error('跟踪器还没有初始化。')
    const crop = vitCrop(frame, this.last, 4)
    const outputs = await this.runner.run({
      template: { type: 'float32', data: this.template, dims: [1, 3, VIT_TEMPLATE_SIZE, VIT_TEMPLATE_SIZE] },
      search: { type: 'float32', data: vitBlob(crop, VIT_SEARCH_SIZE), dims: [1, 3, VIT_SEARCH_SIZE, VIT_SEARCH_SIZE] },
    })
    const read = (name: string): Float32Array => { const value = outputs[name]?.data; if (!(value instanceof Float32Array)) throw new Error(`VitTrack 输出 ${name} 不是单精度张量。`); return value }
    const result = vitDecode({ conf: read('output1'), size: read('output2'), offset: read('output3') }, this.last, crop.size, this.hanning)
    if (result.box) this.last = result.box
    return result
  }

  get current(): VitRect | undefined { return this.last }
}
