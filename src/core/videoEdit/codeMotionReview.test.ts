import { expect, it, vi } from 'vitest'
import { collectVideoEditCodeMotion, type CodeMotionObserver } from './codeMotionReview'
import type { CodeAuthorProgram, CodeAuthorFrameObservation } from './codeAuthorProgram'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from './document'
import { addLegacyVideoEditTracks } from './testFixtures'

function fixture() {
  const document = createVideoEditDocument('代码运动'), sequence = createVideoEditSequence('主')
  sequence.id = 'root'; sequence.width = sequence.height = 1000; addLegacyVideoEditTracks(sequence); document.sequences = [sequence]
  const clip: VideoEditClip = { id: 'code', itemId: 'code-item', name: '代码', kind: 'code', track: 1, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', code: { definitionId: 'definition', versionId: 'version', parameters: {} } }
  sequence.clips = [clip]
  const program: CodeAuthorProgram = { apiVersion: 4, languageVersion: 4, name: '复核', kind: 'generator', mode: 'dynamic', seed: 0, parameters: [], types: {}, frames: [], hexColors: [], bundle: { code: '', map: '', locations: { layers: {} } } }
  const composition = videoEditComposition(document, sequence.id)
  const observe: CodeMotionObserver = async (local, frame) => ({ sequenceId: local.id, revision: local.revision, frame, clips: [{ clipId: clip.id, versionId: 'version', width: 1000, height: 1000, elements: [{ id: 'node-3', name: '第三个节点', bounds: [0, 0, 100, 100], matrix: [1, 0, 0, 1, frame * 5, 0], corners: [[frame * 5, 0], [100 + frame * 5, 0], [100 + frame * 5, 100], [frame * 5, 100]], parameterKeys: [], textParameterKeys: [] }] }] })
  const run = (observer = observe) => collectVideoEditCodeMotion(composition, { from: 0, to: 120 }, { version: program }, {}, observer)
  return { composition, clip, program, observe, run }
}
it('measures actual observed layer motion without evaluating author code in the review worker', async () => {
  const { run, observe } = fixture(), read = vi.fn(observe)
  const result = await run(read)
  expect(read).toHaveBeenCalledTimes(120)
  expect(result.sampledFrames).toBe(120)
  expect(result.sampledElements).toBe(120)
  expect(result.records.some(record => record.kind === 'motion' && record.elementPath?.[0] === 'node-3')).toBe(true)
  expect(result.records.some(record => record.kind === 'code_unavailable')).toBe(true)
  expect(result.records.some(record => record.kind === 'motion_hold')).toBe(false)
})
it('rejects a stale observation rather than attributing it to the requested frame', async () => {
  const { run, observe } = fixture()
  await expect(run(async (local, frame) => ({ ...await observe(local, frame), revision: local.revision + 1 }))).rejects.toThrow('画面已改变')
})
it('keeps source-only content unknown when stationary bounds reveal no pixel changes', async () => {
  const { run, observe } = fixture()
  const result = await run(async (local, frame) => ({ ...await observe(local, 0), frame }))
  expect(result.records.some(record => record.kind === 'motion_hold')).toBe(false)
  expect(result.records.filter(record => record.kind === 'code_unavailable')).toHaveLength(1)
})
it('propagates real render failures and does not fabricate invisible layers', async () => {
  await expect(fixture().run(async (): Promise<CodeAuthorFrameObservation> => { throw new Error('作者执行失败') })).rejects.toThrow('作者执行失败')
})
