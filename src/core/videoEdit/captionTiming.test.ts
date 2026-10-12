import { expect, it } from 'vitest'
import { createVideoEditSequence } from './document'
import { retimeVideoEditCaption } from './captionTiming'

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
