import { expect, it } from 'vitest'
import { offsetVideoEditSource, rescaleVideoEditFrame, videoEditSourceSeconds } from './time'
import { changeVideoEditSequenceSettings, createVideoEditSequence } from './document'

it('29.97/59.94 连续源时间偏移与一次换算相等，不累计微秒舍入', () => {
  for (const rate of [{ numerator: 30000, denominator: 1001 }, { numerator: 60000, denominator: 1001 }]) {
    let time = { sourceInUs: 123456, sourceRemainder: { numerator: 0, denominator: 1 } }
    for (let frame = 0; frame < 53000; frame++) time = offsetVideoEditSource(time, 1, rate)
    expect(time).toEqual(offsetVideoEditSource({ sourceInUs: 123456, sourceRemainder: { numerator: 0, denominator: 1 } }, 53000, rate))
    expect(offsetVideoEditSource(time, -53000, rate)).toEqual({ sourceInUs: 123456, sourceRemainder: { numerator: 0, denominator: 1 } })
    expect(videoEditSourceSeconds(time)).toBeCloseTo(.123456 + 53000 * rate.denominator / rate.numerator, 10)
  }
})
it('混合帧率换算以绝对边界求值', () => {
  const ntsc = { numerator: 30000, denominator: 1001 }
  expect(rescaleVideoEditFrame(30000, ntsc, { numerator: 60, denominator: 1 })).toBe(60060)
  const sequence = createVideoEditSequence()
  sequence.clips = [{ id: 'clip', itemId: 'item', name: 'clip', kind: 'video', track: 1, start: 13, duration: 33, sourceInUs: 123456, sourceRemainder: { numerator: 1, denominator: 3 }, x: .2, y: .3, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }]
  const updated = changeVideoEditSequenceSettings(sequence, { frameRate: ntsc, width: 2160, height: 3840, sampleRate: 44100, channels: 1 })
  const clip = updated.clips[0]
  expect(clip.start).toBe(rescaleVideoEditFrame(13, sequence.frameRate, ntsc))
  expect(clip.start + clip.duration).toBe(rescaleVideoEditFrame(46, sequence.frameRate, ntsc))
  expect(clip).toMatchObject({ sourceInUs: 123456, sourceRemainder: { numerator: 1, denominator: 3 }, x: .2, y: .3 })
  const short = { ...sequence, frameRate: { numerator: 60, denominator: 1 }, clips: [{ ...sequence.clips[0], start: 1, duration: 1 }] }
  expect(() => changeVideoEditSequenceSettings(short, { frameRate: { numerator: 30, denominator: 1 } })).toThrow('短于一帧')
})
