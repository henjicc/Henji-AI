import { expect, it, vi } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence } from '@/core/videoEdit/document'
import { createRecordingDocument } from '@/core/screenRecording/document'
vi.mock('@/platform', () => ({ getPlatform: vi.fn() }))
vi.mock('@/features/videoEdit/application/videoEditMedia', () => ({ importVideoEditSources: vi.fn() }))
vi.mock('@/features/videoEdit/application/videoEditService', () => ({ openVideoEditDocument: vi.fn(), saveVideoEdit: vi.fn() }))
import { placeRecordingMedia, importRecordingToVideo } from './recordingVideoImport'
import { getPlatform } from '@/platform'
import { importVideoEditSources } from '@/features/videoEdit'

it('工具箱送入剪辑与停止自动导入的共享入口保留所有原片，不只取首片', async () => {
  const recording = createRecordingDocument()
  recording.status = 'stopped'
  recording.media = [
    { id: 'first', kind: 'screen', path: '/first.mp4', monoUs: 0, durationUs: 5000000 },
    { id: 'mic', kind: 'microphone', path: '/mic.wav', monoUs: 0, durationUs: 11000000 },
    { id: 'last', kind: 'screen', path: '/last.mp4', monoUs: 6000000, durationUs: 5000000 },
  ]
  vi.mocked(getPlatform).mockReturnValue({ documents: { readDocument: async () => ({ meta: { kind: 'screen_recording' }, content: recording }) } } as unknown as ReturnType<typeof getPlatform>)
  vi.mocked(importVideoEditSources).mockResolvedValue(['first', 'mic', 'last'])
  const ids = await importRecordingToVideo('recording', { documentId: 'editing' })
  expect(ids).toEqual(['first', 'mic', 'last'])
  expect(vi.mocked(importVideoEditSources).mock.calls.at(-1)?.[1]).toEqual(recording.media.map(media => ({ path: media.path })))
})

it('以实际时间对齐音画，暂停/缺帧留空，不重复补偿音频延迟；摄像头位于屏幕上方', () => {
  const document = createVideoEditDocument('剪辑'), sequence = createVideoEditSequence('课程')
  document.sequences.push(sequence)
  const recording = createRecordingDocument()
  recording.media = [
    { id: 'camera', kind: 'camera', path: '/camera.mp4', monoUs: 4100000, durationUs: 4000000 },
    { id: 'screen', kind: 'screen', path: '/screen.mp4', monoUs: 4000000, durationUs: 2000000 },
    { id: 'screen2', kind: 'screen', path: '/screen2.mp4', monoUs: 7000000, durationUs: 2000000 },
    { id: 'microphone', kind: 'microphone', path: '/mic.wav', monoUs: 3950000, durationUs: 2050000 },
  ]
  recording.tracks = { version: 1, sessionId: '00000000-0000-4000-8000-000000000001', originUs: 1, tracks: [{ kind: 'camera', segments: [], gaps: [{ monoSpanUs: [6000000, 7000000], reason: 'pause' }], warnings: [] }] }
  for (const source of recording.media) {
    const kind = source.kind === 'microphone' ? 'audio' : 'video'
    document.media.push({ id: source.id, path: source.path, name: source.id, kind, durationSeconds: source.durationUs / 1e6, width: 1920, height: 1080, hasAudio: kind === 'audio' })
    document.items.push({ id: source.id, name: source.id, kind, mediaId: source.id })
  }
  placeRecordingMedia(document, recording, recording.media, recording.media.map(media => media.id), { documentId: document.id, sequenceId: sequence.id, frame: 30 })
  const mic = sequence.clips.find(clip => clip.itemId === 'microphone')!, screen = sequence.clips.find(clip => clip.itemId === 'screen')!, second = sequence.clips.find(clip => clip.itemId === 'screen2')!
  expect(mic.start).toBe(30); expect(screen.start).toBe(32); expect(second.start).toBe(122)
  const camera = sequence.clips.filter(clip => clip.itemId === 'camera')
  expect(camera).toHaveLength(2)
  expect(camera[1].start).toBe(122)
  expect(camera[0].track).toBeGreaterThan(screen.track)
  expect(new Set(sequence.clips.map(clip => clip.linkId)).size).toBe(1)
  expect(camera[1].sourceInUs).toBe(2900000)
  expect(camera[0].duration).toBe(57)
})
