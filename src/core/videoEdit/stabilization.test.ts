import { beforeAll, describe, expect, it } from 'vitest'
import highsLoader, { type Highs } from 'highs'
import { videoEditClipToFrame } from './clipGeometry'
import { applyVideoEditSimilarity, invertVideoEditSimilarity } from './trackTransform'
import { solveVideoEditStabilization, videoEditStabilizationPictureTransform, videoEditStabilizedPath, videoEditStabilizedPlacement, videoEditTranslationJitter, type VideoEditCameraSample, type VideoEditClipStabilization } from './stabilization'

let highs: Highs
beforeAll(async () => { highs = await highsLoader() })

const aspect = 16 / 9
/** 手持抖动：确定性的多频正弦叠加，可加一段匀速平移（运动镜头）。 */
function shakyPath(frames: number, options: { amplitude?: number; pan?: number; roll?: number } = {}): VideoEditCameraSample[] {
  const amplitude = options.amplitude ?? 0.01
  return Array.from({ length: frames }, (_, t) => {
    const x = amplitude * (Math.sin(t * 1.7) + 0.6 * Math.sin(t * 3.1 + 1)) + (options.pan ?? 0) * t
    const y = amplitude * (Math.cos(t * 2.3) + 0.5 * Math.sin(t * 4.7))
    const angle = (options.roll ?? 0) * Math.sin(t * 1.3)
    return { transform: { a: Math.cos(angle), b: Math.sin(angle), tx: x, ty: y }, confidence: 1 }
  })
}
const params = (overrides: Partial<VideoEditClipStabilization> = {}): VideoEditClipStabilization => ({ smoothness: 'natural', maxCrop: 0.1, rotation: true, scale: true, ...overrides })

/** 每帧输出画面四角经 B(zoom·q) 都落在原画面内（不露黑边）。 */
function expectNoBorders(solution: ReturnType<typeof solveVideoEditStabilization>): void {
  for (const b of solution.corrections) for (const [qx, qy] of [[-aspect / 2, -0.5], [aspect / 2, -0.5], [aspect / 2, 0.5], [-aspect / 2, 0.5]]) {
    const [x, y] = applyVideoEditSimilarity(b, qx * solution.zoom, qy * solution.zoom)
    expect(Math.abs(x)).toBeLessThanOrEqual(aspect / 2 + 1e-6)
    expect(Math.abs(y)).toBeLessThanOrEqual(0.5 + 1e-6)
  }
}

describe('L1 最优相机路径', () => {
  it('锁定机位：去掉抖动，裁切不出黑边且不超过允许的最大裁切', () => {
    const samples = shakyPath(240)
    const solution = solveVideoEditStabilization(highs, samples, aspect, params({ smoothness: 'locked' }))
    expectNoBorders(solution)
    expect(solution.crop).toBeLessThanOrEqual(0.1 + 1e-6)
    expect(solution.crop).toBeGreaterThan(0)
    const before = videoEditTranslationJitter(samples.map(s => s.transform))
    const after = videoEditTranslationJitter(videoEditStabilizedPath(samples, solution))
    expect(after).toBeLessThan(before * 0.01)
  })

  it('自然：运动镜头保留平移趋势，抖动大幅减小', () => {
    const samples = shakyPath(300, { pan: 0.002 })
    const solution = solveVideoEditStabilization(highs, samples, aspect, params({ maxCrop: 0.15 }))
    expectNoBorders(solution)
    const path = videoEditStabilizedPath(samples, solution)
    expect(videoEditTranslationJitter(path)).toBeLessThan(videoEditTranslationJitter(samples.map(s => s.transform)) * 0.1)
    // 平滑路径跟着镜头走：与原路径的偏离不超过裁切窗口能容纳的平移（每侧 maxCrop × 画面宽 / 2）。
    const budget = 0.15 * aspect / 2
    expect(path.at(-1)!.tx - path[0].tx).toBeGreaterThan(0.002 * 299 - 2 * budget - 1e-3)
  })

  it('轻微：修正比自然更贴近原路径（平均修正量更小），仍去掉大半抖动', () => {
    const samples = shakyPath(240, { pan: 0.001 })
    const subtle = solveVideoEditStabilization(highs, samples, aspect, params({ smoothness: 'subtle' }))
    const natural = solveVideoEditStabilization(highs, samples, aspect, params())
    expectNoBorders(subtle)
    const deviation = (solution: typeof subtle): number => solution.corrections.reduce((sum, b) => sum + Math.hypot(b.tx, b.ty), 0) / solution.corrections.length
    expect(deviation(subtle)).toBeLessThan(deviation(natural))
    expect(videoEditTranslationJitter(videoEditStabilizedPath(samples, subtle))).toBeLessThan(videoEditTranslationJitter(samples.map(s => s.transform)) * 0.5)
  })

  it('关闭旋转校正：修正不含旋转，原镜头的旋转保留', () => {
    const samples = shakyPath(120, { roll: 0.02 })
    const solution = solveVideoEditStabilization(highs, samples, aspect, params({ rotation: false }))
    expect(solution.corrections.every(b => b.b === 0)).toBe(true)
    expectNoBorders(solution)
    const rolled = solveVideoEditStabilization(highs, samples, aspect, params())
    expect(rolled.corrections.some(b => Math.abs(b.b) > 1e-4)).toBe(true)
  })

  it('长片段分窗求解：接缝处路径连续，全程不出黑边', () => {
    const samples = shakyPath(1300, { pan: 0.0005 })
    const solution = solveVideoEditStabilization(highs, samples, aspect, params({ smoothness: 'locked', maxCrop: 0.2 }))
    expect(solution.corrections).toHaveLength(1300)
    expectNoBorders(solution)
    const path = videoEditStabilizedPath(samples, solution)
    const steps = path.slice(1).map((p, t) => Math.hypot(p.tx - path[t].tx, p.ty - path[t].ty))
    expect(Math.max(...steps)).toBeLessThan(0.01)
  })
})

describe('修正与片段变换叠加', () => {
  it('合成后的片段把画面点画在“先修正、再片段变换”的位置', () => {
    const picture = { width: 1920, height: 1080 }; const frame = { width: 1280, height: 720 }
    const clip = { x: 0.12, y: -0.05, scale: 0.8, rotation: 15, anchorX: 0.3, anchorY: 0.6 }
    const correction = { a: 1.01, b: 0.02, tx: 0.015, ty: -0.01 }
    const transform = videoEditStabilizationPictureTransform(correction, 0.92, { scale: true })
    const placed = videoEditStabilizedPlacement(clip, picture, frame, transform)
    for (const [u, v] of [[0, 0], [1, 0], [0.4, 0.7], [1, 1]]) {
      const [mx, my] = applyVideoEditSimilarity(transform, (u - 0.5) * aspect, v - 0.5)
      const expected = videoEditClipToFrame(clip, picture, frame, mx / aspect + 0.5, my + 0.5)
      const actual = videoEditClipToFrame(placed, picture, frame, u, v)
      expect(actual.x).toBeCloseTo(expected.x, 9)
      expect(actual.y).toBeCloseTo(expected.y, 9)
    }
  })

  it('关闭缩放校正时画面修正的缩放只有统一放大', () => {
    const transform = videoEditStabilizationPictureTransform({ a: 1.05, b: 0, tx: 0, ty: 0 }, 0.9, { scale: false })
    expect(invertVideoEditSimilarity(transform).a).toBeCloseTo(0.9, 9)
  })
})
