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
import { placeRecordingMedia, importRecordingToVideo, recordingItemNames } from './recordingVideoImport'
import { getPlatform } from '@/platform'
import { importVideoEditSources, prepareVideoEditRecordingGain } from '@/features/videoEdit'
import { recordingMovieCursorSources } from './recordingMovieSources'
import { recordingCombinePlan } from '@/core/screenRecording/combine'
import { captureOptionsSchema } from '@/core/screenRecording/capture'
import { recordingDurationUs } from '@/core/screenRecording/range'
import type { VideoEditDocument } from '@/core/videoEdit/document'

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
  const { itemIds: ids } = await importRecordingToVideo('recording', { documentId: 'editing' })
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
  // 暂停前后各成一个链接组：裁剪或调速一段不带动另一段。
  const before = [mic, screen, camera[0]], after = [second, camera[1]]
  expect(new Set(before.map(clip => clip.linkId)).size).toBe(1); expect(new Set(after.map(clip => clip.linkId)).size).toBe(1)
  expect(before[0].linkId).toBeTruthy(); expect(after[0].linkId).toBeTruthy(); expect(before[0].linkId).not.toBe(after[0].linkId)
  expect(camera[1].sourceInUs).toBe(2900000)
  expect(camera[0].duration).toBe(57)
})

it('素材项带会话名；暂停分出几段才写“第 N 段”，不会和显示器名“屏幕 2”撞名', () => {
  expect(recordingItemNames('走查录屏', [{ kind: 'screen' }, { kind: 'systemAudio' }, { kind: 'screen' }, { kind: 'systemAudio' }, { kind: 'microphone' }]))
    .toEqual(['走查录屏 · 屏幕 第 1 段', '走查录屏 · 系统声音 第 1 段', '走查录屏 · 屏幕 第 2 段', '走查录屏 · 系统声音 第 2 段', '走查录屏 · 麦克风'])
})

it('会话暂停分出的每段画面只和同段的系统声、麦克风链接；段内设备空档切出的两截麦克风仍跟着这段画面', () => {
  const document = createVideoEditDocument('剪辑'), sequence = createVideoEditSequence('录屏')
  document.sequences.push(sequence)
  const recording = createRecordingDocument()
  recording.pauses = [{ startUs: 2000000, endUs: 3000000 }]
  recording.media = [
    { id: 'screen1', kind: 'screen', path: '/s1.mp4', monoUs: 0, durationUs: 2000000 },
    { id: 'screen2', kind: 'screen', path: '/s2.mp4', monoUs: 3000000, durationUs: 2000000 },
    { id: 'system1', kind: 'systemAudio', path: '/a1.wav', monoUs: 0, durationUs: 2000000 },
    { id: 'system2', kind: 'systemAudio', path: '/a2.wav', monoUs: 3000000, durationUs: 2000000 },
    { id: 'mic', kind: 'microphone', path: '/mic.wav', monoUs: 0, durationUs: 5000000 },
  ]
  recording.tracks = { version: 1, sessionId: '00000000-0000-4000-8000-000000000001', originUs: 1, tracks: [{ kind: 'microphone', segments: [], gaps: [{ monoSpanUs: [3500000, 4000000], reason: 'device' }], warnings: [] }] }
  for (const source of recording.media) {
    const kind = source.kind === 'screen' ? 'video' : 'audio'
    document.media.push({ id: source.id, path: source.path, name: source.id, kind, durationSeconds: source.durationUs / 1e6, width: 1920, height: 1080, hasAudio: kind === 'audio' })
    document.items.push({ id: source.id, name: source.id, kind, mediaId: source.id })
  }
  const clips = placeRecordingMedia(document, recording, recording.media, recording.media.map(media => media.id), { documentId: document.id, sequenceId: sequence.id }).sequences[0].clips
  const micClips = clips.filter(clip => clip.itemId === 'mic').sort((a, b) => a.start - b.start)
  expect(micClips).toHaveLength(3)
  const first = new Set([...clips.filter(clip => ['screen1', 'system1'].includes(clip.itemId)), micClips[0]].map(clip => clip.linkId))
  const second = new Set([...clips.filter(clip => ['screen2', 'system2'].includes(clip.itemId)), micClips[1], micClips[2]].map(clip => clip.linkId))
  expect(first.size).toBe(1); expect(second.size).toBe(1)
  expect([...first][0]).toBeTruthy(); expect([...first][0]).not.toBe([...second][0])
  expect(new Set(clips.map(clip => clip.linkId)).size).toBe(2)
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

/** 一次带暂停的录制：两片画面、麦克风与系统声各按暂停分成两条，麦克风第二条里设备断开过半秒。 */
function pausedRecording() {
  const recording = { ...createRecordingDocument(), status: 'stopped' as const, startUs: 1_500_000, endUs: 10_000_000, pauses: [{ startUs: 4_000_000, endUs: 6_000_000 }] }
  recording.source = { name: '屏幕', options: captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps: 30, bitrate: 12000000 }), cursorEmbedded: false }
  recording.media = [
    { id: 'screen-0', kind: 'screen', path: '/s/screen-000000.mp4', monoUs: 1_000_000, durationUs: 3_300_000 },
    { id: 'screen-1', kind: 'screen', path: '/s/screen-000001.mp4', monoUs: 6_000_000, durationUs: 4_200_000 },
    { id: 'microphone-joined-000', kind: 'microphone', path: '/s/microphone-joined-000.wav', monoUs: 800_000, durationUs: 3_300_000 },
    { id: 'microphone-joined-001', kind: 'microphone', path: '/s/microphone-joined-001.wav', monoUs: 5_000_000, durationUs: 5_100_000 },
    { id: 'systemAudio-joined-000', kind: 'systemAudio', path: '/s/systemAudio-joined-000.wav', monoUs: 900_000, durationUs: 3_300_000 },
    { id: 'systemAudio-joined-001', kind: 'systemAudio', path: '/s/systemAudio-joined-001.wav', monoUs: 5_500_000, durationUs: 4_800_000 },
  ]
  recording.tracks = { version: 1, sessionId: '00000000-0000-4000-8000-000000000001', originUs: 1, tracks: [{ kind: 'microphone', segments: [], gaps: [{ monoSpanUs: [7_000_000, 7_500_000], reason: 'device' }], warnings: [] }] }
  return recording
}
function importInto(document: VideoEditDocument, durations: Record<string, number>): { committed: () => VideoEditDocument } {
  let committed: VideoEditDocument | undefined
  vi.mocked(importVideoEditSources).mockImplementation(async (_, sources, _bin, _signal, transform) => {
    const ids = sources.map((_source, index) => `item-${index}`)
    const base = structuredClone(document)
    for (const [index, source] of sources.entries()) {
      const file = source.path!, kind = file.endsWith('.mp4') ? 'video' : 'audio'
      base.media.push({ id: ids[index], path: file, name: file, kind, durationSeconds: durations[file] ?? 0, width: 1920, height: 1080, hasAudio: kind === 'audio' })
      base.items.push({ id: ids[index], name: file, kind, mediaId: ids[index] })
    }
    committed = await transform!(base, ids)
    return ids
  })
  vi.mocked(prepareVideoEditRecordingGain).mockResolvedValue(new Map())
  return { committed: () => committed! }
}

it('暂停后继续的一次录制导入是一个画面片段，麦克风与系统声各一条对齐，同一组链接；设备空档仍留空', async () => {
  const recording = pausedRecording()
  const document = createVideoEditDocument('剪辑'), sequence = createVideoEditSequence('课程')
  document.sequences.push(sequence)
  const [group] = recordingCombinePlan(recording)!
  const combined = [{ ...group, screen: '/s/screen-combined-000.mp4', audio: { microphone: '/s/microphone-combined-000.wav', systemAudio: '/s/systemAudio-combined-000.wav' } }]
  const capture = vi.fn(async () => combined)
  vi.mocked(getPlatform).mockReturnValue({ documents: { readDocument: async () => ({ meta: { kind: 'screen_recording', name: '走查' }, content: recording }), saveDocument: vi.fn() }, screenRecording: { capture } } as unknown as ReturnType<typeof getPlatform>)
  const fileSeconds = group.frames / group.fps
  const run = importInto(document, { '/s/screen-combined-000.mp4': fileSeconds, '/s/microphone-combined-000.wav': fileSeconds, '/s/systemAudio-combined-000.wav': fileSeconds })
  const result = await importRecordingToVideo('rec', { documentId: document.id, sequenceId: sequence.id, frame: 0 })
  expect(capture).toHaveBeenCalledWith({ operation: 'combine', sessionId: 'rec' })
  expect(result).toMatchObject({ combined: true, itemIds: ['item-0', 'item-1', 'item-2'] })
  expect(vi.mocked(importVideoEditSources).mock.calls.at(-1)?.[1]).toEqual([{ path: '/s/screen-combined-000.mp4' }, { path: '/s/microphone-combined-000.wav' }, { path: '/s/systemAudio-combined-000.wav' }])
  // 光标按合并文件的第一帧换算事件时间。
  expect(vi.mocked(recordingMovieCursorSources).mock.calls.at(-1)?.[3]).toEqual([expect.objectContaining({ id: 'screen-combined-0', monoUs: 1_000_000 })])
  const after = run.committed()
  expect(after.items.map(item => item.name)).toEqual(['走查 · 屏幕', '走查 · 麦克风', '走查 · 系统声音'])
  const clips = after.sequences[0].clips
  const screen = clips.filter(clip => clip.itemId === 'item-0'), mic = clips.filter(clip => clip.itemId === 'item-1').sort((a, b) => a.start - b.start), system = clips.filter(clip => clip.itemId === 'item-2')
  expect(screen).toHaveLength(1); expect(system).toHaveLength(1)
  // 时长等于录制时长减去暂停；倒计时预热的半秒从文件开头裁掉。
  expect(screen[0]).toMatchObject({ start: 0, duration: recordingDurationUs(recording) * 30 / 1e6, sourceInUs: 500_000 })
  expect(system[0]).toMatchObject({ start: 0, duration: screen[0].duration, sourceInUs: 500_000 })
  // 麦克风在设备断开的那半秒分开：暂停前后接成一段（0–3.5 秒），断开之后另起一段。
  expect(mic.map(clip => [clip.start, clip.duration, clip.sourceInUs])).toEqual([[0, 105, 500_000], [120, 75, 4_500_000]])
  expect(new Set(clips.map(clip => clip.linkId)).size).toBe(1); expect(clips[0].linkId).toBeTruthy()
})

it('一路声音中途换了采样格式拼不成一条：只这一路照原样分段，画面仍是一个素材，结果写明', async () => {
  const recording = pausedRecording()
  const document = createVideoEditDocument('剪辑'), sequence = createVideoEditSequence('课程')
  document.sequences.push(sequence)
  const [group] = recordingCombinePlan(recording)!
  const combined = [{ ...group, screen: '/s/screen-combined-000.mp4', audio: { systemAudio: '/s/systemAudio-combined-000.wav' } }]
  vi.mocked(getPlatform).mockReturnValue({ documents: { readDocument: async () => ({ meta: { kind: 'screen_recording', name: '走查' }, content: recording }), saveDocument: vi.fn() }, screenRecording: { capture: vi.fn(async () => combined) } } as unknown as ReturnType<typeof getPlatform>)
  const fileSeconds = group.frames / group.fps
  const run = importInto(document, { '/s/screen-combined-000.mp4': fileSeconds, '/s/systemAudio-combined-000.wav': fileSeconds, '/s/microphone-joined-000.wav': 3.3, '/s/microphone-joined-001.wav': 5.1 })
  const result = await importRecordingToVideo('rec', { documentId: document.id, sequenceId: sequence.id, frame: 0 })
  expect(result).toMatchObject({ combined: true, screens: 1, separate: expect.stringContaining('麦克风中途换了采样格式') })
  expect(run.committed().items.map(item => item.name)).toEqual(['走查 · 屏幕', '走查 · 系统声音', '走查 · 麦克风 第 1 段', '走查 · 麦克风 第 2 段'])
  const clips = run.committed().sequences[0].clips
  // 第二条麦克风从会话 6 秒（暂停结束）起紧接在暂停前那段之后：时间线 2.5 秒（第 75 帧）；设备断开那半秒分开。
  expect(clips.filter(clip => clip.itemId === 'item-3').map(clip => [clip.start, clip.sourceInUs])).toEqual([[75, 1_000_000], [120, 2_500_000]])
  expect(new Set(clips.map(clip => clip.linkId)).size).toBe(1)
})

it('合并失败时各段照原样导入、原文件不动，结果如实写明原因', async () => {
  const recording = pausedRecording()
  const document = createVideoEditDocument('剪辑'), sequence = createVideoEditSequence('课程')
  document.sequences.push(sequence)
  vi.mocked(getPlatform).mockReturnValue({ documents: { readDocument: async () => ({ meta: { kind: 'screen_recording', name: '走查' }, content: recording }), saveDocument: vi.fn() }, screenRecording: { capture: vi.fn(async () => { throw new Error('磁盘空间不够再写一份合并后的画面') }) } } as unknown as ReturnType<typeof getPlatform>)
  const run = importInto(document, Object.fromEntries(recording.media.map(media => [media.path, media.durationUs / 1e6])))
  const result = await importRecordingToVideo('rec', { documentId: document.id, sequenceId: sequence.id })
  expect(result.combined).toBe(false)
  expect(result.separate).toContain('磁盘空间不够再写一份合并后的画面')
  expect(vi.mocked(importVideoEditSources).mock.calls.at(-1)?.[1]).toEqual(recording.media.map(media => ({ path: media.path })))
  expect(run.committed().items.map(item => item.name)).toContain('走查 · 屏幕 第 2 段')
})

it('原生采集录的一个连续画面文件（暂停不在文件里）也问主进程分段：导入是一个画面片段，直接用原件，暂停不占时间线', async () => {
  const recording = { ...createRecordingDocument(), sessionId: crypto.randomUUID(), status: 'stopped' as const, startUs: 1_000_000, endUs: 9_000_000, pauses: [{ startUs: 4_000_000, endUs: 6_000_000 }] }
  recording.source = { name: '屏幕', options: captureOptionsSchema.parse({ sourceId: 'screen:0:0', width: 1920, height: 1080, fps: 30, bitrate: 12_000_000 }), cursorEmbedded: false }
  recording.media = [{ id: 'screen-0', kind: 'screen', path: '/s/screen-000000.mp4', monoUs: 1_000_000, durationUs: 6_000_000 }]
  // 单看文档对不出暂停（一个文件跨着暂停），合并计划为空；分段只有主进程按时刻表给得出。
  expect(recordingCombinePlan(recording)).toBeNull()
  const document = createVideoEditDocument('剪辑'), sequence = createVideoEditSequence('课程')
  document.sequences.push(sequence)
  const combined = [{ fps: 30, frames: 180, parts: [{ mediaId: 'screen-0', monoUs: 1_000_000, frames: 90, fileUs: 0 }, { mediaId: 'screen-0', monoUs: 6_000_000, frames: 90, fileUs: 3_000_000 }], screen: '/s/screen-000000.mp4', audio: {} }]
  const capture = vi.fn(async () => combined)
  vi.mocked(getPlatform).mockReturnValue({ documents: { readDocument: async () => ({ meta: { kind: 'screen_recording', name: '走查' }, content: recording }), saveDocument: vi.fn() }, screenRecording: { capture } } as unknown as ReturnType<typeof getPlatform>)
  const run = importInto(document, { '/s/screen-000000.mp4': 6 })
  const result = await importRecordingToVideo('rec', { documentId: document.id, sequenceId: sequence.id, frame: 0 })
  expect(capture).toHaveBeenCalledWith({ operation: 'combine', sessionId: 'rec' })
  expect(result).toMatchObject({ combined: true, screens: 1 })
  expect(vi.mocked(importVideoEditSources).mock.calls.at(-1)?.[1]).toEqual([{ path: '/s/screen-000000.mp4' }])
  const clips = run.committed().sequences[0].clips
  expect(clips.map(clip => [clip.start, clip.duration, clip.sourceInUs])).toEqual([[0, 180, 0]])
})
