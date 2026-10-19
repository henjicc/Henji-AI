import { expect, it } from 'vitest'
import { collectVideoEditMotionStructure } from './motionStructure'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import { videoEditCrowdedReviewEvents, type VideoEditReviewRecord } from './review'

function fixture() {
  const document = createVideoEditDocument('运动复核'), sequence = createVideoEditSequence('主')
  sequence.id = 'root'; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  document.media = [{ id: 'media', kind: 'video', name: '画面', path: '/motion.mp4', width: 1920, height: 1080, durationSeconds: 3600 }]
  document.items = [{ id: 'item', kind: 'video', name: '画面', mediaId: 'media' }]
  const clip: VideoEditClip = { id: 'move', name: '移动', kind: 'video', itemId: 'item', track: 1, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', curves: { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 30, value: .5, interpolation: 'linear' }] } }
  sequence.clips = [clip]
  return { document, sequence, clip }
}
it('native transform evaluator finds a move, actual hard stop and transform hold without claiming the source video is still', () => {
  const { document } = fixture(), root = videoEditComposition(document, 'root')
  const result = collectVideoEditMotionStructure(root, { from: 0, to: 120 })
  expect(result).toMatchObject({ sampledFrames: 120, sampledInstances: 1 })
  expect(result.records).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'motion', timeline: { from: 1, to: 31 }, peakSpeed: expect.closeTo(50, 5) }),
    expect.objectContaining({ kind: 'motion_hard_stop', timeline: { from: 30, to: 32 } }),
    expect.objectContaining({ kind: 'motion_hold', timeline: { from: 31, to: 120 } }),
  ]))
  expect(result.records.every(record => record.subjectId === 'move' && record.path[0].clipId === 'move')).toBe(true)
  expect(result.records.some(record => record.kind === ('still' as string))).toBe(false)
  expect(collectVideoEditMotionStructure(root, { from: 0, to: 25 }).records.some(record => record.kind === 'motion_hard_stop')).toBe(false)
})
it('slow carrying movement, disabled intrinsic motion and hidden tracks do not become hard-stop or crowding failures', () => {
  const { document, clip, sequence } = fixture()
  clip.curves!.x![1] = { time: 119, value: .01, interpolation: 'linear' }
  expect(collectVideoEditMotionStructure(videoEditComposition(document, 'root'), { from: 0, to: 120 }).records).toEqual([])
  clip.disabledIntrinsicSections = ['motion']
  expect(collectVideoEditMotionStructure(videoEditComposition(document, 'root'), { from: 0, to: 120 }).sampledFrames).toBe(0)
  delete clip.disabledIntrinsicSections; sequence.tracks.find(track => track.index === 1)!.enabled = false
  expect(collectVideoEditMotionStructure(videoEditComposition(document, 'root'), { from: 0, to: 120 }).records).toEqual([])
})
it.each([false, true])('nested mixed-rate speed and reverse use the existing quantized placed clock, reverse=%s', reverse => {
  const { document, clip } = fixture()
  const child = createVideoEditSequence('子'); child.id = 'child'; child.frameRate = { numerator: 60, denominator: 1 }; addLegacyVideoEditTracks(child)
  child.clips = [clip]; clip.duration = 180
  document.sequences.push(child)
  document.items.push({ id: 'nested', kind: 'sequence', name: '子序列', sequenceId: child.id })
  const wrapper: VideoEditClip = { ...clip, id: 'wrapper', kind: 'sequence', itemId: 'nested', curves: undefined, duration: 60, speed: { numerator: 2, denominator: 1 }, ...(reverse ? { reverse: true as const, sourceInUs: 2000000 } : {}) }
  document.sequences[0].clips = [wrapper, { ...wrapper, id: 'again', start: 90 }]
  const result = collectVideoEditMotionStructure(videoEditComposition(document, 'root'), { from: 0, to: 150 })
  const moves = result.records.filter(record => record.kind === 'motion')
  expect(moves).toHaveLength(2)
  expect(moves[1].timeline.from - moves[0].timeline.from).toBe(90)
  expect(moves[1].timeline.to - moves[0].timeline.to).toBe(90)
  expect(moves.map(record => record.path.map(step => step.clipId))).toEqual([['wrapper', 'move'], ['again', 'move']])
  expect(moves.every(record => Math.abs(record.peakSpeed! - 200) < .0001)).toBe(true)
})
it('sampling budget rejects the full query rather than silently dropping later placed instances', () => {
  const { document, clip, sequence } = fixture(); clip.duration = 60001
  expect(() => collectVideoEditMotionStructure(videoEditComposition(document, 'root'), { from: 0, to: 60001 })).toThrow('60000帧实例预算')
  sequence.clips = [{ ...clip, curves: undefined }]
  expect(collectVideoEditMotionStructure(videoEditComposition(document, 'root'), { from: 0, to: 60001 }).sampledFrames).toBe(0)
})
it('a one-frame hold jump remains a motion candidate even though it is too short for the camera-move duration filter', () => {
  const { document, clip } = fixture()
  clip.curves = { x: [{ time: 0, value: 0, interpolation: 'hold' }, { time: 30, value: .5, interpolation: 'hold' }] }
  const result = collectVideoEditMotionStructure(videoEditComposition(document, 'root'), { from: 0, to: 120 })
  expect(result.records.some(record => record.kind === 'motion' && record.timeline.from <= 30 && record.timeline.to > 30)).toBe(true)
  expect(result.records.some(record => record.kind === 'motion_hard_stop')).toBe(false)
})
it('one entrance and one shared cut do not inflate density; captions and independent placed elements remain separate', () => {
  const { clip } = fixture()
  const record = (kind: VideoEditReviewRecord['kind'], frame: number, id: string): VideoEditReviewRecord => ({ kind, sequenceId: 'root', subjectId: id, timeline: { from: frame, to: frame }, path: [{ sequenceId: 'root', clipId: id, itemId: 'item', track: 1, fps: 30, clip }] })
  const events = [record('clip_boundary', 0, 'a'), record('motion', 1, 'a'), record('effect', 2, 'a'), record('clip_boundary', 30, 'a'), record('clip_boundary', 30, 'b'), record('motion', 31, 'b')]
  expect(videoEditCrowdedReviewEvents(events, 30, .8)).toEqual([])
  const more = [...events, record('caption', 5, 'caption'), record('motion_hold', 4, 'a'), record('tracking_lost', 7, 'a')]
  expect(videoEditCrowdedReviewEvents(more, 30, .8)).toEqual([{ from: 0, to: 6, gapSeconds: 5 / 30 }])
  expect(videoEditCrowdedReviewEvents([record('motion', 0, 'a'), record('motion', 0, 'b')], 30, 1.5)).toHaveLength(1)
})
