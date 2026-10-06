/*
 * 人脸检测 YuNet（OpenCV Zoo face_detection_yunet_2023mar，输入固定 1×3×640×640，BGR 0–255）。
 * 解码与 OpenCV FaceDetectorYN 一致：三个步长（8/16/32）的网格，置信度 = sqrt(cls × obj)，
 * 中心 = (格子 + 偏移) × 步长，宽高 = exp(值) × 步长；再做非极大值抑制。
 *
 * 画面先按比例缩到 640 以内（由解码进程完成），这里放在 640×640 画布的左上角，其余补零，
 * 所以框坐标就是缩小后画面的像素坐标，除以画面宽高即得归一化坐标。
 */

export const YUNET_INPUT_SIZE = 640
const STRIDES = [8, 16, 32] as const

export interface FaceDetection { x: number; y: number; width: number; height: number; score: number }

/** 把 RGB24 画面放进 640×640 的 BGR 平面输入（左上角对齐，补零）。 */
export function yunetInput(rgb: Uint8Array, width: number, height: number, target = new Float32Array(3 * YUNET_INPUT_SIZE * YUNET_INPUT_SIZE)): Float32Array {
  if (width > YUNET_INPUT_SIZE || height > YUNET_INPUT_SIZE) throw new Error('人脸检测输入超过 640。')
  target.fill(0)
  const plane = YUNET_INPUT_SIZE * YUNET_INPUT_SIZE
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 3; const index = y * YUNET_INPUT_SIZE + x
      target[index] = rgb[source + 2]; target[plane + index] = rgb[source + 1]; target[2 * plane + index] = rgb[source]
    }
  }
  return target
}

export function boxIoU(a: Pick<FaceDetection, 'x' | 'y' | 'width' | 'height'>, b: Pick<FaceDetection, 'x' | 'y' | 'width' | 'height'>): number {
  const x0 = Math.max(a.x, b.x); const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.width, b.x + b.width); const y1 = Math.min(a.y + a.height, b.y + b.height)
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const union = a.width * a.height + b.width * b.height - intersection
  return union > 0 ? intersection / union : 0
}

export function nonMaximumSuppression<T extends FaceDetection>(detections: readonly T[], threshold: number): T[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score)
  const kept: T[] = []
  for (const detection of sorted) if (kept.every(other => boxIoU(detection, other) <= threshold)) kept.push(detection)
  return kept
}

/**
 * 解码模型输出为归一化（相对画面）的人脸框。`outputs` 的键是模型输出名（cls_8、obj_8、bbox_8 …）。
 * 阈值偏低（0.6）：打码宁可多覆盖，偶发误检由跟踪器的“连续命中才确认”过滤。
 */
export function decodeYunet(outputs: Readonly<Record<string, Float32Array>>, frameWidth: number, frameHeight: number, options: { scoreThreshold?: number; nmsThreshold?: number } = {}): FaceDetection[] {
  const { scoreThreshold = 0.6, nmsThreshold = 0.3 } = options
  const detections: FaceDetection[] = []
  for (const stride of STRIDES) {
    const cls = outputs[`cls_${stride}`]; const obj = outputs[`obj_${stride}`]; const bbox = outputs[`bbox_${stride}`]
    if (!cls || !obj || !bbox) throw new Error(`人脸检测输出缺少步长 ${stride}。`)
    const columns = YUNET_INPUT_SIZE / stride
    for (let index = 0; index < cls.length; index++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[index])) * Math.min(1, Math.max(0, obj[index])))
      if (score < scoreThreshold) continue
      const row = Math.floor(index / columns); const column = index % columns
      const cx = (column + bbox[index * 4]) * stride; const cy = (row + bbox[index * 4 + 1]) * stride
      const width = Math.exp(bbox[index * 4 + 2]) * stride; const height = Math.exp(bbox[index * 4 + 3]) * stride
      const x0 = Math.max(0, cx - width / 2); const y0 = Math.max(0, cy - height / 2)
      const x1 = Math.min(frameWidth, cx + width / 2); const y1 = Math.min(frameHeight, cy + height / 2)
      if (x1 <= x0 || y1 <= y0) continue
      detections.push({ x: x0 / frameWidth, y: y0 / frameHeight, width: (x1 - x0) / frameWidth, height: (y1 - y0) / frameHeight, score })
    }
  }
  return nonMaximumSuppression(detections, nmsThreshold)
}
