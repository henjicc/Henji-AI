import type * as OpenCv from '@techstark/opencv-js'
import { ransacVideoEditSimilarity, VIDEO_EDIT_IDENTITY_SIMILARITY, type VideoEditPoint, type VideoEditSimilarity } from '../../../../../src/core/videoEdit/trackTransform'

type Cv = typeof OpenCv

/*
 * 相机运动估计（防抖分析，后台推理进程）：上一帧按 4×3 网格各取 Shi-Tomasi 角点（避免大面积前景独占特征），
 * OpenCV 金字塔 LK 正反向跟踪剔除不可靠点，再用两点最小样本 RANSAC 求整体相似变换：
 * 背景占多数，前景运动物体的点不符合整体运动，落在离群点里。
 * OpenCV.js 没有 estimateAffinePartial2D，RANSAC 与精化在 trackTransform.ts（主线程单测同一份实现）。
 */

/** 防抖分析的解码尺寸：长边 640（LK 亚像素精度约 0.05 像素，换到 1080p 约 0.15 像素）。 */
export function cameraFrameSize(display: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(1, 640 / Math.max(1, display.width, display.height))
  return { width: Math.max(32, Math.round(display.width * scale)), height: Math.max(32, Math.round(display.height * scale)) }
}

const GRID_X = 4
const GRID_Y = 3
const PER_CELL = 28

export class CameraMotionEstimator {
  private previous?: OpenCv.Mat
  constructor(private readonly cv: Cv, readonly width: number, readonly height: number) {}
  private gray(rgb: Uint8Array): OpenCv.Mat {
    const source = this.cv.matFromArray(this.height, this.width, this.cv.CV_8UC3, rgb)
    const gray = new this.cv.Mat()
    try { this.cv.cvtColor(source, gray, this.cv.COLOR_RGB2GRAY); return gray } catch (error) { gray.delete(); throw error } finally { source.delete() }
  }
  reset(rgb: Uint8Array): void { this.previous?.delete(); this.previous = this.gray(rgb) }
  /** 这一帧到上一帧的相似变换（画面中心为原点、画面高度为单位）与可信度（内点比例）；估计不出来时为单位变换、可信度 0。 */
  step(rgb: Uint8Array): { motion: VideoEditSimilarity; confidence: number } {
    const cv = this.cv; const current = this.gray(rgb)
    const allocated: OpenCv.Mat[] = []
    const mat = (): OpenCv.Mat => { const m = new cv.Mat(); allocated.push(m); return m }
    try {
      if (!this.previous) return { motion: VIDEO_EDIT_IDENTITY_SIMILARITY, confidence: 0 }
      const corners: number[] = []
      const cellW = Math.floor(this.width / GRID_X); const cellH = Math.floor(this.height / GRID_Y)
      const minDistance = Math.max(4, Math.round(this.height * 0.025))
      for (let gy = 0; gy < GRID_Y; gy++) for (let gx = 0; gx < GRID_X; gx++) {
        const x = gx * cellW; const y = gy * cellH
        const cell = this.previous.roi(new cv.Rect(x, y, gx === GRID_X - 1 ? this.width - x : cellW, gy === GRID_Y - 1 ? this.height - y : cellH)); allocated.push(cell)
        const found = mat()
        cv.goodFeaturesToTrack(cell, found, PER_CELL, 0.01, minDistance)
        for (let i = 0; i < found.rows; i++) corners.push(found.data32F[i * 2] + x, found.data32F[i * 2 + 1] + y)
      }
      if (corners.length < 16) return { motion: VIDEO_EDIT_IDENTITY_SIMILARITY, confidence: 0 }
      const points = cv.matFromArray(corners.length / 2, 1, cv.CV_32FC2, corners); allocated.push(points)
      const next = mat(); const status = mat(); const error = mat(); const back = mat(); const backStatus = mat(); const backError = mat()
      // 15×15 窗口、3 层金字塔（640 宽度下可跟住每帧约 ±56 像素的抖动），正反两遍每帧约 11 毫秒（OpenCV.js 实测）。
      const window = new cv.Size(15, 15)
      const criteria = new cv.TermCriteria(cv.TermCriteria_COUNT | cv.TermCriteria_EPS, 30, 0.01)
      cv.calcOpticalFlowPyrLK(this.previous, current, points, next, status, error, window, 3, criteria)
      cv.calcOpticalFlowPyrLK(current, this.previous, next, back, backStatus, backError, window, 3, criteria)
      const from: VideoEditPoint[] = []; const to: VideoEditPoint[] = []
      const toIso = (x: number, y: number): VideoEditPoint => [(x - this.width / 2) / this.height, (y - this.height / 2) / this.height]
      for (let i = 0; i < points.rows; i++) {
        const x = points.data32F[i * 2]; const y = points.data32F[i * 2 + 1]; const nx = next.data32F[i * 2]; const ny = next.data32F[i * 2 + 1]
        const fb = Math.hypot(back.data32F[i * 2] - x, back.data32F[i * 2 + 1] - y)
        if (!status.data[i] || !backStatus.data[i] || !(fb < 1) || nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue
        // 当前帧 → 上一帧：累计路径 C_t = C_{t−1} ∘ S。
        from.push(toIso(nx, ny)); to.push(toIso(x, y))
      }
      const fit = ransacVideoEditSimilarity(from, to, { threshold: 1.5 / this.height, iterations: 300, minSeparation: 0.1 })
      if (!fit || fit.ratio < 0.2 || fit.inliers.filter(Boolean).length < 8) return { motion: VIDEO_EDIT_IDENTITY_SIMILARITY, confidence: 0 }
      return { motion: fit.similarity, confidence: Math.round(fit.ratio * 1000) / 1000 }
    } finally {
      for (const m of allocated) m.delete()
      this.previous?.delete(); this.previous = current
    }
  }
  dispose(): void { this.previous?.delete(); this.previous = undefined }
}
