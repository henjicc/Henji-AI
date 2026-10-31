// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { deleteVideoEditLaneKeyframe, moveVideoEditLaneKeyframe, videoEditTrackKeyframeLanes } from '@/core/videoEdit/keyframeLanes'
import { closeAllVideoEdits, createVideoEditTestProject } from './videoEditDocumentTestKit'
import { editVideoProject, getActiveVideoEditSequence, undoVideoEdit } from './videoEditService'
import { addVideoEditTextClipAt } from './videoEditTimeline'
import { videoEditBuiltinAnimationFields, writeVideoEditKeyframeLane } from './videoEditKeyframeLanes'

beforeEach(installHarnessNativeStorage)
afterEach(async () => { await closeAllVideoEdits(); uninstallHarnessNativeStorage() })

it('内置效果的关键帧行：挪动与删除走效果的正式写入口，一次一步撤销；删光后留下被删那一帧的数值（重要记录 019）', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; const sequence = getActiveVideoEditSequence(owner)
  const clipId = addVideoEditTextClipAt(id, sequence.id, 0, 1)
  editVideoProject(id, document => { document = structuredClone(document);
    const clip = document.sequences.find(value => value.id === sequence.id)!.clips.find(value => value.id === clipId)!
    clip.effects = [{ id: 'fx', name: '暗角', enabled: true, amount: 1, builtin: { id: 'vignette', params: { amount: 0 }, curves: { amount: [{ time: 0, value: 10, interpolation: 'linear' }, { time: 20, value: 40, interpolation: 'linear' }] } } }]
    return document
  })
  const effect = () => getActiveVideoEditSequence(owner).clips.find(value => value.id === clipId)!.effects![0].builtin!
  const lane = () => videoEditTrackKeyframeLanes(getActiveVideoEditSequence(owner).clips.filter(clip => clip.id === clipId), videoEditBuiltinAnimationFields)[0]
  expect(lane()).toMatchObject({ id: 'builtin:vignette:0:amount', label: '暗角 · 数量' })
  const target = { projectId: id, sequenceId: sequence.id, clipId, source: { kind: 'builtin' as const, effectId: 'fx' } }

  const history = owner.past.length
  writeVideoEditKeyframeLane(target, moveVideoEditLaneKeyframe(lane().entries[0], 20, 25)!)
  expect(effect().curves?.amount?.map(point => point.time)).toEqual([0, 25])
  expect(owner.past).toHaveLength(history + 1)

  const first = deleteVideoEditLaneKeyframe(lane().entries[0], 0); writeVideoEditKeyframeLane(target, first.changes, first.statics)
  const last = deleteVideoEditLaneKeyframe(lane().entries[0], 25); writeVideoEditKeyframeLane(target, last.changes, last.statics)
  expect(effect().curves?.amount).toBeUndefined()
  expect(effect().params.amount).toBe(40)
  undoVideoEdit(id)
  expect(effect().curves?.amount?.map(point => point.time)).toEqual([25])
})
