import { describe, expect, it } from 'vitest'
import { videoEditClipSpeedLabel, videoEditClipSpeedReadout } from './clipSpeedDisplay'

describe('片段速度的时间线标记与效果控件读数', () => {
  it.each([
    { clip: {}, label: '', readout: '' },
    { clip: { speed: { numerator: 1, denominator: 1 } }, label: '', readout: '' },
    { clip: { speed: { numerator: 2, denominator: 2 }, reverse: false, preservePitch: false }, label: '', readout: '' },
    { clip: { speed: { numerator: 2, denominator: 1 } }, label: '[200%]', readout: '速度 200%' },
    { clip: { speed: { numerator: 1, denominator: 2 } }, label: '[50%]', readout: '速度 50%' },
    { clip: { speed: { numerator: 251, denominator: 200 } }, label: '[125.5%]', readout: '速度 125.5%' },
    { clip: { speed: { numerator: 1, denominator: 3 } }, label: '[33.33%]', readout: '速度 33.33%' },
    { clip: { reverse: true }, label: '[-100%]', readout: '速度 100% · 倒放' },
    { clip: { speed: { numerator: 1, denominator: 2 }, reverse: true }, label: '[-50%]', readout: '速度 50% · 倒放' },
    { clip: { speed: { numerator: 2, denominator: 1 }, reverse: true, preservePitch: true }, label: '[-200%]', readout: '速度 200% · 倒放 · 保持音调' },
    { clip: { preservePitch: true }, label: '', readout: '速度 100% · 保持音调' },
    { clip: { speed: { numerator: 1, denominator: 100 } }, label: '[1%]', readout: '速度 1%' },
    { clip: { speed: { numerator: 100, denominator: 1 }, reverse: true }, label: '[-10000%]', readout: '速度 10000% · 倒放' },
  ])('速度状态 $clip → 标记「$label」与读数「$readout」', ({ clip, label, readout }) => {
    expect(videoEditClipSpeedLabel(clip)).toBe(label)
    expect(videoEditClipSpeedReadout(clip)).toBe(readout)
  })
})
