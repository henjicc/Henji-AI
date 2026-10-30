import { expect, it } from 'vitest'
import { createVideoEditSequence } from './document'
import { retimeVideoEditCaption, rollVideoEditCaptions } from './captionTiming'
import { videoEditFps } from './time'

it('移动与双边修剪按帧停在相邻句、序列与所属片段边界，锁定禁止编辑', () => {
  const sequence = { ...createVideoEditSequence(), captions: [
    { id: 'a', start: 10, duration: 20, text: '前句' },
    { id: 'b', start: 40, duration: 20, text: '当前句' },
    { id: 'c', start: 80, duration: 20, text: '后句' },
  ] }
  expect(retimeVideoEditCaption(sequence, 'b', 'move', -100)).toMatchObject({ start: 30, duration: 20 })
  expect(retimeVideoEditCaption(sequence, 'b', 'move', 100)).toMatchObject({ start: 60, duration: 20 })
  expect(retimeVideoEditCaption(sequence, 'b', 'move', 2.6).start).toBe(43)
  expect(retimeVideoEditCaption(sequence, 'b', 'in', -100)).toMatchObject({ start: 30, duration: 30 })
  expect(retimeVideoEditCaption(sequence, 'b', 'in', 100)).toMatchObject({ start: 59, duration: 1 })
  expect(retimeVideoEditCaption(sequence, 'b', 'out', 100)).toMatchObject({ start: 40, duration: 40 })
  expect(retimeVideoEditCaption(sequence, 'b', 'out', -100).duration).toBe(1)
  expect(retimeVideoEditCaption(sequence, 'a', 'move', -100).start).toBe(0)
  expect(() => retimeVideoEditCaption({ ...sequence, captionTrackLocked: true }, 'b', 'move', 1)).toThrow('锁定')
  expect(sequence.captions[1]).toMatchObject({ start: 40, duration: 20 })
})

it('按住 Ctrl/Alt 修剪：半秒内的邻句跟着走、在拖到处接上，各留一帧；没有挨着的邻句就是普通修剪', () => {
  const base = createVideoEditSequence(); const half = Math.round(videoEditFps(base.frameRate) / 2)
  const sequence = { ...base, captions: [
    { id: 'a', start: 10, duration: 20, text: '前句' },
    { id: 'b', start: 30 + half, duration: 20, text: '当前句' },
    { id: 'c', start: 51 + 2 * half, duration: 20, text: '远处一句' },
  ] }
  const b = sequence.captions[1]
  expect(rollVideoEditCaptions(sequence, 'b', 'in', -3)).toEqual([{ ...sequence.captions[0], duration: b.start - 3 - 10 }, { ...b, start: b.start - 3, duration: b.duration + 3 }])
  expect(rollVideoEditCaptions(sequence, 'a', 'out', 1000)).toEqual([{ ...sequence.captions[0], duration: b.start + b.duration - 1 - 10 }, { ...b, start: b.start + b.duration - 1, duration: 1 }])
  expect(rollVideoEditCaptions(sequence, 'b', 'out', 5)).toEqual([{ ...b, duration: b.duration + 5 }])
})
