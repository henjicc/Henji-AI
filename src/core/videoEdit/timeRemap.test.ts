import { describe, expect, it } from 'vitest'
import { mirrorVideoEditTimeRemap, scaleVideoEditTimeRemap, shiftVideoEditTimeRemap, videoEditTimeRemapElapsedAt, videoEditTimeRemapSourceAt, videoEditTimeRemapSpeedAtSource, videoEditTimeRemapSpeedRange, videoEditTimeRemapSchema, type VideoEditTimeRemap } from './timeRemap'

const ramp: VideoEditTimeRemap = { points: [
  { offsetUs: 0, speed: 1, interpolation: 'linear' },
  { offsetUs: 2_000_000, speed: 3, interpolation: 'hold' },
  { offsetUs: 3_000_000, speed: 0.5, interpolation: 'ease' },
  { offsetUs: 5_000_000, speed: 2, interpolation: 'bezier', bezier: [0.2, 0.8, 0.4, 1] },
  { offsetUs: 6_000_000, speed: 0.25, interpolation: 'linear' },
] }

describe('时间重映射换算', () => {
  it('线性段解析积分：速度 1→3 走 2 秒源用 ln3 秒；保持段按左端速度', () => {
    expect(videoEditTimeRemapElapsedAt(ramp, 2)).toBeCloseTo(Math.log(3), 12)
    expect(videoEditTimeRemapElapsedAt(ramp, 3) - videoEditTimeRemapElapsedAt(ramp, 2)).toBeCloseTo(1 / 3, 12)
    // 最后一个点之后保持 0.25 倍：多 1 秒源要 4 秒。
    expect(videoEditTimeRemapElapsedAt(ramp, 7) - videoEditTimeRemapElapsedAt(ramp, 6)).toBeCloseTo(4, 9)
    // 第一个点之前按第一个速度外延（向前露出的内容）。
    expect(videoEditTimeRemapElapsedAt(ramp, -1)).toBeCloseTo(-1, 12)
  })
  it('缓动段与数值积分一致（误差 < 0.1 ms）', () => {
    let reference = 0; const steps = 200_000
    for (let i = 0; i < steps; i++) { const u = 3 + 2 * (i + .5) / steps; reference += 2 / steps / videoEditTimeRemapSpeedAtSource(ramp, u) }
    expect(Math.abs(videoEditTimeRemapElapsedAt(ramp, 5) - videoEditTimeRemapElapsedAt(ramp, 3) - reference)).toBeLessThan(1e-4)
  })
  it('严格单调且可逆：源 → 时间 → 源往返误差 < 1 微秒', () => {
    let previous = -Infinity
    for (let u = -2; u <= 9; u += 0.0137) {
      const t = videoEditTimeRemapElapsedAt(ramp, u)
      expect(t).toBeGreaterThan(previous); previous = t
      expect(Math.abs(videoEditTimeRemapSourceAt(ramp, t) - u)).toBeLessThan(1e-6)
    }
    for (let t = -1; t <= 12; t += 0.0191) expect(Math.abs(videoEditTimeRemapElapsedAt(ramp, videoEditTimeRemapSourceAt(ramp, t)) - t)).toBeLessThan(1e-6)
  })
  it('速度范围含缓动段的极值', () => {
    expect(videoEditTimeRemapSpeedRange(ramp)).toEqual({ min: 0.25, max: 3 })
  })
  it('比率拉伸：速度整体乘 2，时间减半', () => {
    const fast = scaleVideoEditTimeRemap(ramp, 2)
    for (const u of [1, 2.5, 4, 6.5]) expect(videoEditTimeRemapElapsedAt(fast, u)).toBeCloseTo(videoEditTimeRemapElapsedAt(ramp, u) / 2, 9)
  })
  it('开头移动：切在线性、保持与缓动段中间都保留原曲线，之后的换算与原曲线平移一致', () => {
    for (const shift of [1.3, 2.4, 3.7, 5.5, 8]) {
      const shifted = shiftVideoEditTimeRemap(ramp, shift)
      expect(videoEditTimeRemapSchema.safeParse(shifted).success).toBe(true)
      for (const u of [0, 0.4, 1.1, 2.9]) {
        const expected = videoEditTimeRemapElapsedAt(ramp, shift + u) - videoEditTimeRemapElapsedAt(ramp, shift)
        expect(Math.abs(videoEditTimeRemapElapsedAt(shifted, u) - expected), `${shift}/${u}`).toBeLessThan(2e-4)
      }
    }
    // 向前露出 1 秒：新开头按原第一个速度。
    const extended = shiftVideoEditTimeRemap(ramp, -1)
    expect(extended.points[0]).toEqual({ offsetUs: 0, speed: 1, interpolation: 'linear' })
    expect(videoEditTimeRemapElapsedAt(extended, 3)).toBeCloseTo(1 + Math.log(3), 9)
  })
  it('镜像（倒放）：倒过来的曲线走完同一段源用同样的时间，每一点的速度对称', () => {
    const span = 6.5
    const mirrored = mirrorVideoEditTimeRemap(ramp, span)
    expect(videoEditTimeRemapSchema.safeParse(mirrored).success).toBe(true)
    const total = videoEditTimeRemapElapsedAt(ramp, span)
    expect(Math.abs(videoEditTimeRemapElapsedAt(mirrored, span) - total)).toBeLessThan(1e-4)
    for (const u of [0.3, 1.2, 2.6, 3.9, 4.4, 6.1]) {
      expect(Math.abs(videoEditTimeRemapSpeedAtSource(mirrored, span - u) - videoEditTimeRemapSpeedAtSource(ramp, u)), `${u}`).toBeLessThan(1e-6)
      expect(Math.abs(videoEditTimeRemapElapsedAt(mirrored, span - u) - (total - videoEditTimeRemapElapsedAt(ramp, u))), `${u}`).toBeLessThan(2e-4)
    }
  })
  it('拒绝乱序与越界速度', () => {
    expect(videoEditTimeRemapSchema.safeParse({ points: [{ offsetUs: 5, speed: 1, interpolation: 'linear' }, { offsetUs: 5, speed: 2, interpolation: 'linear' }] }).success).toBe(false)
    expect(videoEditTimeRemapSchema.safeParse({ points: [{ offsetUs: 0, speed: 0, interpolation: 'linear' }] }).success).toBe(false)
  })
})
