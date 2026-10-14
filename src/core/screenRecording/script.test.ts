import { createVideoEditDocument } from '../videoEdit/document'
import { expect, it, vi } from 'vitest'
import { captureRecordingOperations, generateRecordingScript, replayRecordingSteps, type RecordingScript } from './script'
import { emptyRecordingUnderstanding } from './understanding'
import type { CaptureEvent } from '../captureLog/events'
const target = { kind: 'video_edit.clip' as const, id: 'document:clip' }
const operation = { target, properties: { 'video_edit.clip.x': .2 } }
const script: RecordingScript = { steps: [0, 1, 2].map(i => ({ id: `${i}`, title: `步骤${i}`, startUs: i * 1000, endUs: (i + 1) * 1000, operations: [operation], narrationIds: [], wait: { kind: 'capability_completed', settleMs: 100 }, blockedReason: null })) }
it('只采集有限语义属性，不接受付费、其他实体、代码或路径', () => {
  const input = { summary: '移动', changes: [{ kind: 'set_properties', entityType: target.kind, ...operation }] }
  expect(captureRecordingOperations('change_application_entities', input)).toEqual([operation])
  expect(captureRecordingOperations('generate_image', input)).toBeNull()
  for (const properties of [{ 'video_edit.clip.source': '/secrets' }, { 'settings.api_key': 'secret' }, { 'video_edit.sequence.name': 'wrong kind' }]) expect(captureRecordingOperations('change_application_entities', { ...input, changes: [{ ...input.changes[0], properties }] })).toBeNull()
})
it('生成脚本只接完整成功调用，并绑定旁白；未知或失败操作明确阻断', () => {
  const understanding = emptyRecordingUnderstanding()
  understanding.steps = [{ id: 's', title: '移动', description: '', startUs: 0, endUs: 10000, signal: 'capability', eventIds: [] }]
  const callId = crypto.randomUUID()
  const event = { kind: 'capability' as const, callId, capability: 'change_application_entities', targets: [target], monoUs: 100, recordingUs: 100, timeline: null, clockSegmentRef: 'clock', unavailableReason: 'static', seq: 0, eventId: 'event' }
  const events = [{ ...event, phase: 'started' }, { ...event, monoUs: 200, phase: 'completed' }] as CaptureEvent[]
  const baseline = createVideoEditDocument('快照'); baseline.id = 'document'
  const capture = { baselines: [{ documentId: baseline.id, content: baseline }], calls: [{ callId, operations: [operation] }] }
  expect(generateRecordingScript(understanding, events, capture).steps[0]).toMatchObject({ operations: [operation], blockedReason: null })
  expect(generateRecordingScript(understanding, events, { ...capture, baselines: [] }).steps[0].blockedReason).toContain('快照')
  expect(generateRecordingScript(understanding, events, { baselines: [], calls: [] }).steps[0].blockedReason).toBeTruthy()
  expect(generateRecordingScript(understanding, [{ ...events[0], phase: 'failed' } as CaptureEvent], capture).steps[0].blockedReason).toBeTruthy()
})
it('局部重放执行前置步骤；失败不再推进、取消不执行、已阻断步骤预检拒绝', async () => {
  const execute = vi.fn(async () => undefined), wait = vi.fn(async () => undefined)
  expect(await replayRecordingSteps(script, '1', { execute, wait }, new AbortController().signal)).toEqual(['0', '1'])
  execute.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('目标消失'))
  await expect(replayRecordingSteps(script, undefined, { execute, wait }, new AbortController().signal)).rejects.toThrow('步骤1')
  expect(execute).toHaveBeenCalledTimes(2)
  execute.mockClear()
  await expect(replayRecordingSteps({ steps: [{ ...script.steps[0], blockedReason: '付费' }] }, undefined, { execute, wait }, new AbortController().signal)).rejects.toThrow('付费')
  const abort = new AbortController(); abort.abort()
  await expect(replayRecordingSteps(script, undefined, { execute, wait }, abort.signal)).rejects.toThrow()
  expect(execute).not.toHaveBeenCalled()
})
