import type { LocalInferenceModelFile } from '../protocol'
import type { LocalExecutionProvider } from '../providers'

/** 内部像素坐标，基于已正向解码的 SDR/sRGB 图像；公开领域层负责把意图区域换算成 ROI。 */
export interface InpaintRoi { left: number; top: number; width: number; height: number }
export type ImageInpaintQuality = 'fast' | 'fine' | 'blemish'
export type ImageInpaintAlgorithm = 'migan' | 'lama' | 'telea' | 'ns'

/** 闭合图片作业。路径仅由主进程资源解析器填充，不作为助手参数或任意 tensor 入口。 */
export interface ImageInpaintJob {
  id: string
  sourcePath: string
  /** 与源图正向尺寸一致的单通道灰度 PNG；0=保持，255=修复，灰度=融合覆盖率。 */
  maskPath: string
  roi: InpaintRoi
  quality: ImageInpaintQuality
  algorithm: ImageInpaintAlgorithm
  model?: LocalInferenceModelFile
  providers: LocalExecutionProvider[]
  outputPath: string
}

export interface ImageInpaintResult {
  algorithm: ImageInpaintAlgorithm
  provider: LocalExecutionProvider | 'wasm'
  roi: InpaintRoi
  /** ROI 尺寸 RGBA PNG，RGB 按原 coverage 融合，alpha 原样保留；后续提交应替换 ROI，不能再叠加 coverage。 */
  outputPath: string
  decodeMs: number
  inferenceMs: number
  compositeMs: number
  durationMs: number
}

export function assertInpaintRoi(roi: InpaintRoi, width?: number, height?: number): void {
  if (!roi || Object.keys(roi).some(key => !['left', 'top', 'width', 'height'].includes(key)) || ![roi.left, roi.top, roi.width, roi.height].every(Number.isSafeInteger)
    || roi.left < 0 || roi.top < 0 || roi.width <= 0 || roi.height <= 0
    || !Number.isSafeInteger(roi.left + roi.width) || !Number.isSafeInteger(roi.top + roi.height)
    || (width !== undefined && roi.left + roi.width > width)
    || (height !== undefined && roi.top + roi.height > height)) throw new Error('roi 必须是源图范围内的正整数像素矩形。')
}
