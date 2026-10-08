import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { sceneCutsSchema } from './sceneDetection'
import { videoEditAudioSyncSize } from './multicamSync'
import { expect, it } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence, videoEditDocumentSchema } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { insertVideoEditTracks } from './tracks'
import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, VIDEO_EDIT_FRAME_RATES, videoEditFps } from './time'
import { videoEditTimelineViewSchema } from './timelineSelection'

it('接受1200个素材和素材项、400个素材箱、64个序列及超过500个片段和标记', () => {
  const document = createVideoEditDocument('大型工程')
  document.bins = Array.from({ length: 400 }, (_, index) => ({ id: `bin${index}`, name: `素材箱${index}` }))
  document.media = Array.from({ length: 1200 }, (_, index) => ({ id: `media${index}`, name: `照片${index}`, kind: 'image' as const, path: `/images/${index}.png`, width: 16, height: 16, durationSeconds: 0 }))
  document.items = document.media.map((media, index) => ({ id: `item${index}`, name: media.name, kind: media.kind, mediaId: media.id, binId: document.bins[index % 400].id }))
  document.lumetriLuts = Array.from({ length: 300 }, (_, index) => ({ id: `lut${index}`, name: `LUT${index}`, path: `/luts/${index}.cube`, contentIdentity: 'a'.repeat(64) }))
  document.codeMaterials = Array.from({ length: 100 }, (_, index) => ({ id: `definition${index}`, name: '代码', defaultVersionId: `version${index}`, versions: [{ id: `version${index}`, apiVersion: 1, languageVersion: 1, ...testCodeManifest('', document) }] }))
  expect(sceneCutsSchema.safeParse(Array.from({ length: 1200 }, (_, index) => index)).success).toBe(true)
  document.sequences = Array.from({ length: 64 }, () => createVideoEditSequence())
  const sequence = document.sequences[0]
  const clip = makeVideoEditItemClip(document, document.items[0].id, sequence.id, { frame: 0, duration: 1 })
  sequence.clips = Array.from({ length: 1200 }, (_, index) => ({ ...clip, id: `clip${index}`, itemId: document.items[index].id, start: index }))
  sequence.transitions = sequence.clips.slice(1).map((clip, index) => ({ id: `transition${index}`, kind: 'cross_dissolve', leftClipId: sequence.clips[index].id, rightClipId: clip.id, durationFrames: 2, alignment: 'start' }))
  // A transition needs room inside both pictures. Use separate 10-frame clips.
  sequence.clips = sequence.clips.map((clip, index) => ({ ...clip, start: index * 10, duration: 10 }))
  sequence.markers = sequence.clips.map((clip, index) => ({ id: `marker${index}`, frame: clip.start, name: '标记' }))
  expect(videoEditDocumentSchema.safeParse(document).success).toBe(true)
})

it.each(VIDEO_EDIT_FRAME_RATES)('序列边界在 $numerator/$denominator fps 下接受24小时、拒绝再多一帧', rate => {
  const document = createVideoEditDocument('长片'); const sequence = createVideoEditSequence(); sequence.frameRate = rate; document.sequences = [sequence]
  document.items = [{ id: 'text', name: '标题', kind: 'text' }]
  const limit = Math.floor(videoEditFps(rate) * VIDEO_EDIT_MAX_SEQUENCE_SECONDS)
  sequence.clips = [makeVideoEditItemClip(document, 'text', sequence.id, { frame: limit - 1, duration: 1 })]
  expect(videoEditDocumentSchema.safeParse(document).success).toBe(true)
  sequence.clips[0].duration++
  expect(videoEditDocumentSchema.safeParse(document).success).toBe(false)
})

it('轨道不是固定32槽，选区支持千项和高于32的目标轨道', () => {
  const sequence = createVideoEditSequence()
  const expanded = insertVideoEditTracks(sequence, 'video', 1000, 1).sequence
  expect(expanded.tracks).toHaveLength(1002)
  const document = createVideoEditDocument('多轨'); document.sequences = [expanded]
  expect(videoEditDocumentSchema.safeParse(document).success).toBe(true)
  expect(videoEditTimelineViewSchema.safeParse({ selectedClipIds: Array.from({ length: 1200 }, (_, index) => `clip${index}`), targetTrackIds: expanded.tracks.map(track => track.id), tool: 'select', snapping: true, zoom: 1, inFrame: 0, outFrame: 120 * VIDEO_EDIT_MAX_SEQUENCE_SECONDS, linkedSelection: true }).success).toBe(true)
})

it('长声音共同同步在分配FFT前按实际工作缓冲预算拒绝，并保持普通长度可用', () => {
  expect(videoEditAudioSyncSize(2_000_000, 2_000_000)).toBe(4_194_304)
  expect(() => videoEditAudioSyncSize(86_400_000, 86_400_000)).toThrow('内存')
  expect(() => videoEditAudioSyncSize(NaN, 1)).toThrow('样本')
})
