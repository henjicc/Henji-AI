import { expect, it } from 'vitest'
import { createVideoEditDocument, type VideoEditSequence } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { TIMELINE_NEW_TRACK_ZONE, TIMELINE_RULER_HEIGHT, TIMELINE_TRACK_SECTION_GAP, timelineArmedEdgeVelocity, timelineEdgeAxis, timelineLayout, timelineNewTrackZone, timelineRegionAt, timelineTrackAt, timelineVisibleClips, timelineWheelAction } from './timelineGeometry'

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

const input = (scroll: Partial<Record<'video' | 'audio', number>> = {}, viewportHeight = 300) => ({ viewportHeight, split: 0.5, scroll: { video: 0, audio: 0, ...scroll } })

it('PR 两区：视频区在上、音频区在下，V1 贴分隔条上方、A1 贴下方，画面按叠加层级逆序，原轨道对象不变', () => {
  const sequence = fixture()
  const original = sequence.tracks.slice()
  const layout = timelineLayout(sequence, input())
  expect(layout.rows.map(row => row.track.index)).toEqual([4, 3, 1, 0, 2])
  expect(layout.rows.map(row => [row.top, row.height])).toEqual([[-88, 40], [-48, 160], [112, 48], [168, 24], [192, 32]])
  expect(layout.regions.video).toMatchObject({ top: 28, height: 132, content: 248 + TIMELINE_NEW_TRACK_ZONE, maxScroll: 148 })
  expect(layout.regions.audio).toMatchObject({ top: 168, height: 132, maxScroll: 0 })
  expect(layout.divider).toBe(164)
  for (const row of layout.rows) expect(row.track).toBe(original.find(track => track.id === row.track.id))
  // 高度草稿统一影响该区坐标
  expect(timelineLayout(sequence, input(), { trackId: 'video-3', height: 24 }).rows.map(row => row.top)).toEqual([48, 88, 112, 168, 192])
})

it('两区各自滚动并夹在范围内：视频区往上滚露出上层轨道，滚出本区的轨道不命中也不算可见', () => {
  const sequence = fixture()
  const scrolled = timelineLayout(sequence, input({ video: 1000, audio: 50 }))
  expect(scrolled.regions.video.scroll).toBe(148); expect(scrolled.regions.audio.scroll).toBe(0)
  expect(scrolled.rows.map(row => row.top)).toEqual([60, 100, 260, 168, 192])
  expect(timelineTrackAt(scrolled.rows, 60)?.track.index).toBe(4)
  expect(timelineTrackAt(scrolled.rows, 159)?.track.index).toBe(3)
  // V1 已滚到分隔条下方：在音频区坐标里不能命中它
  expect(timelineTrackAt(scrolled.rows, 270)).toBeUndefined()
  expect(timelineVisibleClips(sequence.clips, scrolled.rows, { left: 0, width: 900 }, 2).map(clip => clip.track).sort()).toEqual([0, 2, 3, 4])
})

it('轨道命中采用半开边界，标尺、分隔条与新建轨道空白不伪装成轨道', () => {
  const { rows } = timelineLayout(fixture(), input())
  expect(timelineTrackAt(rows, TIMELINE_RULER_HEIGHT - 1)).toBeUndefined()
  expect(timelineTrackAt(rows, 28)?.track.index).toBe(3)
  expect(timelineTrackAt(rows, 111.999)?.track.index).toBe(3)
  expect(timelineTrackAt(rows, 112)?.track.index).toBe(1)
  expect(timelineTrackAt(rows, 160)).toBeUndefined()
  expect(timelineTrackAt(rows, 160 + TIMELINE_TRACK_SECTION_GAP - 0.001)).toBeUndefined()
  expect(timelineTrackAt(rows, 168)?.track.index).toBe(0)
  expect(timelineTrackAt(rows, 192)?.track.index).toBe(2)
  expect(timelineTrackAt(rows, 224)).toBeUndefined()
  expect(timelineVisibleClips(fixture().clips, rows, { left: 0, width: 900 }, 2).map(clip => clip.track).sort()).toEqual([0, 1, 2, 3])
})

it('新序列 V1/A1 居中：最上视频轨之上、最下音频轨之下是新建轨道的落点，区由分隔条划分', () => {
  const sequence = createVideoEditDocument('新序列').sequences[0]
  const layout = timelineLayout(sequence, input())
  expect(layout.rows.map(row => [row.track.kind, row.top])).toEqual([['video', 128], ['audio', 168]])
  expect(timelineNewTrackZone(layout, 100)).toBe('video'); expect(timelineNewTrackZone(layout, 140)).toBeUndefined()
  expect(timelineNewTrackZone(layout, 210)).toBe('audio'); expect(timelineNewTrackZone(layout, 180)).toBeUndefined()
  expect(timelineNewTrackZone(layout, 162)).toBeUndefined()
  expect(timelineRegionAt(layout, 20)).toBeUndefined(); expect(timelineRegionAt(layout, 100)).toBe('video'); expect(timelineRegionAt(layout, 170)).toBe('audio')
  // 拖动分隔条改变两区比例，每区至少留 40
  expect(timelineLayout(sequence, { ...input(), split: 0 }).regions.video.height).toBe(40)
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

it('滚轮按 Premiere 默认：横向滚动，Alt 横向缩放，Shift 轨道高度，Ctrl 纵向滚动', () => {
  const wheel = (deltaY: number, keys: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}, deltaX = 0, deltaMode = 0) => ({ deltaX, deltaY, deltaMode, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...keys })
  expect(timelineWheelAction(wheel(100))).toEqual({ kind: 'scroll', left: 100, top: 0 })
  expect(timelineWheelAction(wheel(0, {}, 40))).toEqual({ kind: 'scroll', left: 40, top: 0 })
  expect(timelineWheelAction(wheel(3, { ctrlKey: true }, 0, 1))).toEqual({ kind: 'scroll', left: 0, top: 48 })
  expect(timelineWheelAction(wheel(-100, { altKey: true }))).toEqual({ kind: 'zoom', factor: 1.25 })
  expect(timelineWheelAction(wheel(100, { altKey: true }))).toEqual({ kind: 'zoom', factor: 0.8 })
  // Windows 把 Shift+滚轮转成横向增量
  expect(timelineWheelAction(wheel(0, { shiftKey: true }, -100))).toEqual({ kind: 'track-height', delta: 8 })
  expect(timelineWheelAction(wheel(200, { shiftKey: true }))).toEqual({ kind: 'track-height', delta: -16 })
  expect(timelineWheelAction(wheel(0))).toBeUndefined()
})
