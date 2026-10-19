import type * as OpenCv from '@techstark/opencv-js'
import { validateVideoMotionScan, type VideoMotionOptions, type VideoMotionScan } from '../../../../src/core/media/motionEvidence'
import type { MotionReviewSample } from '../../../../src/core/media/motionReview'

type Cv = typeof OpenCv
export function videoMotionDisplaySpeed(affine: readonly [number, number, number, number, number, number], options: VideoMotionOptions): number {
  const [a, b, tx, c, d, ty] = affine, { width, height, fps } = options
  const aspect = options.sourceAspectRatio ?? width / height, angle = (options.displayRotation ?? 0) * Math.PI / 180
  const displayWidth = Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)) / aspect
  const displacement = Math.max(...[[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => Math.hypot((a * x + b * y + tx - x) / width, (c * x + d * y + ty - y) / height / aspect)))
  return displacement / displayWidth * fps * 100
}

/** OpenCV Shi–Tomasi + pyramidal LK + RANSAC affine fit, used only in a Worker.
 * Spatial coverage rejects tiny moving subjects as evidence of whole-frame motion.
 * Residual pixels and raw stillness remain evidence, never an aesthetic verdict. */
export class VideoMotionAccumulator {
  private previous?: OpenCv.Mat
  private samples: MotionReviewSample[] = []
  private finished = false
  readonly expectedFrames: number
  constructor(private readonly cv: Cv, private readonly options: VideoMotionOptions) {
    const { width, height, fps, startSeconds, endSeconds } = options
    this.expectedFrames = Math.ceil((endSeconds - startSeconds) * fps - 1e-9)
    if (options.sourceAspectRatio !== undefined && (!Number.isFinite(options.sourceAspectRatio) || options.sourceAspectRatio <= 0) || options.displayRotation !== undefined && !Number.isFinite(options.displayRotation)) throw new Error('运动分析的显示比例或旋转无效。')
    if (![width, height, fps].every(Number.isSafeInteger) || width < 32 || width > 1024 || height < 32 || height > 1024 || fps < 1 || fps > 60 || !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 86400 || this.expectedFrames > 60000 || options.channels !== 1) throw new Error('运动分析范围、尺寸或采样率无效，请缩小范围。')
  }
  push(gray: Uint8Array): void {
    const { width, height, fps, startSeconds, endSeconds } = this.options
    if (this.finished || this.samples.length >= this.expectedFrames) throw new Error('运动分析已结束或收到多余帧。')
    if (gray.length !== width * height) throw new Error('运动分析帧尺寸不完整。')
    const cv = this.cv, current = cv.matFromArray(height, width, cv.CV_8UC1, gray)
    const i = this.samples.length
    const sample: MotionReviewSample = { fromSeconds: startSeconds + i / fps, toSeconds: Math.min(endSeconds, startSeconds + (i + 1) / fps), speed: null, zoom: null, change: null, cut: false, still: null }
    try {
      if (this.previous) {
        const previous = this.previous
        let changed = 0, absoluteDifference = 0
        for (let index = 0; index < gray.length; index++) {
          const difference = Math.abs(previous.data[index] - gray[index]); absoluteDifference += difference
          if (difference >= 12) changed++
        }
        const rawChange = changed / gray.length
        // Featureless identical pictures are visibly still even without optical flow.
        if (absoluteDifference === 0) { sample.still = true; sample.speed = 0; sample.zoom = 0; sample.change = 0 }
        else {
          Object.assign(sample, this.compare(previous, current, rawChange))
          // A subpixel drift must not become "still" just because adjacent pixels
          // differ by less than the residual threshold at this sampling rate.
          sample.still = sample.speed === null ? null : rawChange < .0015 && sample.speed < .25 && !sample.cut
        }
      }
      this.samples.push(sample)
    } catch (error) {
      this.finished = true
      throw error
    } finally {
      this.previous?.delete(); this.previous = current
    }
  }
  private compare(previous: OpenCv.Mat, current: OpenCv.Mat, rawChange: number): Pick<MotionReviewSample, 'speed' | 'zoom' | 'change' | 'cut'> {
    const cv = this.cv, { width, height, fps } = this.options, allocated: OpenCv.Mat[] = []
    const mat = (): OpenCv.Mat => { const value = new cv.Mat(); allocated.push(value); return value }
    const unknown = (): Pick<MotionReviewSample, 'speed' | 'zoom' | 'change' | 'cut'> => ({ speed: null, zoom: null, change: rawChange, cut: rawChange > .45 })
    try {
      const points = mat(); cv.goodFeaturesToTrack(previous, points, 160, .01, 8)
      if (points.rows < 12) return unknown()
      const next = mat(), status = mat(), error = mat(), back = mat(), backStatus = mat(), backError = mat()
      const window = new cv.Size(21, 21), criteria = new cv.TermCriteria(cv.TermCriteria_COUNT | cv.TermCriteria_EPS, 30, .01)
      cv.calcOpticalFlowPyrLK(previous, current, points, next, status, error, window, 3, criteria)
      cv.calcOpticalFlowPyrLK(current, previous, next, back, backStatus, backError, window, 3, criteria)
      const source: number[] = [], destination: number[] = []
      for (let i = 0; i < points.rows; i++) {
        const x = points.data32F[i * 2], y = points.data32F[i * 2 + 1], nx = next.data32F[i * 2], ny = next.data32F[i * 2 + 1]
        const distance = Math.hypot(back.data32F[i * 2] - x, back.data32F[i * 2 + 1] - y)
        if (status.data[i] && backStatus.data[i] && Number.isFinite(distance) && distance < 1.5 && error.data32F[i] < 30 && nx >= 0 && nx < width && ny >= 0 && ny < height) { source.push(x, y); destination.push(nx, ny) }
      }
      if (source.length < 24) return unknown()
      const from = cv.matFromArray(source.length / 2, 1, cv.CV_32FC2, source), to = cv.matFromArray(destination.length / 2, 1, cv.CV_32FC2, destination)
      allocated.push(from, to)
      const inliers = mat()
      // The shipped OpenCV.js exposes estimateAffine2D, not estimateAffinePartial2D.
      const affine = cv.estimateAffine2D(from, to, inliers, cv.RANSAC, 2, 1000, .995, 10) as OpenCv.Mat
      allocated.push(affine)
      if (affine.empty()) return unknown()
      const good: number[] = [], cells = new Set<number>()
      for (let i = 0; i < inliers.data.length; i++) if (inliers.data[i]) {
        good.push(i); cells.add(Math.min(2, Math.floor(source[i * 2] / width * 3)) + 3 * Math.min(2, Math.floor(source[i * 2 + 1] / height * 3)))
      }
      if (good.length < 12 || good.length / (source.length / 2) < .6 || cells.size < 4) return unknown()
      const xs = good.map(i => source[i * 2]), ys = good.map(i => source[i * 2 + 1])
      if (Math.max(...xs) - Math.min(...xs) < width * .3 || Math.max(...ys) - Math.min(...ys) < height * .3) return unknown()
      const [a, b, tx, c, d, ty] = Array.from(affine.data64F), determinant = a * d - b * c
      if (![a, b, tx, c, d, ty].every(Number.isFinite) || determinant < .5 || determinant > 2) return unknown()
      const warped = mat(), mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(255)), warpedMask = mat(); allocated.push(mask)
      cv.warpAffine(previous, warped, affine, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0))
      // Use the same bilinear footprint as the image. Nearest-neighbor validity
      // incorrectly included partially out-of-bounds pixels during subpixel drift.
      cv.warpAffine(mask, warpedMask, affine, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0))
      let count = 0, residual = 0
      for (let i = 0; i < width * height; i++) if (warpedMask.data[i] === 255) { count++; if (Math.abs(warped.data[i] - current.data[i]) >= 12) residual++ }
      if (count < width * height * .6) return unknown()
      const change = residual / count
      if (change > .3) return unknown()
      return { speed: videoMotionDisplaySpeed([a, b, tx, c, d, ty], this.options), zoom: Math.log(Math.sqrt(determinant)) * fps * 100, change, cut: false }
    } finally { for (const value of allocated) value.delete() }
  }
  finish(): VideoMotionScan {
    if (this.finished) throw new Error('运动分析已经结束。')
    this.finished = true
    const { startSeconds, endSeconds, fps, width, height } = this.options
    return validateVideoMotionScan({ startSeconds, endSeconds, samplingFps: fps, width, height, sampledFrames: this.samples.length, samples: this.samples }, startSeconds, endSeconds)
  }
  dispose(): void { this.finished = true; this.previous?.delete(); this.previous = undefined }
}
