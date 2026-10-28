import { expect, it, vi } from 'vitest'
import { createVideoEditDocument, createVideoEditSequence } from '@/core/videoEdit/document'
import { createRecordingDocument } from '@/core/screenRecording/document'
vi.mock('@/platform', () => ({ getPlatform: vi.fn() }))
vi.mock('@/features/videoEdit', async () => ({
  ...await import('@/features/videoEdit/application/videoEditRecordingClip'),
  importVideoEditSources: vi.fn(), openVideoEditDocument: vi.fn(), saveVideoEdit: vi.fn(),
  createVideoEditProject: vi.fn(), appendVideoEditSequence: vi.fn(), switchVideoEditSequence: vi.fn(), prepareVideoEditRecordingGain: vi.fn(),
}))
vi.mock('@/features/navigation', () => ({ openApplicationSurface: vi.fn() }))
vi.mock('./recordingMovieSources', () => ({ recordingMovieCursorSources: vi.fn(async () => new Map()) }))
import { placeRecordingMedia, importRecordingToVideo } from './recordingVideoImport'
import { getPlatform } from '@/platform'
import { importVideoEditSources, prepareVideoEditRecordingGain } from '@/features/videoEdit'

it('导入事务只调整这次新增麦克风片段，系统声及原片段不改，测量失败不提交', async () => {
  const document = createVideoEditDocument('录制'), sequence = createVideoEditSequence('序列')
  document.sequences.push(sequence)
  const recording = { ...createRecordingDocument(), status: 'stopped' as const }
  recording.media = ['microphone', 'systemAudio'].map(kind => ({ id: kind, kind: kind as 'microphone' | 'systemAudio', path: `/${kind}.wav`, monoUs: 0, durationUs: 2000000 }))
  for (const source of recording.media) { document.media.push({ id: source.id, path: source.path, name: source.id, kind: 'audio', durationSeconds: 2, width: 0, height: 0, hasAudio: true }); document.items.push({ id: source.id, name: source.id, kind: 'audio', mediaId: source.id }) }
  vi.mocked(getPlatform).mockReturnValue({ documents: { readDocument: async () => ({ meta: { kind: 'screen_recording' }, content: recording }), saveDocument: vi.fn() } } as unknown as ReturnType<typeof getPlatform>)
  vi.mocked(prepareVideoEditRecordingGain).mockImplementation(async (_, ids) => new Map(ids.map(id => [id, 19])))
  let committed: typeof document | undefined
  vi.mocked(importVideoEditSources).mockImplementation(async (_, _sources, _bin, _signal, transform) => { const ids = recording.media.map(source => source.id); committed = await transform!(structuredClone(document), ids); return ids })
  await importRecordingToVideo('capture', { documentId: document.id, sequenceId: sequence.id })
  expect(committed!.sequences[0].clips.map(clip => [clip.itemId, clip.volume, clip.gainDb ?? 0])).toEqual([['microphone', 1, 19], ['systemAudio', 1, 0]])
  expect(document.sequences[0].clips).toHaveLength(0)
  committed = undefined
  vi.mocked(prepareVideoEditRecordingGain).mockRejectedValueOnce(new Error('测量失败'))
  await expect(importRecordingToVideo('capture', { documentId: document.id, sequenceId: sequence.id })).rejects.toThrow('测量失败')
  expect(committed).toBeUndefined()
})

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

it('以第一帧画面为起点对齐音画（早开的麦克风被裁掉），暂停/缺帧留空，不重复补偿音频延迟；摄像头位于屏幕上方', () => {
  const document = createVideoEditDocument('剪辑')
  let sequence = createVideoEditSequence('课程')
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
  sequence = placeRecordingMedia(document, recording, recording.media, recording.media.map(media => media.id), { documentId: document.id, sequenceId: sequence.id, frame: 30 }).sequences[0]
  const mic = sequence.clips.find(clip => clip.itemId === 'microphone')!, screen = sequence.clips.find(clip => clip.itemId === 'screen')!, second = sequence.clips.find(clip => clip.itemId === 'screen2')!
  expect(mic.start).toBe(30); expect(mic.sourceInUs).toBe(50000); expect(screen.start).toBe(30); expect(second.start).toBe(120)
  const camera = sequence.clips.filter(clip => clip.itemId === 'camera')
  expect(camera).toHaveLength(2)
  expect(camera[1].start).toBe(120)
  expect(camera[0].track).toBeGreaterThan(screen.track)
  expect(new Set(sequence.clips.map(clip => clip.linkId)).size).toBe(1)
  expect(camera[1].sourceInUs).toBe(2900000)
  expect(camera[0].duration).toBe(57)
})

it('送入剪辑：倒计时预热段与停止后的编码尾巴都不进时间线，画面和声音同帧开始、同帧结束；有光标日志的屏幕片段默认重绘光标', () => {
  const document = createVideoEditDocument('剪辑')
  let sequence = createVideoEditSequence('课程')
  document.sequences.push(sequence)
  const recording = { ...createRecordingDocument(), startUs: 3_000_000, endUs: 9_000_000 }
  recording.media = [
    { id: 'microphone', kind: 'microphone', path: '/mic.wav', monoUs: 500_000, durationUs: 8_600_000 },
    { id: 'screen', kind: 'screen', path: '/screen.mp4', monoUs: 1_300_000, durationUs: 8_200_000 },
  ]
  for (const source of recording.media) {
    const kind = source.kind === 'microphone' ? 'audio' : 'video'
    document.media.push({ id: source.id, path: source.path, name: source.id, kind, durationSeconds: source.durationUs / 1e6, width: 1920, height: 1080, hasAudio: kind === 'audio' })
    document.items.push({ id: source.id, name: source.id, kind, mediaId: source.id })
  }
  document.media.find(media => media.id === 'screen')!.recordingCursor = { pages: [] } as unknown as NonNullable<typeof document.media[number]['recordingCursor']>
  sequence = placeRecordingMedia(document, recording, recording.media, recording.media.map(media => media.id), { documentId: document.id, sequenceId: sequence.id, frame: 0 }).sequences[0]
  expect(sequence.clips.find(clip => clip.itemId === 'screen')?.effects?.map(effect => effect.builtin?.id)).toEqual(['recording_cursor', 'recording_zoom'])
  expect(sequence.clips.find(clip => clip.itemId === 'microphone')?.effects).toBeUndefined()
  const clips = sequence.clips.map(clip => ({ item: clip.itemId, start: clip.start, end: clip.start + clip.duration, sourceInUs: clip.sourceInUs }))
  expect(clips).toEqual(expect.arrayContaining([{ item: 'microphone', start: 0, end: 180, sourceInUs: 2_500_000 }, { item: 'screen', start: 0, end: 180, sourceInUs: 1_700_000 }]))
})
