// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from './videoEditDocumentTestKit'
import { appendVideoEditClip, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { staggerVideoMotion } from './videoEditMotionDraft'
import { createApplicationHarness } from '@/tests/applicationHarness'

beforeEach(installHarnessNativeStorage)
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); uninstallHarnessNativeStorage() })
it('整批错峰进入一个正式历史，撤销恢复所有目标且保留源；失败无部分写入', async () => {
  const owner = await createVideoEditTestProject(), id = owner.document.id
  appendVideoEditClip(id); appendVideoEditClip(id); appendVideoEditClip(id)
  editVideoProject(id, document => { document = structuredClone(document);
    const sequence = document.sequences[0]
    const source = sequence.clips[0]
    source.curves = { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 10, value: .2, interpolation: 'linear' }] }
    sequence.clips[1].x = -.1
    return document
  })
  const sequence = getActiveVideoEditSequence(owner), [source, a, b] = sequence.clips, before = structuredClone(sequence.clips), past = owner.past.length
  staggerVideoMotion(id, sequence.id, source.id, [a.id, b.id], [0, 10], 4)
  expect(owner.past.length).toBe(past + 1)
  expect(getActiveVideoEditSequence(owner).clips[0]).toEqual(source)
  expect(getActiveVideoEditSequence(owner).clips[1].curves?.x?.find(point => point.time === 14)?.value).toBeCloseTo(.1)
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips).toEqual(before)
  expect(() => staggerVideoMotion(id, sequence.id, source.id, [a.id, b.id], [0, 10], b.duration)).toThrow('放不下')
  expect(getActiveVideoEditSequence(owner).clips).toEqual(before)
})
it('助手经正式注册入口调用同一错峰事务并读回曲线；错误归属拒绝写入', async () => {
  const owner = await createVideoEditTestProject(), id = owner.document.id
  appendVideoEditClip(id); appendVideoEditClip(id)
  editVideoProject(id, document => { document = structuredClone(document); document.sequences[0].clips[0].curves = { x: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 10, value: .2, interpolation: 'linear' }] }; return document })
  const sequence = getActiveVideoEditSequence(owner), [source, target] = sequence.clips
  const app = createApplicationHarness()
  try {
    const input = { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }, sourceRef: { kind: 'video_edit.clip', id: `${id}:${source.id}` }, targetRefs: [{ kind: 'video_edit.clip', id: `${id}:${target.id}` }], sourceRange: [0, 10], stepFrames: 4 }
    const baseline = await app.read(input.documentRef)
    const result = await app.requireResult('stagger_video_edit_motion', input, baseline.revisions as Record<string, number>)
    expect(result.resultRefs).toEqual(input.targetRefs)
    expect(getActiveVideoEditSequence(owner).clips[1].curves?.x?.find(point => point.time === 14)?.value).toBe(.2)
    const next = await app.read(input.documentRef)
    const before = owner.document
    expect((await app.call('stagger_video_edit_motion', { ...input, sourceRef: { ...input.sourceRef, id: 'other:clip' } }, next.revisions as Record<string, number>)).ok).toBe(false)
    expect(owner.document).toBe(before)
  } finally { app.dispose() }
})
