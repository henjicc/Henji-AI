import type { SmartRegionBox } from '../../../../../src/core/videoEdit/smartRegions'
import { boxIoU, type FaceDetection } from './yunet'

/*
 * 人脸逐帧跟随（SORT 思路，无额外权重）：每条轨迹对中心与宽高各用一个匀速卡尔曼滤波，
 * 每帧先预测，再按 IoU 贪心匹配检测结果。离线分析可以回看：
 * - 连续命中 2 帧（或单帧置信度很高）才确认是人脸，确认后把它之前的试探帧也补上，打码不会晚一两帧才出现；
 * - 检测丢失（侧脸、遮挡、运动模糊）时按预测继续覆盖最多 0.5 秒，宁可多盖不漏盖；
 * - 输出的是滤波后的框，抖动比逐帧检测小。
 */

interface Axis { value: number; velocity: number; p00: number; p01: number; p11: number }
const PROCESS_NOISE = 0.02
const MEASURE_NOISE = 0.05

function axis(value: number, scale: number): Axis { return { value, velocity: 0, p00: (scale * MEASURE_NOISE) ** 2, p01: 0, p11: (scale * 0.5) ** 2 } }
function predictAxis(state: Axis, scale: number): void {
  state.value += state.velocity
  const q = (scale * PROCESS_NOISE) ** 2
  state.p00 += 2 * state.p01 + state.p11 + q / 4
  state.p01 += state.p11 + q / 2
  state.p11 += q
}
function updateAxis(state: Axis, measurement: number, scale: number): void {
  const r = (scale * MEASURE_NOISE) ** 2
  const s = state.p00 + r
  const k0 = state.p00 / s; const k1 = state.p01 / s
  const residual = measurement - state.value
  state.value += k0 * residual; state.velocity += k1 * residual
  const p00 = state.p00; const p01 = state.p01
  state.p00 = (1 - k0) * p00; state.p01 = (1 - k0) * p01; state.p11 -= k1 * p01
}

interface Track {
  id: number
  cx: Axis; cy: Axis; w: Axis; h: Axis
  hits: number
  misses: number
  confirmed: boolean
  score: number
  /** 每帧输出（帧号 → 框），确认前也记下，确认后一起输出。 */
  frames: Map<number, SmartRegionBox>
}

export interface FaceTrackerOptions {
  fps: number
  /** 匹配所需的最小 IoU。 */
  iouThreshold?: number
  /** 丢失后继续按预测覆盖的秒数。 */
  coastSeconds?: number
  /** 单帧即可确认的置信度。 */
  instantScore?: number
}

function boxOf(track: Track): { x: number; y: number; width: number; height: number } {
  const width = Math.max(0.001, track.w.value); const height = Math.max(0.001, track.h.value)
  return { x: track.cx.value - width / 2, y: track.cy.value - height / 2, width, height }
}

function record(track: Track, frame: number): void {
  const box = boxOf(track)
  const x0 = Math.max(0, box.x); const y0 = Math.max(0, box.y)
  const x1 = Math.min(1, box.x + box.width); const y1 = Math.min(1, box.y + box.height)
  if (x1 <= x0 || y1 <= y0) return
  const round = (value: number): number => Math.round(value * 10000) / 10000
  track.frames.set(frame, [round(x0), round(y0), round(x1 - x0), round(y1 - y0), Math.round(track.score * 100) / 100, track.id])
}

/** 逐帧检测 → 逐帧带轨迹编号的人脸框（编号从 1 开始）。 */
export function trackFaces(detections: readonly (readonly FaceDetection[])[], options: FaceTrackerOptions): SmartRegionBox[][] {
  const { fps, iouThreshold = 0.25, coastSeconds = 0.5, instantScore = 0.85 } = options
  const maxMisses = Math.max(1, Math.round(coastSeconds * fps))
  const live: Track[] = []; const finished: Track[] = []
  let nextId = 1
  detections.forEach((frameDetections, frame) => {
    for (const track of live) {
      const size = Math.max(track.w.value, track.h.value)
      predictAxis(track.cx, size); predictAxis(track.cy, size); predictAxis(track.w, size); predictAxis(track.h, size)
    }
    const pairs: Array<{ track: Track; detection: FaceDetection; iou: number }> = []
    for (const track of live) for (const detection of frameDetections) {
      const iou = boxIoU(boxOf(track), detection)
      if (iou >= iouThreshold) pairs.push({ track, detection, iou })
    }
    pairs.sort((a, b) => b.iou - a.iou)
    const matchedTracks = new Set<Track>(); const matchedDetections = new Set<FaceDetection>()
    for (const { track, detection } of pairs) {
      if (matchedTracks.has(track) || matchedDetections.has(detection)) continue
      matchedTracks.add(track); matchedDetections.add(detection)
      const size = Math.max(detection.width, detection.height)
      updateAxis(track.cx, detection.x + detection.width / 2, size); updateAxis(track.cy, detection.y + detection.height / 2, size)
      updateAxis(track.w, detection.width, size); updateAxis(track.h, detection.height, size)
      track.hits++; track.misses = 0; track.score = detection.score
      if (track.hits >= 2 || detection.score >= instantScore) track.confirmed = true
      record(track, frame)
    }
    for (let index = live.length - 1; index >= 0; index--) {
      const track = live[index]
      if (matchedTracks.has(track)) continue
      track.misses++
      // 试探中的轨迹丢了就作废；已确认的按预测继续覆盖一小段。
      if (!track.confirmed || track.misses > maxMisses) { live.splice(index, 1); finished.push(track); continue }
      record(track, frame)
    }
    for (const detection of frameDetections) {
      if (matchedDetections.has(detection)) continue
      const size = Math.max(detection.width, detection.height)
      const track: Track = {
        id: nextId++, cx: axis(detection.x + detection.width / 2, size), cy: axis(detection.y + detection.height / 2, size),
        w: axis(detection.width, size), h: axis(detection.height, size),
        hits: 1, misses: 0, confirmed: detection.score >= instantScore, score: detection.score, frames: new Map(),
      }
      record(track, frame); live.push(track)
    }
  })
  finished.push(...live)
  const output: SmartRegionBox[][] = detections.map(() => [])
  // 编号按确认顺序重新从 1 排，未确认的试探轨迹丢弃。
  let id = 1
  for (const track of finished.filter(track => track.confirmed).sort((a, b) => Math.min(...a.frames.keys()) - Math.min(...b.frames.keys()))) {
    const trackId = id++
    for (const [frame, box] of track.frames) output[frame].push([box[0], box[1], box[2], box[3], box[4], trackId])
  }
  return output
}
