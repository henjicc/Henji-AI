import { expect, it } from 'vitest'
import { collectVideoEditTextSafety, videoEditTextInkBox } from './textSafetyReview'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'

/** Deterministic glyph advance: every character is 40 output pixels wide. */
const measure = (text: string): number => text.length * 40
function fixture() {
  const document = createVideoEditDocument('安全框'), sequence = createVideoEditSequence('主')
  sequence.id = 'root'; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  const text = (id: string, value: string, x: number, extra: Partial<VideoEditClip> = {}): VideoEditClip => ({ id, itemId: '', name: id, kind: 'text', track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: value, ...extra })
  return { document, sequence, text }
}

it('measures the aligned ink box, not the whole frame-sized text picture', () => {
  const box = videoEditTextInkBox({ text: '十个字的标题文字内容' }, { width: 1920, height: 1080 }, measure)!
  expect(box.width).toBeCloseTo(400); expect(box.left).toBeCloseTo(760)
})
it('flags a settled native title pushed past the left title-safe line and leaves centred titles alone', () => {
  const { document, sequence, text } = fixture()
  sequence.clips = [text('左标题', '十个字的标题文字内容', -.4, { track: 1 }), text('中标题', '居中标题', 0, { track: 2 })]
  const facts = collectVideoEditTextSafety(videoEditComposition(document, 'root'), { from: 0, to: 60 }, measure)
  expect(facts).toEqual([expect.objectContaining({ kind: 'safe_area', subjectId: '左标题', basis: 'text_layout', timeline: { from: 0, to: 60 }, safeArea: { zone: 'title', edges: ['left'], overflowPercent: expect.closeTo(5.4, 1) } })])
  expect(facts[0].detail).toContain('“左标题”')
})
it('animated native titles are judged only while settled', () => {
  const { document, sequence, text } = fixture()
  sequence.clips = [text('飞入', '十个字的标题文字内容', 0, { curves: { x: [{ time: 0, value: -1, interpolation: 'linear' }, { time: 20, value: 0, interpolation: 'linear' }] } })]
  expect(collectVideoEditTextSafety(videoEditComposition(document, 'root'), { from: 0, to: 60 }, measure)).toEqual([])
})
it('reports captions that run past the title-safe frame with a caption reference', () => {
  const { document, sequence } = fixture()
  sequence.captions = [{ id: 'long', start: 10, duration: 40, text: '这是一句非常非常长的字幕，长到一行放不下，左右两边都会超出标题安全框的范围，需要换行或者缩小'.repeat(2) }, { id: 'short', start: 50, duration: 10, text: '短字幕' }]
  const facts = collectVideoEditTextSafety(videoEditComposition(document, 'root'), { from: 0, to: 60 }, measure)
  expect(facts).toEqual([expect.objectContaining({ kind: 'safe_area', subjectId: 'long', subjectType: 'video_edit.caption', timeline: { from: 10, to: 50 }, safeArea: expect.objectContaining({ zone: 'title', edges: ['left', 'right'] }) })])
  expect(facts[0].detail).toContain('字幕')
})
