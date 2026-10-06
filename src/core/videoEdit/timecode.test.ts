import { expect, it } from 'vitest'
import { parseVideoEditTimecodeInput, videoEditFrameTimecode } from './timecode'

/* 时间码输入（Premiere 习惯）：纯数字从右往左两位一组，超出进位，带 +/− 为相对移动，帧模式下数字就是帧号。 */

it('纯数字从右往左两位一组填进 时:分:秒:帧', () => {
  expect(parseVideoEditTimecodeInput('1230', 60, 0)).toBe(12 * 60 + 30)
  expect(parseVideoEditTimecodeInput('123000', 60, 0)).toBe((12 * 60 + 30) * 60)
  expect(parseVideoEditTimecodeInput('5', 30, 0)).toBe(5)
  expect(parseVideoEditTimecodeInput('123', 30, 0)).toBe(30 + 23)
  expect(parseVideoEditTimecodeInput('01000000', 25, 0)).toBe(3600 * 25)
})

it('帧或秒超出时自动进位：60 帧项目里 1299 = 13 秒 39 帧', () => {
  const frame = parseVideoEditTimecodeInput('1299', 60, 0)!
  expect(frame).toBe(12 * 60 + 99)
  expect(videoEditFrameTimecode(frame, 60)).toBe('00:00:13:39')
})

it('带分隔符逐段写，空段按 0；中文标点同样可用', () => {
  expect(parseVideoEditTimecodeInput('1:02:03', 30, 0)).toBe((60 + 2) * 30 + 3)
  expect(parseVideoEditTimecodeInput('12.', 30, 0)).toBe(12 * 30)
  expect(parseVideoEditTimecodeInput('1：00：00', 30, 0)).toBe(60 * 30)
})

it('开头 + / − 相对当前位置移动，不会小于 0', () => {
  expect(parseVideoEditTimecodeInput('+100', 30, 50)).toBe(50 + 30)
  expect(parseVideoEditTimecodeInput('-10', 30, 50)).toBe(40)
  expect(parseVideoEditTimecodeInput('-1000', 30, 50)).toBe(0)
})

it('帧模式下纯数字就是帧号；无效输入为 null', () => {
  expect(parseVideoEditTimecodeInput('1230', 60, 0, 'frames')).toBe(1230)
  expect(parseVideoEditTimecodeInput('', 30, 0)).toBeNull()
  expect(parseVideoEditTimecodeInput('abc', 30, 0)).toBeNull()
  expect(parseVideoEditTimecodeInput('1:2:3:4:5', 30, 0)).toBeNull()
})
