import { expect, it } from 'vitest'
import { createVideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { TIMELINE_RULER_HEIGHT, TIMELINE_TRACK_SECTION_GAP, timelineArmedEdgeVelocity, timelineEdgeAxis, timelineInitialScrollTop, timelineTrackAt, timelineTrackDivider, timelineTrackRows, timelineVisibleClips } from './timelineGeometry'

function fixture(): VideoEditSequence {
  const document = createVideoEditDocument('轨道几何')
  const sequence = document.sequences[0]
  const base = sequence.tracks[1]
  sequence.tracks = [
    { ...base, id: 'audio-2', index: 2, kind: 'audio', height: 32 },
    { ...base, id: 'video-1', index: 1, height: 48 },
    { ...base, id: 'video-4', index: 4, height: 40 },
    { ...base, id: 'audio-0', index: 0, kind: 'audio', height: 24 },
    { ...base, id: 'video-3', index: 3, height: 160 },
  ]
  document.media = [{ id: 'media', name: '视频', kind: 'video', path: 'D:/fixture/video.mp4', width: 64, height: 64, durationSeconds: 5 }, { id: 'audio', name: '声音', kind: 'audio', path: 'D:/fixture/audio.wav', width: 0, height: 0, durationSeconds: 5 }]
  document.items = [{ id: 'item', name: '视频', kind: 'video', mediaId: 'media' }, { id: 'audio-item', name: '声音', kind: 'audio', mediaId: 'audio' }]
  sequence.clips = sequence.tracks.map(track => ({ ...makeVideoEditItemClip(document, track.kind === 'audio' ? 'audio-item' : 'item', sequence.id, { frame: 0, track: track.index }), id: `clip-${track.index}` }))
  return sequence
}

it('角色交错时画面按叠加层级逆序，声音始终在下方且按原编号升序', () => {
  const sequence = fixture()
  const original = sequence.tracks.slice()
  const rows = timelineTrackRows(sequence)
  expect(rows.map(row => row.track.index)).toEqual([4, 3, 1, 0, 2])
  expect(rows.map(row => [row.top, row.height])).toEqual([[28, 40], [68, 160], [228, 48], [284, 24], [308, 32]])
  expect(sequence.tracks).toEqual(original)
  for (const row of rows) expect(row.track).toBe(original.find(track => track.id === row.track.id))
  expect(timelineTrackDivider(rows)).toBe(280)
})

it('逆序高度和当前高度草稿统一影响后续画面、分界与声音行坐标', () => {
  const sequence = fixture()
  const rows = timelineTrackRows(sequence, { trackId: 'video-3', height: 24 })
  expect(rows.map(row => [row.track.index, row.top, row.height])).toEqual([[4, 28, 40], [3, 68, 24], [1, 92, 48], [0, 148, 24], [2, 172, 32]])
  expect(sequence.tracks.find(track => track.id === 'video-3')!.height).toBe(160)
  expect(timelineTrackDivider(rows)).toBe(144)
})

it('轨道命中采用半开边界，标尺和音画分界间隙不伪装成轨道', () => {
  const rows = timelineTrackRows(fixture())
  expect(timelineTrackAt(rows, TIMELINE_RULER_HEIGHT - 1)).toBeUndefined()
  expect(timelineTrackAt(rows, 28)?.track.index).toBe(4)
  expect(timelineTrackAt(rows, 67.999)?.track.index).toBe(4)
  expect(timelineTrackAt(rows, 68)?.track.index).toBe(3)
  expect(timelineTrackAt(rows, 276)).toBeUndefined()
  expect(timelineTrackAt(rows, 276 + TIMELINE_TRACK_SECTION_GAP - 0.001)).toBeUndefined()
  expect(timelineTrackAt(rows, 284)?.track.index).toBe(0)
  expect(timelineTrackAt(rows, 308)?.track.index).toBe(2)
  expect(timelineTrackAt(rows, 340)).toBeUndefined()
})

it('纵向可见片段沿同一半开坐标裁剪，不把分界或邻接轨道算入视口', () => {
  const sequence = fixture()
  const rows = timelineTrackRows(sequence)
  expect(timelineVisibleClips(sequence.clips, rows, { left: 0, top: 276, width: 900, height: 8 }, 2)).toEqual([])
  expect(timelineVisibleClips(sequence.clips, rows, { left: 0, top: 284, width: 900, height: 24 }, 2).map(clip => clip.track)).toEqual([0])
  expect(timelineVisibleClips(sequence.clips, rows, { left: 0, top: 68, width: 900, height: 160 }, 2).map(clip => clip.track)).toEqual([3])
})

it('初次混合32轨道定位分界，既见底层画面也见首批声音；单类或足够高度不造分区', () => {
  const sequence = fixture()
  const base = sequence.tracks[1]
  sequence.tracks = Array.from({ length: 32 }, (_, index) => ({ ...base, id: `track-${index}`, index, kind: index % 2 ? 'video' as const : 'audio' as const, height: 32 }))
  const rows = timelineTrackRows(sequence)
  const top = timelineInitialScrollTop(rows, 300)
  expect(top).toBe(380)
  const video = rows.find(row => row.track.index === 1)!
  const audio = rows.find(row => row.track.index === 0)!
  expect(video.top - top).toBeGreaterThanOrEqual(TIMELINE_RULER_HEIGHT)
  expect(audio.top + audio.height - top).toBeLessThanOrEqual(300)
  expect(timelineInitialScrollTop(rows, 1060)).toBe(0)
  expect(timelineInitialScrollTop(rows, 0)).toBe(0)
  for (const kind of ['video', 'audio'] as const) {
    sequence.tracks = sequence.tracks.map(track => ({ ...track, kind }))
    const singleRows = timelineTrackRows(sequence)
    expect(timelineTrackDivider(singleRows)).toBeUndefined()
    expect(singleRows.at(-1)!.top + singleRows.at(-1)!.height).toBe(28 + 32 * 32)
    expect(timelineInitialScrollTop(singleRows, 300)).toBe(0)
    expect(singleRows.map(row => row.track.index)).toEqual(kind === 'video' ? Array.from({ length: 32 }, (_, index) => 31 - index) : Array.from({ length: 32 }, (_, index) => index))
  }
})

it('边缘自动滚动只在指针朝该边移动后生效，曾离开边缘区后再进入也生效', () => {
  const top = timelineEdgeAxis(40) // 按下点已在起始边缘区 [28, 60)
  expect(timelineArmedEdgeVelocity(top, 40, 28, 300)).toBe(0)
  expect(timelineArmedEdgeVelocity(top, 42, 28, 300)).toBe(0) // 背离边缘不触发
  expect(timelineArmedEdgeVelocity(top, 37, 28, 300)).toBeLessThan(0)
  expect(timelineArmedEdgeVelocity(top, 70, 28, 300)).toBe(0) // 离开边缘区即停
  const bottom = timelineEdgeAxis(290)
  expect(timelineArmedEdgeVelocity(bottom, 290, 28, 300)).toBe(0)
  expect(timelineArmedEdgeVelocity(bottom, 200, 28, 300)).toBe(0)
  expect(timelineArmedEdgeVelocity(bottom, 280, 28, 300)).toBeGreaterThan(0) // 曾离开，回到边缘区即滚动
  const outside = timelineEdgeAxis(150)
  expect(timelineArmedEdgeVelocity(outside, 150, 28, 300)).toBe(0)
  expect(timelineArmedEdgeVelocity(outside, 30, 28, 300)).toBeLessThan(0)
})
