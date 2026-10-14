import { expect, it } from 'vitest'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { createVideoEditDocument, videoEditDocumentSchema } from '@/core/videoEdit/document'
import { RECORDING_MOVIE_RECIPES, recordingMovieSpans } from '@/core/screenRecording/movie'
import { buildRecordingMoviePlan } from './recordingMoviePlan'

function fixture() {
  const recording = createRecordingDocument()
  recording.media = [
    { id: 'screen', kind: 'screen', path: '/screen.mp4', monoUs: 1_000_000, durationUs: 10_000_000 },
    { id: 'mic', kind: 'microphone', path: '/mic.wav', monoUs: 2_000_000, durationUs: 8_000_000 },
    { id: 'camera', kind: 'camera', path: '/camera.mp4', monoUs: 2_000_000, durationUs: 8_000_000 },
  ]
  recording.understanding = {
    steps: [{ id: 'step', startUs: 1_000_000, endUs: 11_000_000, title: '打开画布', description: '', signal: 'start', eventIds: [] }],
    transcript: [{ id: 'words', startUs: 2_000_000, endUs: 3_000_000, text: '打开画布', granularity: 'word', audioDocumentId: 'voice', mediaId: 'mic' }],
    candidates: [{ id: 'wait', kind: 'wait', status: 'pending', startUs: 5_000_000, endUs: 9_000_000, reason: '等待', eventIds: [] }, { id: 'pause', kind: 'pause', status: 'accepted', startUs: 9_000_000, endUs: 10_000_000, reason: '停顿', eventIds: [] }],
    privacy: { candidates: [], warnings: [] }, chapters: [{ id: 'chapter', title: '准备', stepIds: ['step'] }], warnings: [],
  }
  const document = createVideoEditDocument('成片')
  document.media = recording.media.map(v => ({ id: v.id, path: v.path, name: v.id, kind: v.kind === 'microphone' ? 'audio' : 'video', width: 1920, height: 1080, durationSeconds: v.durationUs / 1e6 }))
  document.items = document.media.map(v => ({ id: `item-${v.id}`, mediaId: v.id, name: v.name, kind: v.kind }))
  return { recording, document }
}
it('配方映射多轨、加速、删停顿、字幕/章节/标题、画框及多画幅，正式文档校验可保存', () => {
  const { recording, document } = fixture()
  const result = buildRecordingMoviePlan(document, recording, recording.understanding, { ...RECORDING_MOVIE_RECIPES.tutorial, formats: ['landscape', 'portrait', 'square'] }, '成片')
  expect(result.sequenceIds).toHaveLength(3)
  expect(document.media).toHaveLength(3)
  const sequence = document.sequences.find(v => v.id === result.sequenceIds[0])!
  const screen = document.sequences.find(v => v.id === result.screenSequenceIds[0])!
  expect(screen.clips.map(v => [v.start, v.duration, v.sourceInUs, v.speed])).toEqual([[0, 120, 0, { numerator: 1, denominator: 1 }], [120, 30, 4_000_000, { numerator: 4, denominator: 1 }], [150, 30, 9_000_000, { numerator: 1, denominator: 1 }]])
  expect(sequence.clips.filter(v => v.kind === 'audio').map(v => [v.start, v.duration, v.sourceInUs])).toEqual([[30, 90, 0], [120, 30, 3_000_000]])
  expect(sequence.captions).toMatchObject([{ start: 30, duration: 30, text: '打开画布' }])
  expect(sequence.markers).toMatchObject([{ frame: 0, name: '准备' }])
  expect(sequence.clips.some(v => v.name === '打开画布' && v.kind === 'graphic')).toBe(true)
  expect(sequence.clips.find(v => v.name === 'camera')?.effects?.[0].mask?.regionId).toBe('shapes')
  expect(videoEditDocumentSchema.safeParse(document)).toMatchObject({ success: true })
})
it('保留原节奏、拒绝的候选和未确认失误均不剪；句级语气词与旁白等待受到保护', () => {
  const { recording } = fixture()
  expect(recordingMovieSpans(recording, recording.understanding, RECORDING_MOVIE_RECIPES.original)).toHaveLength(1)
  recording.understanding.candidates = [{ id: 'mistake', kind: 'mistake', status: 'pending', startUs: 1_000_000, endUs: 11_000_000, reason: '撤销', eventIds: [] }, { id: 'filler', kind: 'filler', status: 'pending', startUs: 2_000_000, endUs: 3_000_000, reason: '语气词', eventIds: [] }]
  recording.understanding.transcript[0].granularity = 'segment'
  expect(recordingMovieSpans(recording, recording.understanding, RECORDING_MOVIE_RECIPES.tutorial)).toHaveLength(1)
})
it('用户确认跨句加速/裁切时只映射一次字幕，不按变速段重复整句话', () => {
  const { recording, document } = fixture()
  recording.understanding.transcript[0].endUs = 11_000_000
  recording.understanding.transcript[0].granularity = 'segment'
  recording.understanding.candidates.forEach(v => { v.status = 'accepted' })
  const plan = buildRecordingMoviePlan(document, recording, recording.understanding, RECORDING_MOVIE_RECIPES.tutorial, '成片')
  expect(document.sequences.find(v => v.id === plan.sequenceIds[0])?.captions).toMatchObject([{ start: 30, duration: 150, text: '打开画布' }])
  expect(document.sequences.find(v => v.id === plan.sequenceIds[0])?.captions).toHaveLength(1)
})
it('仅已确认候选按各自原片切片启用，跨变速与剪切保持源时间遮罩，多画幅可保存', () => {
  const { recording, document } = fixture()
  const candidate = { id: 'sensitive', mediaId: 'screen', kind: 'email' as const, hint: '邮箱', fingerprint: 'a'.repeat(64), startUs: 4_000_000, endUs: 10_500_000, status: 'accepted' as const, samples: [{ monoUs: 4_000_000, box: [.1, .2, .3, .1] as [number, number, number, number], confidence: 1 }] }
  recording.understanding.privacy.candidates = [candidate, { ...candidate, id: 'pending', status: 'pending' }, { ...candidate, id: 'rejected', status: 'rejected' }]
  const result = buildRecordingMoviePlan(document, recording, recording.understanding, { ...RECORDING_MOVIE_RECIPES.tutorial, formats: ['landscape', 'portrait'] }, '成片')
  for (const id of result.screenSequenceIds) {
    const screen = document.sequences.find(v => v.id === id)!
    const clips = screen.clips.filter(v => v.effects?.some(e => e.builtin?.id === 'mosaic'))
    expect(clips.map(v => [v.sourceInUs, v.duration, v.speed?.numerator])).toEqual([[3_000_000, 30, 1], [4_000_000, 30, 4], [9_000_000, 15, 1]])
    for (const clip of clips) {
      expect(clip.effects).toHaveLength(1)
      expect(clip.effects?.[0]).toMatchObject({ enabled: true, mask: { shapes: [{ id: 'sensitive', pathAnimation: { keys: [{ sourceTimeUs: 0 }, { sourceTimeUs: 3_000_000 }, { sourceTimeUs: 9_500_000 }] } }] } })
    }
  }
  expect(videoEditDocumentSchema.safeParse(document)).toMatchObject({ success: true })
  expect(() => buildRecordingMoviePlan(document, recording, recording.understanding, RECORDING_MOVIE_RECIPES.original, '成片', result.sequenceIds[0])).toThrow('必须为空')
})
