import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, type VideoEditClip } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { videoEditSequenceTrackingSource, videoEditTrackingSequenceFrame } from './trackingSource'
import { videoEditClipSourceSecondsAt } from './clipSpeed'

function fixture() {
  const document = createVideoEditDocument('跟踪')
  const child = createVideoEditSequence('子序列'); child.frameRate = { numerator: 60, denominator: 1 }
  document.sequences.push(child)
  document.items.push({ id: 'nested', kind: 'sequence', name: '子序列', sequenceId: child.id })
  const clip: VideoEditClip = { ...makeVideoEditItemClip(document, 'nested', document.sequences[0].id, { frame: 30 }), id: 'nest', duration: 30, sourceInUs: 2e6, speed: { numerator: 2, denominator: 1 } }
  document.sequences[0].clips.push(clip)
  return { document, child, clip }
}
it('父层变速/倒放的源时钟换到子网格，60fps子序列按30fps跟踪采样', () => {
  const { document, clip } = fixture(); const { source } = videoEditSequenceTrackingSource(document, clip)!
  const seconds = videoEditClipSourceSecondsAt(clip, 45, 30)
  expect(seconds).toBe(3)
  expect(videoEditTrackingSequenceFrame(source, Math.round(seconds * 30), 30)).toBe(180)
  const reverse = { ...clip, reverse: true, sourceInUs: 4e6 }
  expect(videoEditClipSourceSecondsAt(reverse, 45, 30)).toBeCloseTo(4 - 32 / 30)
  expect(videoEditTrackingSequenceFrame(source, 91, 30)).toBe(182)
  expect(videoEditTrackingSequenceFrame({ ...source, fps: 60000 / 1001 }, 1, 30)).toBe(1)
  expect(videoEditTrackingSequenceFrame({ ...source, fps: 60000 / 1001 }, 30, 30)).toBe(59)
})
it('内容签名不受父层速度/跟踪/revision与无关序列影响；子字幕、画幅及递归内容改变失效', () => {
  const { document, clip, child } = fixture()
  const signature = (): string => videoEditSequenceTrackingSource(document, clip)!.source.signature
  const first = signature()
  document.revision++; clip.speed = { numerator: 1, denominator: 2 }; clip.reverse = true
  document.sequences.push(createVideoEditSequence('无关'))
  clip.trackers = [{ id: 'tracker', name: '跟踪', method: 'box', prompts: [{ timeUs: 0, box: [.1, .1, .2, .2] }] }]
  expect(signature()).toBe(first)
  child.width += 2; expect(signature()).not.toBe(first); child.width -= 2
  child.captions = [{ id: 'caption', text: '改变画面', start: 0, duration: 30 }]
  expect(signature()).not.toBe(first); child.captions = []
  const grand = createVideoEditSequence('孙序列'); document.sequences.push(grand)
  document.items.push({ id: 'grand', kind: 'sequence', name: '孙序列', sequenceId: grand.id })
  child.clips.push({ ...clip, id: 'grand-clip', itemId: 'grand', trackers: undefined })
  const nested = signature(); grand.height += 2; expect(signature()).not.toBe(nested)
})
it('合成中代码图片引用的素材内容身份变化也使缓存失效', () => {
  const { document, child, clip } = fixture()
  document.media.push({ id: 'picture', name: '图片', path: 'D:/picture.png', kind: 'image', durationSeconds: 0, width: 64, height: 64, sourceRevision: 'one' })
  child.clips.push({ ...clip, id: 'code', kind: 'code', code: { definitionId: 'code', versionId: 'v1', parameters: { picture: { kind: 'image', mediaId: 'picture' } } } })
  const first = videoEditSequenceTrackingSource(document, clip)!.source.signature
  document.media[0].sourceRevision = 'two'
  expect(videoEditSequenceTrackingSource(document, clip)!.source.signature).not.toBe(first)
})
