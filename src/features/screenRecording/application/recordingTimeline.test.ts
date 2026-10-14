import { expect, it } from 'vitest'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { recordingMediaSpans, recordingTimeline } from './recordingTimeline'

it('轨道按任务名称聚合全部分片，总时长与末段标记采用同一原点', () => {
  const document = createRecordingDocument()
  document.media = [
    { id: 'mic', kind: 'microphone', path: '/mic.wav', monoUs: 100000, durationUs: 11000000 },
    { id: 'screen-5', kind: 'screen', path: '/last.mp4', monoUs: 6100000, durationUs: 5000000 },
    { id: 'screen-0', kind: 'screen', path: '/first.mp4', monoUs: 100000, durationUs: 5000000 },
  ]
  document.markers = [{ id: 'mark', monoUs: 9800000, note: '末段' }]
  const timeline = recordingTimeline(document)
  expect(timeline.originUs).toBe(100000)
  expect(timeline.durationUs).toBe(11000000)
  expect(timeline.tracks.map(track => track.kind)).toEqual(['screen', 'microphone'])
  expect(timeline.tracks[0].spans.map(span => span.media.id)).toEqual(['screen-0', 'screen-5'])
  expect((document.markers[0].monoUs - timeline.originUs) / 1e6).toBe(9.7)
})
it('预览和导入共享暂停、设备空档与文件真实时长裁剪，不编造帧', () => {
  const document = createRecordingDocument()
  const media = { id: 'camera', kind: 'camera' as const, path: '/camera.mp4', monoUs: 1000000, durationUs: 10000000 }
  document.media = [media]
  document.tracks = { version: 1, sessionId: '00000000-0000-4000-8000-000000000001', originUs: 0, tracks: [{ kind: 'camera', segments: [], warnings: [], gaps: [
    { reason: 'pause', monoSpanUs: [3000000, 4000000] },
    { reason: 'device', monoSpanUs: [7000000, 8000000] },
  ] }] }
  expect(recordingMediaSpans(document, media).map(span => [span.startUs, span.endUs])).toEqual([[1000000, 3000000], [4000000, 7000000], [8000000, 11000000]])
  expect(recordingMediaSpans(document, media, 8000000).map(span => [span.startUs, span.endUs])).toEqual([[1000000, 3000000], [4000000, 7000000], [8000000, 9000000]])
  expect(recordingTimeline(createRecordingDocument())).toEqual({ originUs: 0, durationUs: 0, tracks: [] })
})
