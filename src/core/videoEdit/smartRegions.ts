/*
 * 智能区域（任务 4.7d）：效果只作用在 AI 找出的区域里（人脸、人物、背景、文字）。
 *
 * 这一模块是主进程（分析与缓存）、剪辑渲染 Worker（读取缓存、生成蒙版）与界面共用的纯逻辑：
 * - 区域与参数的登记（意图量纲：羽化、扩展按画面高度比例，与内置效果一致）；
 * - 分析结果的缓存文件格式（一段素材 + 一种分析 = 一个文件）；
 * - 按素材时间取出一帧的结果，并按参数画成低分辨率蒙版（0–255，GPU 线性放大后参与效果混合）。
 *
 * 被主进程引用：本文件只用相对路径导入，不依赖 DOM。
 */

/** 效果可以选的作用区域；`background` 是人物的反面。 */
export const VIDEO_EDIT_SMART_REGION_IDS = ['face', 'person', 'background', 'text'] as const
export type VideoEditSmartRegionId = (typeof VIDEO_EDIT_SMART_REGION_IDS)[number]
export function isVideoEditSmartRegionId(value: unknown): value is VideoEditSmartRegionId {
  return typeof value === 'string' && (VIDEO_EDIT_SMART_REGION_IDS as readonly string[]).includes(value)
}

/** 实际要跑的分析：人物与背景共用一次人物抠像。 */
export type SmartRegionAnalysisKind = 'face' | 'person' | 'text'
export const SMART_REGION_ANALYSIS_KINDS: readonly SmartRegionAnalysisKind[] = ['face', 'person', 'text']
export function smartRegionAnalysisKind(region: VideoEditSmartRegionId): SmartRegionAnalysisKind {
  return region === 'background' ? 'person' : region
}

export interface SmartRegionInfo {
  id: VideoEditSmartRegionId
  label: string
  /** 给界面悬停的说明。 */
  tooltip: string
  /** 给助手的语义说明。 */
  description: string
  defaults: { feather: number; expand: number }
}

export const SMART_REGIONS: Readonly<Record<VideoEditSmartRegionId, SmartRegionInfo>> = {
  face: {
    id: 'face', label: '人脸', tooltip: '自动找出画面中的每张人脸并逐帧跟随',
    description: '画面中所有人脸（YuNet 检测 + 逐帧跟踪，短暂遮挡时按轨迹继续覆盖）。配合马赛克或高斯模糊即人脸打码。',
    defaults: { feather: 20, expand: 30 },
  },
  person: {
    id: 'person', label: '人物', tooltip: '把人物从背景里抠出来，只处理人物',
    description: '人物的身体轮廓（视频抠像，边缘随帧稳定）。只调人物的亮度、颜色时用它。',
    defaults: { feather: 10, expand: 0 },
  },
  background: {
    id: 'background', label: '背景', tooltip: '人物以外的部分；配合高斯模糊即背景虚化',
    description: '人物以外的全部画面（人物抠像取反）。背景虚化 = 高斯模糊 + 背景；只把背景调暗 = 亮度与对比度 + 背景。',
    defaults: { feather: 10, expand: 0 },
  },
  text: {
    id: 'text', label: '文字', tooltip: '找出画面里的文字（字幕、标牌、水印）',
    description: '画面中的文字区域（字幕、标牌、角标、水印，PP-OCR 文字检测）。配合马赛克或模糊即文字打码。',
    defaults: { feather: 10, expand: 15 },
  },
}

/** 参数范围（意图量纲）：羽化 0–100 ≈ 边缘过渡占画面高度 0–10%；扩展 -100–100 ≈ 区域向外 / 向内各 0–10%。 */
export const SMART_REGION_FEATHER_RANGE = { min: 0, max: 100 } as const
export const SMART_REGION_EXPAND_RANGE = { min: -100, max: 100 } as const
/** 100 对应画面高度的比例。 */
const SPATIAL_FRACTION = 0.1

export interface SmartRegionMaskParams { feather: number; expand: number; invert: boolean }

/** 文档里存的区域设置（缺省项按区域默认）。 */
export interface SmartRegionMaskSetting { regionId: VideoEditSmartRegionId; invert?: boolean; feather?: number; expand?: number }

export function resolveSmartRegionMaskParams(mask: SmartRegionMaskSetting): SmartRegionMaskParams {
  const defaults = SMART_REGIONS[mask.regionId].defaults
  // 背景就是人物取反；用户再勾“反转”则回到人物。
  const invert = (mask.regionId === 'background') !== Boolean(mask.invert)
  return { feather: mask.feather ?? defaults.feather, expand: mask.expand ?? defaults.expand, invert }
}

// ==================== 缓存文件 ====================

/** 分析算法或文件格式变化时加一，旧缓存自然失效。 */
export const SMART_REGION_FORMAT_VERSION = 1
const MAGIC = 0x48535247 // "HSRG"

/** 归一化（0–1，相对显示画面）框：x、y、宽、高、置信度、轨迹编号（文字为 0）。 */
export type SmartRegionBox = readonly [number, number, number, number, number, number]

export interface SmartRegionSegmentHeader {
  version: number
  kind: SmartRegionAnalysisKind
  /** 实际使用的模型（rvm / selfie / yunet / ppocr），只用于日志与说明。 */
  model: string
  /** 第一帧对应的素材时间（微秒，素材绝对时钟）；静态图片为 0。 */
  startUs: number
  /** 分析覆盖的结束时间（微秒，不含）。 */
  endUs: number
  fps: number
  frameCount: number
  /** 静态图片：只有一帧，任何时间都用它。 */
  still: boolean
  /** 显示画面尺寸（像素，已按旋转与像素比换算）。 */
  sourceWidth: number
  sourceHeight: number
  /** 人脸、文字：每帧的框。 */
  boxes?: SmartRegionBox[][]
  /** 人物：每帧一张蒙版（宽 × 高，单字节），压缩后放在文件尾部。 */
  matte?: { width: number; height: number }
  /** 给助手与界面的摘要。 */
  summary: SmartRegionSummary
}

export interface SmartRegionSummary {
  /** 人脸：出现过的不同人脸数（轨迹数）；文字：出现文字的帧占比 0–1；人物：人物面积平均占比 0–1。 */
  value: number
  /** 同一帧最多同时出现的人脸 / 文字块数。 */
  peak: number
}

/** 文件布局；`H` 是头的类型（智能区域或 4.10 跟踪结果，同一种容器格式）。 */
export interface SmartRegionSegmentLayout<H = SmartRegionSegmentHeader> {
  header: H
  /** 文件头 + 索引的总字节数；蒙版数据从这里开始。 */
  dataOffset: number
  /** 每帧蒙版在数据区内的偏移与长度（字节）；没有蒙版时为空。 */
  frames: Array<{ offset: number; length: number }>
}

const PREAMBLE_BYTES = 16

/**
 * 写缓存文件：16 字节前导（魔数、版本、头长度、帧索引条数）+ JSON 头 + 帧索引（每帧 8 字节：偏移、长度）+ 压缩后的蒙版。
 * `frames` 是已压缩的每帧蒙版（人物）；人脸、文字的框都在 JSON 头里。
 */
export function encodeSmartRegionSegment(header: SmartRegionSegmentHeader | { version: number }, frames: readonly Uint8Array[] = []): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header))
  const indexBytes = frames.length * 8
  const dataBytes = frames.reduce((sum, frame) => sum + frame.byteLength, 0)
  const output = new Uint8Array(PREAMBLE_BYTES + json.byteLength + indexBytes + dataBytes)
  const view = new DataView(output.buffer)
  view.setUint32(0, MAGIC, true); view.setUint32(4, SMART_REGION_FORMAT_VERSION, true)
  view.setUint32(8, json.byteLength, true); view.setUint32(12, frames.length, true)
  output.set(json, PREAMBLE_BYTES)
  let offset = 0
  frames.forEach((frame, index) => {
    view.setUint32(PREAMBLE_BYTES + json.byteLength + index * 8, offset, true)
    view.setUint32(PREAMBLE_BYTES + json.byteLength + index * 8 + 4, frame.byteLength, true)
    output.set(frame, PREAMBLE_BYTES + json.byteLength + indexBytes + offset)
    offset += frame.byteLength
  })
  return output
}

/** 读前导：返回头与索引所需的总字节数（读者先取这么多字节再调用 decodeSmartRegionLayout）。 */
export function smartRegionLayoutBytes(preamble: Uint8Array): number {
  if (preamble.byteLength < PREAMBLE_BYTES) throw new Error('智能区域缓存不完整。')
  const view = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength)
  if (view.getUint32(0, true) !== MAGIC) throw new Error('智能区域缓存格式不对。')
  if (view.getUint32(4, true) !== SMART_REGION_FORMAT_VERSION) throw new Error('智能区域缓存版本已过期。')
  return PREAMBLE_BYTES + view.getUint32(8, true) + view.getUint32(12, true) * 8
}

export function decodeSmartRegionLayout<H extends { version: number } = SmartRegionSegmentHeader>(bytes: Uint8Array): SmartRegionSegmentLayout<H> {
  const total = smartRegionLayoutBytes(bytes)
  if (bytes.byteLength < total) throw new Error('智能区域缓存不完整。')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonBytes = view.getUint32(8, true); const count = view.getUint32(12, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(PREAMBLE_BYTES, PREAMBLE_BYTES + jsonBytes))) as H
  if (header.version !== SMART_REGION_FORMAT_VERSION) throw new Error('智能区域缓存版本已过期。')
  const frames = Array.from({ length: count }, (_, index) => ({
    offset: view.getUint32(PREAMBLE_BYTES + jsonBytes + index * 8, true),
    length: view.getUint32(PREAMBLE_BYTES + jsonBytes + index * 8 + 4, true),
  }))
  return { header, dataOffset: total, frames }
}

/** 素材时间对应的帧（最近的一帧，越界取两端）。 */
export function smartRegionFrameAt(header: Pick<SmartRegionSegmentHeader, 'startUs' | 'fps' | 'frameCount' | 'still'>, timeUs: number): number {
  if (header.still || header.frameCount <= 1) return 0
  const index = Math.round((timeUs - header.startUs) * header.fps / 1e6)
  return Math.max(0, Math.min(header.frameCount - 1, index))
}

/** 区域缓存段是否覆盖这段素材时间（静态图片总是覆盖）。 */
export function smartRegionSegmentCovers(segment: { startUs: number; endUs: number; still?: boolean }, startUs: number, endUs: number): boolean {
  return Boolean(segment.still) || (segment.startUs <= startUs && segment.endUs >= endUs)
}

/**
 * 某一时间的框：人脸按轨迹编号在前后两帧之间线性插值（分析帧率低于序列帧率时画面上不跳格），
 * 只出现在一侧的轨迹按最近的一帧取。
 */
export function smartRegionBoxesAt(header: SmartRegionSegmentHeader, timeUs: number): SmartRegionBox[] {
  const frames = header.boxes ?? []
  if (!frames.length) return []
  if (header.still || frames.length === 1) return frames[0]
  const position = Math.max(0, Math.min(frames.length - 1, (timeUs - header.startUs) * header.fps / 1e6))
  const before = Math.floor(position); const after = Math.min(frames.length - 1, before + 1); const t = position - before
  if (before === after || t === 0 || header.kind !== 'face') return frames[t < 0.5 ? before : after]
  const next = new Map(frames[after].map(box => [box[5], box]))
  const result: SmartRegionBox[] = []
  for (const box of frames[before]) {
    const other = next.get(box[5])
    if (other) {
      const lerp = (index: number): number => box[index] + (other[index] - box[index]) * t
      result.push([lerp(0), lerp(1), lerp(2), lerp(3), lerp(4), box[5]]); next.delete(box[5])
    }
    else if (t < 0.5) result.push(box)
  }
  if (t >= 0.5) result.push(...next.values())
  return result
}

// ==================== 蒙版 ====================

/** 框类区域的蒙版尺寸：保持显示比例，长边 512。 */
export function smartRegionMaskSize(sourceWidth: number, sourceHeight: number, longSide = 512): { width: number; height: number } {
  const scale = longSide / Math.max(1, sourceWidth, sourceHeight)
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * 把框画成蒙版：人脸用内切椭圆，文字用矩形；扩展把框向外（负数向内）推，羽化是边缘的过渡宽度（都按画面高度比例）。
 * 返回 0–255；反转在最后做。
 */
export function rasterizeSmartRegionBoxes(boxes: readonly SmartRegionBox[], shape: 'ellipse' | 'rect', params: SmartRegionMaskParams, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height)
  const expand = params.expand / 100 * SPATIAL_FRACTION * height
  const feather = Math.max(0.75, params.feather / 100 * SPATIAL_FRACTION * height)
  for (const box of boxes) {
    const cx = (box[0] + box[2] / 2) * width; const cy = (box[1] + box[3] / 2) * height
    const rx = box[2] / 2 * width + expand; const ry = box[3] / 2 * height + expand
    if (rx <= 0 || ry <= 0) continue
    const reach = feather / 2 + 1
    const x0 = Math.max(0, Math.floor(cx - rx - reach)); const x1 = Math.min(width - 1, Math.ceil(cx + rx + reach))
    const y0 = Math.max(0, Math.floor(cy - ry - reach)); const y1 = Math.min(height - 1, Math.ceil(cy + ry + reach))
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx
        let distance: number
        if (shape === 'ellipse') {
          // 椭圆的近似有向距离：归一化半径差乘以较短半轴（羽化窄时足够准确，且处处连续）。
          distance = (Math.hypot(dx / rx, dy / ry) - 1) * Math.min(rx, ry)
        } else {
          const qx = Math.abs(dx) - rx; const qy = Math.abs(dy) - ry
          distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
        }
        const value = Math.round((1 - smoothstep(-feather / 2, feather / 2, distance)) * 255)
        const index = y * width + x
        if (value > output[index]) output[index] = value
      }
    }
  }
  if (params.invert) for (let index = 0; index < output.length; index++) output[index] = 255 - output[index]
  return output
}

/** 一维滑动最大 / 最小值（单调队列，O(n)）：在 `step` 间隔的 `count` 个元素上做半径 `radius` 的窗口。 */
function slidingExtreme(source: Uint8Array, target: Uint8Array, start: number, step: number, count: number, radius: number, max: boolean): void {
  const deque = new Int32Array(count); let head = 0; let tail = 0
  const better = (a: number, b: number): boolean => max ? a >= b : a <= b
  let next = 0
  for (let index = 0; index < count; index++) {
    const limit = Math.min(count - 1, index + radius)
    for (; next <= limit; next++) {
      const value = source[start + next * step]
      while (tail > head && better(value, source[start + deque[tail - 1] * step])) tail--
      deque[tail++] = next
    }
    while (deque[head] < index - radius) head++
    target[start + index * step] = source[start + deque[head] * step]
  }
}

/** 一维盒式模糊（滑动和，O(n)），边缘按最近像素延伸。 */
function boxBlurLine(source: Uint8Array, target: Uint8Array, start: number, step: number, count: number, radius: number): void {
  const at = (index: number): number => source[start + Math.max(0, Math.min(count - 1, index)) * step]
  let sum = 0
  for (let index = -radius; index <= radius; index++) sum += at(index)
  const size = radius * 2 + 1
  for (let index = 0; index < count; index++) {
    target[start + index * step] = Math.round(sum / size)
    sum += at(index + radius + 1) - at(index - radius)
  }
}

function separable(input: Uint8Array, width: number, height: number, line: (source: Uint8Array, target: Uint8Array, start: number, step: number, count: number) => void): Uint8Array {
  const horizontal = new Uint8Array(input.length)
  for (let y = 0; y < height; y++) line(input, horizontal, y * width, 1, width)
  const output = new Uint8Array(input.length)
  for (let x = 0; x < width; x++) line(horizontal, output, x, width, height)
  return output
}

/**
 * 把人物蒙版按参数处理：扩展用灰度膨胀 / 腐蚀（方形窗口），羽化用两遍盒式模糊（近似高斯），最后按需反转。
 * 在蒙版自身分辨率上处理，像素半径按蒙版高度换算，与画面分辨率无关。
 */
export function processSmartRegionMatte(matte: Uint8Array, width: number, height: number, params: SmartRegionMaskParams): Uint8Array {
  let output = matte
  const expand = Math.round(Math.abs(params.expand) / 100 * SPATIAL_FRACTION * height)
  if (expand > 0) output = separable(output, width, height, (source, target, start, step, count) => slidingExtreme(source, target, start, step, count, expand, params.expand > 0))
  const feather = Math.round(params.feather / 100 * SPATIAL_FRACTION * height / 2)
  if (feather > 0) for (let pass = 0; pass < 2; pass++) output = separable(output, width, height, (source, target, start, step, count) => boxBlurLine(source, target, start, step, count, Math.max(1, Math.round(feather / 2))))
  if (params.invert) {
    if (output === matte) output = new Uint8Array(matte)
    for (let index = 0; index < output.length; index++) output[index] = 255 - output[index]
  }
  return output
}
