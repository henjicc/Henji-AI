import { expect, it } from 'vitest'
import type { CaptureEvent, CapturePayload } from '../captureLog/events'
import { segmentRecording, type RecordingAnalysisInput } from './segmentation'
import { recordingUnderstandingSchema } from './understanding'

function event(seconds: number, payload: CapturePayload): CaptureEvent {
  return { ...payload, monoUs: seconds * 1e6, recordingUs: seconds * 1e6, seq: Math.round(seconds * 100), eventId: `event:${seconds}`, timeline: null, clockSegmentRef: 'clock', unavailableReason: 'static' }
}
export function narratedRecordingFixture(): RecordingAnalysisInput {
  return {
    active: [{ startUs: 3000000, endUs: 23000000 }],
    events: [event(3, { kind: 'control', action: 'start' }), event(3.1, { kind: 'window', available: true, windowId: 'main', bounds: null }),
      event(4, { kind: 'capability', callId: 'call', capability: 'create_canvas_node', targets: [], phase: 'started' }),
      event(10, { kind: 'click', point: [100, 100], button: 'left', phase: 'down' }),
      event(15, { kind: 'window', available: true, windowId: 'editor', bounds: null }),
      event(19, { kind: 'key', category: 'undo' }), event(23, { kind: 'control', action: 'stop' })],
    transcript: [
      { id: 't1', startUs: 3100000, endUs: 7000000, text: '首先创建一个节点。', granularity: 'segment', audioDocumentId: 'audio', mediaId: 'mic' },
      { id: 't2', startUs: 15100000, endUs: 18000000, text: '然后打开编辑器。', granularity: 'segment', audioDocumentId: 'audio', mediaId: 'mic' },
      { id: 't3', startUs: 18500000, endUs: 18800000, text: '嗯', granularity: 'word', audioDocumentId: 'audio', mediaId: 'mic' },
    ],
    silence: [{ startUs: 7000000, endUs: 15000000 }, { startUs: 20000000, endUs: 23000000 }],
    stillness: [{ startUs: 7000000, endUs: 15000000 }], sceneCutsUs: [15100000],
  }
}
it('带旁白人工标注夹具：能力优先、窗口优先于邻近画面、点击分簇、等待避开输入和旁白', () => {
  const result = segmentRecording(narratedRecordingFixture())
  expect(result.steps.map(v => [v.startUs, v.signal])).toEqual([[3000000, 'capability'], [10000000, 'click'], [15000000, 'window']])
  expect(result.steps[0].title).toBe('首先创建一个节点。')
  expect(result.candidates.filter(v => v.kind === 'wait').map(v => [v.startUs, v.endUs])).toEqual([[7000000, 9500000], [11000000, 15000000]])
  expect(result.candidates.some(v => v.kind === 'mistake')).toBe(true)
  expect(result.candidates.filter(v => v.kind === 'filler')).toHaveLength(1)
  expect(result.chapters).toHaveLength(2)
})
it('无静音证据不把词间空白当静音，无静止证据不生成等待', () => {
  const input = narratedRecordingFixture()
  expect(segmentRecording({ ...input, silence: [] }).candidates.some(v => ['wait', 'pause'].includes(v.kind))).toBe(false)
  expect(segmentRecording({ ...input, stillness: [] }).candidates.some(v => v.kind === 'wait')).toBe(false)
})
it('双音轨同一时刻识别出的语气词合为一个候选，保留两份文字稿来源', () => {
  const input = narratedRecordingFixture()
  input.transcript.push({ ...input.transcript[2], id: 'system:t3', mediaId: 'system', audioDocumentId: 'system-audio' })
  const result = segmentRecording(input)
  expect(result.transcript).toHaveLength(4)
  expect(result.candidates.filter(value => value.kind === 'filler')).toHaveLength(1)
})
it('暂停的墙钟空档被保留，步骤与候选不能跨越；重复窗口和松开不额外切分', () => {
  const input = narratedRecordingFixture()
  input.events.push(event(8, { kind: 'control', action: 'pause' }), event(12, { kind: 'control', action: 'resume' }), event(16, { kind: 'window', windowId: 'editor', available: true, bounds: null }), event(16.1, { kind: 'click', button: 'left', phase: 'up', point: [100, 100] }))
  const result = segmentRecording(input)
  expect([...result.steps, ...result.candidates].every(v => v.endUs <= 8000000 || v.startUs >= 12000000)).toBe(true)
  expect(result.steps.some(v => v.startUs === 16000000)).toBe(false)
})
it('失败调用、撤销与往返点击只是待审候选；句级语气词不能假造逐词剪切', () => {
  const input = narratedRecordingFixture()
  input.events.push(event(20, { kind: 'capability', callId: 'failed', capability: 'create_canvas_node', targets: [], phase: 'failed' }), ...[20, 20.3, 20.6].map((t, i) => event(t, { kind: 'click', point: [i === 1 ? 200 : 100, 100], button: 'left', phase: 'down' })))
  input.transcript[2].granularity = 'segment'
  const result = segmentRecording(input)
  expect(result.candidates.filter(v => v.kind === 'mistake')).toHaveLength(3)
  expect(result.candidates.every(v => v.status === 'pending')).toBe(true)
  expect(result.candidates.some(v => v.kind === 'filler')).toBe(false)
})
it('拒绝重叠步骤、反向范围和悬空章节引用', () => {
  const result = segmentRecording(narratedRecordingFixture())
  expect(recordingUnderstandingSchema.safeParse({ ...result, steps: [result.steps[0], { ...result.steps[1], startUs: 0 }] }).success).toBe(false)
  expect(recordingUnderstandingSchema.safeParse({ ...result, chapters: [{ id: 'bad', title: 'bad', stepIds: ['missing'] }] }).success).toBe(false)
})
it('语义合并连续一句中的弱点击，能力调用仍可切开；保护词和缺日志不产生删除或加速候选', () => {
  const input = narratedRecordingFixture()
  input.events.push(event(6, { kind: 'click', phase: 'down', button: 'left', point: [20, 20] }))
  input.transcript[2].protected = true
  const result = segmentRecording(input)
  expect(result.steps.some(v => v.startUs === 6000000)).toBe(false)
  expect(result.candidates.some(v => v.kind === 'filler')).toBe(false)
  expect(segmentRecording({ ...input, events: [] }).candidates.some(v => v.kind === 'wait')).toBe(false)
})
it('60 分钟、432000 光标样本与 18000 词的真实规模下生成有界步骤', () => {
  const input: RecordingAnalysisInput = { active: [{ startUs: 0, endUs: 3600000000 }], events: [], transcript: [], silence: [], stillness: [], sceneCutsUs: [] }
  for (let i = 0; i < 432000; i++) input.events.push(event(Math.round(i * 1e6 / 120) / 1e6, { kind: 'cursor', point: [100, 100], shape: 'arrow' }))
  for (let i = 0; i < 18000; i++) input.transcript.push({ id: `word:${i}`, startUs: i * 200000, endUs: i * 200000 + 150000, text: i % 25 === 24 ? '步骤。' : '讲解', granularity: 'word', audioDocumentId: 'audio', mediaId: 'mic' })
  const start = performance.now(), result = segmentRecording(input)
  expect(result.transcript).toHaveLength(18000)
  expect(result.steps).toHaveLength(720)
  expect(performance.now() - start).toBeLessThan(2000)
})
