import { expect, it } from 'vitest'
import { collectVideoEditPixelMotion, videoEditPixelMotionSamples } from './pixelMotionReview'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'
import { VideoEditSourceMapIndex } from './sourceMap'
import type { VideoMotionScan } from '../media/motionEvidence'

function scan(): VideoMotionScan {
  return { startSeconds: 0, endSeconds: 10, samplingFps: 15, width: 320, height: 180, sampledFrames: 150,
    samples: Array.from({ length: 150 }, (_, i) => ({ fromSeconds: i / 15, toSeconds: (i + 1) / 15, speed: i < 30 ? 10 : 0, zoom: i < 30 ? 4 : 0, change: 0, cut: false, still: i >= 30 })) }
}
function fixture() {
  const document = createVideoEditDocument('像素审查'), sequence = createVideoEditSequence('主'); sequence.id = 'root'; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  document.media = [{ id: 'media', name: '原片', kind: 'video', path: '/pixel.mp4', width: 320, height: 180, durationSeconds: 10 }]
  document.items = [{ id: 'item', name: '原片', kind: 'video', mediaId: 'media' }]
  const clip: VideoEditClip = { id: 'clip', itemId: 'item', name: '原片', kind: 'video', track: 1, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
  sequence.clips = [clip]
  const entries = () => new VideoEditSourceMapIndex().query(videoEditComposition(document, 'root'), { from: 0, to: 240 }, ['video'])
  return { document, sequence, clip, entries }
}
it('recomputes source motion and stillness on the placed playback clock and retains source evidence', () => {
  const { entries } = fixture(), entry = entries()[0]
  const result = collectVideoEditPixelMotion([{ entry, scan: scan() }], 30, {})
  expect(result).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'motion', basis: 'video_pixels', timeline: { from: 1, to: 61 }, peakSpeed: expect.closeTo(10, 6) }),
    expect.objectContaining({ kind: 'motion_hard_stop' }), expect.objectContaining({ kind: 'pixel_still', source: expect.any(Object) }),
  ]))
})
it('speed and reversal scale velocities and reverse zoom without carrying a forward hard stop into backward playback', () => {
  const { clip, entries } = fixture(); clip.speed = { numerator: 2, denominator: 1 }; clip.sourceInUs = 4000000; clip.reverse = true
  const entry = entries()[0], samples = videoEditPixelMotionSamples(entry, scan(), 30)
  expect(samples.filter(value => value.speed !== null && value.speed > 0).every(value => Math.abs(value.speed! - 20) < 1e-6)).toBe(true)
  expect(samples.filter(value => value.zoom !== null && value.zoom < 0).every(value => Math.abs(value.zoom! + 8) < 1e-6)).toBe(true)
  const result = collectVideoEditPixelMotion([{ entry, scan: scan() }], 30, {})
  expect(result.some(record => record.kind === 'motion_hard_stop')).toBe(false)
})
it('nested mixed-rate repeated frames preserve continuous movement, and distinct placements retain their own paths', () => {
  const { document, clip, sequence, entries } = fixture(), child = createVideoEditSequence('子'); child.id = 'child'; child.frameRate = { numerator: 15, denominator: 1 }; addLegacyVideoEditTracks(child)
  child.clips = [clip]; document.sequences.push(child); document.items.push({ id: 'nested', name: '嵌套', kind: 'sequence', sequenceId: child.id })
  const wrapper: VideoEditClip = { ...clip, id: 'wrapper', kind: 'sequence', itemId: 'nested', duration: 60 }
  sequence.clips = [wrapper, { ...wrapper, id: 'again', start: 90 }]
  const mapped = entries(), samples = videoEditPixelMotionSamples(mapped[0], scan(), 30)
  expect(samples.filter(value => value.speed !== null).every(value => Math.abs(value.speed! - 10) < 1e-6)).toBe(true)
  const records = collectVideoEditPixelMotion(mapped.map(entry => ({ entry, scan: scan() })), 30, {})
  expect(new Set(records.map(record => record.path[0].clipId))).toEqual(new Set(['wrapper', 'again']))
  expect(records.filter(record => record.kind === 'motion')).toHaveLength(2)
  expect(records.some(record => record.kind === 'motion_hard_stop')).toBe(false)
})
it('keeps local-change evidence when flow is unknown, without inventing motion or stillness', () => {
  const { entries } = fixture(), unknown = scan()
  unknown.samples = unknown.samples.map(value => ({ ...value, speed: null, zoom: null, still: null, change: value.fromSeconds >= 1 && value.fromSeconds < 1.2 ? .2 : 0 }))
  const records = collectVideoEditPixelMotion([{ entry: entries()[0], scan: unknown }], 30, {})
  expect(records.some(record => record.kind === 'pixel_change')).toBe(true)
  expect(records.some(record => record.kind === 'pixel_unknown')).toBe(true)
  expect(records.some(record => record.kind === 'motion' || record.kind === 'pixel_still')).toBe(false)
})
it('preserves sampled cut candidates and rejects corrupt clocks or an oversized placed range', () => {
  const { entries } = fixture(), entry = entries()[0], value = scan(); value.samples[15].cut = true
  expect(collectVideoEditPixelMotion([{ entry, scan: value }], 30, {}).some(record => record.kind === 'pixel_cut')).toBe(true)
  value.samples[4].fromSeconds += .01
  expect(() => collectVideoEditPixelMotion([{ entry, scan: value }], 30, {})).toThrow('时钟')
  expect(() => collectVideoEditPixelMotion([{ entry: { ...entry, timeline: { from: 0, to: 60001 } }, scan: scan() }], 30, {})).toThrow('60000')
  expect(() => videoEditPixelMotionSamples(entry, scan(), 30, { remaining: 0 })).toThrow('200000')
})
