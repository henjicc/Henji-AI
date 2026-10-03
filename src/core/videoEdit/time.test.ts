import { expect, it } from 'vitest'
import { offsetVideoEditSource, rescaleVideoEditFrame, videoEditSourceSeconds, VIDEO_EDIT_CONTAINER_TIMESTAMP_TOLERANCE_SECONDS, videoEditFps, videoEditPictureSeconds } from './time'
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

/** "The last picture starting at or before the time", as every decoder backend selects pictures. */
const pictureAt = (starts: number[], time: number): number => { let found = -1; for (let index = 0; index < starts.length; index++) if (starts[index] <= time) found = index; return found }
it('容器时间戳取整容差：Matroska 毫秒取整的 60/59.94/29.97fps 每一序列帧都选到自己的画面（3.2 缺陷 D3）', () => {
  for (const rate of [{ numerator: 60, denominator: 1 }, { numerator: 60000, denominator: 1001 }, { numerator: 30000, denominator: 1001 }]) {
    const fps = videoEditFps(rate)
    const starts = Array.from({ length: 600 }, (_, frame) => Math.round(frame / fps * 1000) / 1000)
    // Without the tolerance a third of the frames show the previous picture (frame 91 at 60fps is stored as 1.517s).
    if (rate.numerator === 60) expect(pictureAt(starts, 91 / fps)).toBe(90)
    for (let frame = 0; frame < 600; frame++) expect(pictureAt(starts, videoEditPictureSeconds(frame / fps)), `${rate.numerator}/${rate.denominator} 第 ${frame} 帧`).toBe(frame)
  }
})
it('容器时间戳取整容差：微秒精确衔接的时间戳不误选下一帧；可变帧率只提前不超过容差', () => {
  // Native pictures after D1: start truncated to whole microseconds, frames abut exactly.
  const starts = Array.from({ length: 600 }, (_, frame) => Math.trunc(frame * 1e6 / 60) / 1e6)
  for (let frame = 0; frame < 600; frame++) expect(pictureAt(starts, videoEditPictureSeconds(frame / 60))).toBe(frame)
  // A variable-frame-rate picture starting within the tolerance after the time shows that much early, never later ones.
  expect(VIDEO_EDIT_CONTAINER_TIMESTAMP_TOLERANCE_SECONDS).toBeLessThan(1 / 240 / 2)
  expect(pictureAt([0, 1.0005], videoEditPictureSeconds(1))).toBe(1)
  expect(pictureAt([0, 1.0007], videoEditPictureSeconds(1))).toBe(0)
})
