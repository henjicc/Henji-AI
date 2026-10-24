import { describe, expect, it } from 'vitest'
import { videoEditClipSchema, type VideoEditClip } from './document'
import { evaluateVideoEditClip } from './keyframes'
import { VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES, videoEditMotionBlurSamples } from './motionBlur'

const document = { width: 1920, height: 1080, media: [], items: [], sequences: [] }
const clip = (patch: Partial<VideoEditClip> = {}): VideoEditClip => videoEditClipSchema.parse({ id: 'c', itemId: 'i', name: '画面', kind: 'text', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: 'A', ...patch })

describe('运动模糊快门取样', () => {
  it('没有变换动画、动得太少或关了运动分区时不取样', () => {
    expect(videoEditMotionBlurSamples(document, clip(), clip(), 10)).toBeUndefined()
    const still = clip({ curves: { opacity: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 59, value: 1, interpolation: 'linear' }] } })
    expect(videoEditMotionBlurSamples(document, still, evaluateVideoEditClip(still, 10), 10)).toBeUndefined()
    const creep = clip({ curves: { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 59, value: .0001, interpolation: 'linear' }] } })
    expect(videoEditMotionBlurSamples(document, creep, evaluateVideoEditClip(creep, 10), 10)).toBeUndefined()
    const off = clip({ disabledIntrinsicSections: ['motion'], curves: { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 10, value: 1, interpolation: 'linear' }] } })
    expect(videoEditMotionBlurSamples(document, off, evaluateVideoEditClip(off, 5), 5)).toBeUndefined()
  })

  it('180° 快门以当前帧为中心，样本数随位移增多并封顶；跟随、防抖带来的偏移在快门内保持不变', () => {
    // 每帧向右移动画面宽度的 1%（19.2 像素）：半帧快门覆盖 9.6 像素
    const moving = clip({ curves: { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 50, value: .5, interpolation: 'linear' }] } })
    const evaluated = { ...evaluateVideoEditClip(moving, 20), y: .1 }
    const samples = videoEditMotionBlurSamples(document, moving, evaluated, 20)!
    expect(samples.length).toBe(7)
    const xs = samples.map(sample => sample.x)
    expect((xs[0] + xs[xs.length - 1]) / 2).toBeCloseTo(evaluated.x)
    expect(xs[xs.length - 1] - xs[0]).toBeCloseTo(.01 * (samples.length - 1) / samples.length * .5)
    expect(samples.every(sample => sample.y === .1)).toBe(true)
    const fast = clip({ curves: { rotation: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 10, value: 360, interpolation: 'linear' }] } })
    expect(videoEditMotionBlurSamples(document, fast, evaluateVideoEditClip(fast, 5), 5)).toHaveLength(VIDEO_EDIT_MOTION_BLUR_MAX_SAMPLES)
  })

  it('缩放按倍率叠加，非等比比例保留在每个样本上', () => {
    const zoom = clip({ scaleAspect: 2, curves: { scale: [{ time: 0, value: 1, interpolation: 'linear' }, { time: 10, value: 2, interpolation: 'linear' }] } })
    const evaluated = { ...evaluateVideoEditClip(zoom, 5), scale: evaluateVideoEditClip(zoom, 5).scale * .5 }
    const samples = videoEditMotionBlurSamples(document, zoom, evaluated, 5)!
    expect(samples.every(sample => sample.scaleAspect === 2)).toBe(true)
    const middle = samples.reduce((sum, sample) => sum + sample.scale, 0) / samples.length
    expect(middle).toBeCloseTo(evaluated.scale, 3)
  })
})
