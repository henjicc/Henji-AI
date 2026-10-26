import path from 'node:path'
import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import { codeMediaInputComposition } from './codeMediaInput'
import { videoEditCodeInputMotionPlacements } from './codeInputMotion'
import { videoEditSourceMapLocalFrame, visitVideoEditPictureInstances } from './sourceMap'
import { collectVideoEditPixelMotion } from './pixelMotionReview'
import { videoEditCrowdedReviewEvents, type VideoEditReviewRecord } from './review'
import type { VideoMotionScan } from '../media/motionEvidence'
import { videoEditClipToFrame } from './clipGeometry'

function fixture() {
  const document = createVideoEditDocument('输入审查'), sequence = createVideoEditSequence('主'); sequence.id = 'root'; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  document.media = [{ id: 'raw', name: '未放置原片', kind: 'video', path: path.resolve(path.sep, 'input.mp4'), width: 320, height: 180, durationSeconds: 10 }]
  document.items = [{ id: 'raw-item', name: '原片', kind: 'video', mediaId: 'raw' }]
  const clip: VideoEditClip = { id: 'code', itemId: 'code-item', name: '代码', kind: 'code', track: 3, start: 0, duration: 120, sourceInUs: 1000000, sourceRemainder: { numerator: 0, denominator: 1 }, speed: { numerator: 2, denominator: 1 }, reverse: true, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', code: { definitionId: 'd', versionId: 'v', parameters: { picture: { kind: 'video', mediaId: 'raw' } } } }
  sequence.clips = [clip]
  return { document, sequence, clip, composition: () => videoEditComposition(document, sequence.id) }
}
it('finds an unplaced input and follows the clip in-point at the producer playback clock, independently of author speed and reverse', () => {
  const { clip, composition } = fixture(), local = composition()
  const [input] = videoEditCodeInputMotionPlacements(local, { from: 0, to: 120 })
  expect(input.input).toEqual({ parameter: 'picture', kind: 'video', mediaId: 'raw' })
  expect(input.entry.path.map(step => step.clipId)).toEqual(['code'])
  expect(input.sourceTimes).toHaveLength(120)
  for (let frame = 0; frame < 120; frame++) {
    const rendered = codeMediaInputComposition(local, clip, { kind: 'video', mediaId: 'raw' }, frame).document.clips[0]
    expect(input.sourceTimes![frame]).toBeCloseTo((rendered.sourceInUs + rendered.sourceRemainder.numerator / rendered.sourceRemainder.denominator) / 1e6, 10)
  }
  // 裁掉的开头（入点 1 秒）算进视频时间；2 倍速与倒放不换算视频
  expect(input.sourceTimes![0]).toBeCloseTo(1, 10); expect(input.sourceTimes![30]).toBeCloseTo(1 + 30 * local.frameRate.denominator / local.frameRate.numerator, 10)
})
it.each([undefined, .5])('video input fills its source canvas without a half-frame offset, fixed time=%s', time => {
  const { clip, composition } = fixture()
  const input = codeMediaInputComposition(composition(), clip, { kind: 'video', mediaId: 'raw', ...(time === undefined ? {} : { time }) }, 30).document
  expect(videoEditClipToFrame(input.clips[0], input, input, 0, 0)).toEqual({ x: 0, y: 0 })
  expect(videoEditClipToFrame(input.clips[0], input, input, 1, 1)).toEqual({ x: 1, y: 1 })
})
it.each([false, true])('nested mixed-rate %s placements retain both paths and use the same exact local clock as rendering', reverse => {
  const { document, sequence, clip, composition } = fixture(), child = createVideoEditSequence('子'); child.id = 'child'; child.frameRate = { numerator: 60, denominator: 1 }; addLegacyVideoEditTracks(child)
  child.clips = [{ ...clip, duration: 240 }]; document.sequences.push(child); document.items.push({ id: 'nested', kind: 'sequence', name: '子', sequenceId: child.id })
  const wrapper = { ...clip, id: 'wrapper', code: undefined, kind: 'sequence' as const, itemId: 'nested', sourceInUs: 0, duration: 30, reverse: reverse || undefined }
  sequence.clips = [wrapper, { ...wrapper, id: 'again', start: 60 }]
  const root = composition(), inputs = videoEditCodeInputMotionPlacements(root, { from: 0, to: 90 })
  expect(inputs.map(input => input.entry.path.map(step => step.clipId))).toEqual([['wrapper', 'code'], ['again', 'code']])
  visitVideoEditPictureInstances(root, { from: 0, to: 90 }, { sequence() {}, clip(local, entry) {
    if (entry.kind !== 'code') return
    const input = inputs.find(input => input.entry.path[0].clipId === entry.path[0].clipId)!
    for (let frame = entry.timeline.from; frame < entry.timeline.to; frame++) {
      const rendered = codeMediaInputComposition(local, entry.path.at(-1)!.clip, { kind: 'video', mediaId: 'raw' }, videoEditSourceMapLocalFrame(entry, frame))
      expect(input.sourceTimes![frame - entry.timeline.from]).toBeCloseTo(rendered.document.clips[0].sourceInUs / 1e6, 5)
    }
  } })
})
it('lower input keeps partial placed source clocks and excludes upper or disabled tracks without claiming final compositing', () => {
  const { clip, sequence, composition } = fixture()
  clip.code!.parameters.picture = { kind: 'sequence', mediaId: 'below' }
  const lower = { ...clip, id: 'lower', code: undefined, kind: 'video' as const, itemId: 'raw-item', track: 1, start: 30, duration: 60, sourceInUs: 2000000, speed: undefined, reverse: undefined }
  sequence.clips.push(lower, { ...lower, id: 'upper', track: 4 })
  const [input] = videoEditCodeInputMotionPlacements(composition(), { from: 0, to: 120 })
  expect(input.entry.timeline).toEqual({ from: 30, to: 90 })
  expect(input.input?.kind).toBe('sequence'); expect(input.entry.path.at(-1)!.clipId).toBe('code')
  expect(input.sourceTimes![0]).toBe(2); expect(input.sourceTimes!.at(-1)).toBeCloseTo(2 + 59 / 30)
  sequence.tracks.find(track => track.index === 1)!.enabled = false
  expect(videoEditCodeInputMotionPlacements(composition(), { from: 0, to: 120 })).toEqual([])
})
it('fixed input remains the same source frame and does not inherit raw movement or invent a hard stop', () => {
  const { clip, composition } = fixture(); clip.code!.parameters.picture = { kind: 'video', mediaId: 'raw', time: .5 }
  const [input] = videoEditCodeInputMotionPlacements(composition(), { from: 0, to: 120 })
  expect(new Set(input.sourceTimes)).toEqual(new Set([.5]))
  const scan: VideoMotionScan = { startSeconds: 0, endSeconds: 10, samplingFps: 15, width: 320, height: 180, sampledFrames: 150, samples: Array.from({ length: 150 }, (_, i) => ({ fromSeconds: i / 15, toSeconds: (i + 1) / 15, speed: 20, zoom: 0, cut: false, change: .2, still: false })) }
  const records = collectVideoEditPixelMotion([{ ...input, scan }], 30, {})
  expect(records.some(record => record.kind === 'pixel_still' && record.basis === 'code_input_pixels')).toBe(true)
  expect(records.some(record => ['motion', 'motion_hard_stop', 'pixel_change'].includes(record.kind))).toBe(false)
  expect(records.every(record => record.detail?.includes('不证明代码实际绘制或最终可见'))).toBe(true)
  expect(() => collectVideoEditPixelMotion([{ ...input, sourceTimes: [.5], scan }], 30, {})).toThrow('采样时钟无效')
})
it('rejects out-of-range producer input and excessive frame instances instead of clamping or truncating evidence', () => {
  const { clip, document, composition } = fixture()
  clip.code!.parameters.picture = { kind: 'video', mediaId: 'raw', time: 10 }
  expect(() => videoEditCodeInputMotionPlacements(composition(), { from: 0, to: 120 })).toThrow('超出素材范围')
  clip.code!.parameters.picture = { kind: 'video', mediaId: 'raw' }; clip.duration = 60001; document.media[0].durationSeconds = 3000
  expect(() => videoEditCodeInputMotionPlacements(composition(), { from: 0, to: 60001 })).toThrow('60000')
})
it('bounds sparse lower-track mapping work even when very few source frames contribute', () => {
  const { clip, sequence, composition } = fixture()
  clip.code!.parameters.picture = { kind: 'sequence', mediaId: 'below' }; clip.duration = 60000
  sequence.clips.push(...Array.from({ length: 8 }, (_, i) => ({ ...clip, code: undefined, id: `lower-${i}`, kind: 'video' as const, itemId: 'raw-item', track: 1, start: i, duration: 1, sourceInUs: 0, speed: undefined, reverse: undefined })))
  expect(() => videoEditCodeInputMotionPlacements(composition(), { from: 0, to: 60000 })).toThrow('200000次访问预算')
})
it('raw input candidates do not count as extra attention events even when their source changes', () => {
  const record: VideoEditReviewRecord = { kind: 'motion', timeline: { from: 0, to: 1 }, sequenceId: 'root', path: [], subjectId: 'code', motionEvidence: { basis: 'clip_transform', suggestion: '观察' } }
  const base = [record, { ...record, timeline: { from: 30, to: 31 } }]
  const candidate: VideoEditReviewRecord = { ...record, timeline: { from: 15, to: 16 }, motionEvidence: { basis: 'code_input_pixels', suggestion: '源候选' } }
  expect(videoEditCrowdedReviewEvents([...base, candidate], 30, 2)).toEqual(videoEditCrowdedReviewEvents(base, 30, 2))
})
it.each([false, true])('网页重演录屏作为代码素材的视频参数时按录制光标重画鼠标；画面里已有鼠标（%s）时不重画', baked => {
  const { clip, composition } = fixture(), local = composition()
  local.media[0] = { ...local.media[0], recordingCursor: { cursorBakedIn: baked } as never }
  const input = codeMediaInputComposition(local, clip, { kind: 'video', mediaId: 'raw' }, 0).document.clips[0]
  expect(input.effects?.map(effect => effect.builtin?.id) ?? []).toEqual(baked ? [] : ['recording_cursor'])
})
