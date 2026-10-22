import { describe, expect, it } from 'vitest'
import { applyAudioEditSpliceFade, buildAudioEditSpliceFades } from './spliceDeclick'
import type { AudioEditTimelineSpan } from './types'

const span = (start: number, end: number, muted?: boolean): AudioEditTimelineSpan => ({ sourceStartFrame: start, sourceEndFrame: end, outputStartFrame: 0, outputEndFrame: end - start, muted })

describe('剪切点微淡变', () => {
  it('删除拼接点两侧各淡变 5ms，文件首尾不淡变且不修改时间线', () => {
    const spans = [span(100, 1100), span(2000, 3000)]
    const original = structuredClone(spans)
    expect(buildAudioEditSpliceFades(spans, 48000)).toEqual([
      { lengthFrames: 1000, fadeInFrames: 0, fadeOutFrames: 240 },
      { lengthFrames: 1000, fadeInFrames: 240, fadeOutFrames: 0 },
    ])
    expect(buildAudioEditSpliceFades(spans, 44100)[0].fadeOutFrames).toBe(221)
    expect(spans).toEqual(original)
  })

  it('连续且静音状态相同的边界不淡变，未声明与 false 等价', () => {
    expect(buildAudioEditSpliceFades([span(0, 1000), span(1000, 2000, false)], 48000)
      .every(fade => !fade.fadeInFrames && !fade.fadeOutFrames)).toBe(true)
    expect(buildAudioEditSpliceFades([span(0, 1000, true), span(1000, 2000, true)], 48000)
      .every(fade => !fade.fadeInFrames && !fade.fadeOutFrames)).toBe(true)
    expect(buildAudioEditSpliceFades([span(100, 2000)], 48000)).toEqual([{ lengthFrames: 1900, fadeInFrames: 0, fadeOutFrames: 0 }])
    expect(buildAudioEditSpliceFades([], 48000)).toEqual([])
  })

  it('源时间连续的静音进出仍淡变', () => {
    expect(buildAudioEditSpliceFades([span(0, 1000), span(1000, 2000, true), span(2000, 3000)], 48000)).toEqual([
      { lengthFrames: 1000, fadeInFrames: 0, fadeOutFrames: 240 },
      { lengthFrames: 1000, fadeInFrames: 240, fadeOutFrames: 240 },
      { lengthFrames: 1000, fadeInFrames: 240, fadeOutFrames: 0 },
    ])
  })

  it.each([1, 2, 3, 99, 479, 480])('短片段 %i 帧的两侧淡变不重叠，不产生无效样本', length => {
    const fade = buildAudioEditSpliceFades([span(0, 1000), span(2000, 2000 + length), span(4000, 5000)], 48000)[1]
    expect(fade.fadeInFrames).toBe(Math.floor(length / 2))
    expect(fade.fadeOutFrames).toBe(Math.floor(length / 2))
    const output = applyAudioEditSpliceFade(new Float32Array(length).fill(0.5), 1, 0, fade)
    expect(output).toHaveLength(length)
    expect(output.every(value => Number.isFinite(value) && value >= 0 && value <= 0.5)).toBe(true)
  })

  it('双声道拼接最大跳变低于 0.004，淡变外样本与输入逐个相同', () => {
    const spans = [span(0, 1000), span(2000, 3000)]
    const fades = buildAudioEditSpliceFades(spans, 48000)
    const left = Float32Array.from({ length: 2000 }, (_, i) => i % 2 ? -0.75 : 0.75)
    const right = Float32Array.from({ length: 2000 }, (_, i) => i % 2 ? 0.5 : -0.5)
    const before = left.slice()
    const output = new Float32Array(4000)
    output.set(applyAudioEditSpliceFade(left, 2, 0, fades[0]))
    output.set(applyAudioEditSpliceFade(right, 2, 0, fades[1]), 2000)
    let maxJump = 0
    for (let i = 2; i < output.length; i++) maxJump = Math.max(maxJump, Math.abs(output[i] - output[i - 2]))
    expect(maxJump).toBeLessThan(0.004)
    expect(output.slice(0, 760 * 2)).toEqual(left.slice(0, 760 * 2))
    expect(output.slice(1240 * 2)).toEqual(right.slice(240 * 2))
    expect(left).toEqual(before)
  })

  it('分块读取和从淡变中间跳播与完整处理逐样本相同', () => {
    const fade = buildAudioEditSpliceFades([span(0, 1000), span(2000, 3000), span(4000, 5000)], 48000)[1]
    const source = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i / 13))
    const whole = applyAudioEditSpliceFade(source, 2, 0, fade)
    for (const [start, end] of [[0, 80], [80, 800], [800, 900], [900, 1000]]) {
      expect(applyAudioEditSpliceFade(source.subarray(start * 2, end * 2), 2, start, fade)).toEqual(whole.slice(start * 2, end * 2))
    }
  })
})
