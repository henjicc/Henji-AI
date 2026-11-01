// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import { evaluateSpatialFrame } from '@/core/videoEdit/spatialEvaluation'
import { planSpatialPropagation } from '@/core/videoEdit/spatialPropagation'
import { createLegacyTrackVideoEditProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { appendVideoEditClip, editVideoProject, undoVideoEdit } from './videoEditService'
import { planVideoEditSpatialPropagationOffThread } from './videoEditMotionWorkerClient'
import { addVideoEditTracks, deleteVideoEditTracks, executeVideoEditTimelineEdit } from './videoEditTimeline'
import { nestVideoEditSelection } from './videoEditNesting'
import { dropVideoEditInput } from './videoEditDrop'
import { evaluateVideoEditClip, evaluateVideoEditKeyframes } from '@/core/videoEdit/keyframes'
import type { VideoEditTimelineEdit } from '@/core/videoEdit/timelineEdits'

vi.mock('./videoEditMotionWorkerClient', async importOriginal => ({ ...await importOriginal<typeof import('./videoEditMotionWorkerClient')>(), planVideoEditSpatialPropagationOffThread: vi.fn((...args: Parameters<typeof planSpatialPropagation>) => planSpatialPropagation(...args)) }))
beforeEach(() => installHarnessNativeStorage())
afterEach(async () => { await closeAllVideoEdits(); vi.mocked(planVideoEditSpatialPropagationOffThread).mockReset().mockImplementation(planSpatialPropagation); uninstallHarnessNativeStorage() })

async function fixture() {
  const owner = await createLegacyTrackVideoEditProject(), id = owner.document.id
  appendVideoEditClip(id)
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, spatialCamera: { aim: { kind: 'clip', clipId: sequence.clips[0].id }, perspective: .4 }, clips: sequence.clips.map(clip => ({ ...clip, duration: 3, spatial: { enabled: true }, x: .2, depth: .1 })) })) }))
  return owner
}
it.each(['delete', 'track', 'nest'] as const)('正式 %s 入口等待目标烘焙，返回提交后的文档并一步撤销', async operation => {
  const owner = await fixture(), id = owner.document.id
  if (operation === 'track') addVideoEditTracks(id, owner.activeSequenceId, [{ kind: 'video', count: 1, slot: 1 }])
  const before = owner.document, sequence = before.sequences[0], history = owner.past.length
  const output = { width: sequence.width, height: sequence.height, displayWidth: sequence.width, displayHeight: sequence.height }
  const original = evaluateSpatialFrame(videoEditComposition(before, sequence.id), 1.25, output, 'final').camera
  const clipId = sequence.clips[0].id
  if (operation === 'delete') {
    const result = await executeVideoEditTimelineEdit(id, sequence.id, { kind: 'delete', clipIds: [clipId], linked: false })
    expect(result).toBe(owner.document.sequences[0])
  } else if (operation === 'track') await deleteVideoEditTracks(id, sequence.id, [sequence.tracks.find(track => track.index === sequence.clips[0].track)!.id])
  else {
    const result = await nestVideoEditSelection({ projectId: id, sequenceId: sequence.id, clipIds: [clipId] }, '子序列', false)
    expect(result.document).toBe(owner.document)
    expect(result.sequence.spatialCamera).toBeUndefined()
    expect(result.sequence.clips[0].spatial).toEqual(sequence.clips[0].spatial)
  }
  expect(evaluateSpatialFrame(videoEditComposition(owner.document, sequence.id), 1.25, output, 'final').camera.view).toEqual(original.view)
  expect(planVideoEditSpatialPropagationOffThread).toHaveBeenCalledTimes(1)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id)
  expect(owner.document.sequences).toEqual(before.sequences)
})
it('正式时间线取消期间不发布选择与文档，保持可重试', async () => {
  const owner = await fixture(), before = owner.document, sequence = before.sequences[0], history = owner.past.length
  const controller = new AbortController(); controller.abort()
  await expect(executeVideoEditTimelineEdit(before.id, sequence.id, { kind: 'delete', clipIds: [sequence.clips[0].id] }, controller.signal)).rejects.toThrow()
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
  await executeVideoEditTimelineEdit(before.id, sequence.id, { kind: 'delete', clipIds: [sequence.clips[0].id] })
  expect(owner.document.sequences[0].clips).toHaveLength(0)
})
it.each(['range', 'overwrite', 'drop'] as const)('正式 %s 保留连续分割中被删身份的来源，烘焙后一次撤销', async operation => {
  const owner = await fixture(), id = owner.document.id
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, duration: 12, curves: { x: [{ time: 0, value: .1, interpolation: 'linear' as const }, { time: 11, value: .2, interpolation: 'linear' as const }] } })) })) }))
  const before = owner.document, sequence = before.sequences[0], clip = sequence.clips[0], history = owner.past.length
  const output = { width: sequence.width, height: sequence.height, displayWidth: sequence.width, displayHeight: sequence.height }
  const original = videoEditComposition(before, sequence.id)
  const result = operation === 'drop'
    ? await dropVideoEditInput(id, { kind: 'items', projectId: id, itemIds: [clip.itemId] }, { frame: 3, track: clip.track, mode: 'overwrite' }).then(() => owner.document.sequences[0])
    : await executeVideoEditTimelineEdit(id, sequence.id, operation === 'range'
    ? { kind: 'range', from: 3, to: 7, tracks: [clip.track], ripple: false }
    : { kind: 'place', frame: 3, mode: 'overwrite', clipboard: { projectId: id, frameRate: sequence.frameRate, clips: [{ ...clip, id: 'inserted', start: 0, duration: 4 }], annotations: [] } })
  const committed = videoEditComposition(owner.document, sequence.id)
  for (const time of [1.25, 3, 4.75, 6.875, 7, 8.5]) {
    const expected = evaluateSpatialFrame(original, time, output, 'final').camera.view
    evaluateSpatialFrame(committed, time, output, 'final').camera.view.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 8))
  }
  expect(result).toBe(owner.document.sequences[0])
  const request = vi.mocked(planVideoEditSpatialPropagationOffThread).mock.calls[0][0]
  expect(request.clipMap.some(map => map.toClipId && !result.clips.some(value => value.id === map.toClipId))).toBe(true)
  expect(planVideoEditSpatialPropagationOffThread).toHaveBeenCalledTimes(1)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id)
  expect(owner.document.sequences).toEqual(before.sequences)
})
it.each(['range', 'insert', 'trim-in', 'trim-out', 'rearrange'] as const)('正式 %s 将序列相机映到实际编辑时钟，保留切点左右子帧并一次撤销', async operation => {
  const owner = await fixture(), id = owner.document.id
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence,
    spatialCamera: { curves: { offsetX: [{ time: 0, value: 0, interpolation: 'ease' as const }, { time: 20, value: 1, interpolation: 'hold' as const }] } },
    clips: sequence.clips.flatMap(clip => [{ ...clip, duration: 12 }, { ...clip, id: 'later', start: 12, duration: 8 }]),
  })) }))
  const before = owner.document, sequence = before.sequences[0], clip = sequence.clips[0], history = owner.past.length
  const edit: VideoEditTimelineEdit = operation === 'range' ? { kind: 'range', from: 3, to: 7, tracks: [clip.track], ripple: true }
    : operation === 'insert' ? { kind: 'place', frame: 3, mode: 'insert', clipboard: { projectId: id, frameRate: sequence.frameRate, clips: [{ ...clip, id: 'inserted', start: 0, duration: 4 }], annotations: [] } }
    : operation === 'rearrange' ? { kind: 'rearrange', mode: 'insert', clipIds: ['later'], delta: -9 }
    : { kind: 'trim', mode: 'ripple', clipIds: [clip.id], edge: operation === 'trim-in' ? 'in' : 'out', delta: operation === 'trim-in' ? 4 : -4 }
  const result = await executeVideoEditTimelineEdit(id, sequence.id, edit)
  const sourceFrame = (time: number): number => operation === 'range' ? time < 3 ? time : time + 4
    : operation === 'insert' ? time < 3 ? time : time < 7 ? 3 : time - 4
    : operation === 'trim-in' ? time + 4 : operation === 'trim-out' ? time < 8 ? time : time + 4
    : time < 3 ? time : time < 11 ? 3 : time < 20 ? time - 8 : time
  for (let time = 0; time < 19; time += .125) expect(evaluateVideoEditKeyframes(result.spatialCamera!.curves!.offsetX, time, 0))
    .toBeCloseTo(evaluateVideoEditKeyframes(sequence.spatialCamera!.curves!.offsetX, sourceFrame(time), 0), 10)
  expect(planVideoEditSpatialPropagationOffThread).toHaveBeenCalledTimes(1)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document.sequences).toEqual(before.sequences)
})
it.each([6, 24])('同轨波纹改速到 %s 帧只移动同轨内容，空间曲线缩放且相机仍按序列时钟跟随目标', async duration => {
  const owner = await fixture(), id = owner.document.id
  editVideoProject(id, document => ({ ...document,
    media: [...document.media, { id: 'speed-media', name: '镜头', path: '/fixture/spatial-speed.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 10, hasAudio: false }],
    items: [...document.items, { id: 'speed-item', name: '镜头', kind: 'video', mediaId: 'speed-media' }],
    sequences: document.sequences.map(sequence => ({ ...sequence,
      spatialCamera: { aim: { kind: 'clip', clipId: sequence.clips[0].id }, bindings: { aim: [{ time: 24, interpolation: 'hold', value: { kind: 'clip', clipId: 'later' } }] },
        curves: { offsetX: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 48, value: .4, interpolation: 'hold' }] } },
      clips: sequence.clips.flatMap(clip => {
        const curves = Object.fromEntries(['depth', 'rotationX', 'rotationY', 'anchorDepth'].map(key => [key, [{ time: 0, value: 0, interpolation: 'linear' as const }, { time: 12, value: key.startsWith('rotation') ? 20 : .2, interpolation: 'hold' as const }]]))
        const source = { ...clip, kind: 'video' as const, itemId: 'speed-item', duration: 12, curves }
        return [source, { ...source, id: 'later', start: 12 }, { ...source, id: 'other', track: sequence.tracks.find(track => track.kind === 'video' && track.index !== clip.track)!.index, start: 12 }]
      }),
    })),
  }))
  const before = owner.document, sequence = before.sequences[0], clip = sequence.clips[0], history = owner.past.length
  const result = await executeVideoEditTimelineEdit(id, sequence.id, { kind: 'speed', clipIds: [clip.id], linked: false, change: { duration, ripple: true } })
  expect(result.spatialCamera).toEqual(sequence.spatialCamera)
  expect(result.clips.find(value => value.id === 'later')!.start).toBe(duration)
  expect(result.clips.find(value => value.id === 'other')).toEqual(sequence.clips.find(value => value.id === 'other'))
  const changed = result.clips.find(value => value.id === clip.id)!
  for (let time = 0; time < duration; time += .125) {
    const expected = evaluateVideoEditClip(clip, time * 12 / duration), actual = evaluateVideoEditClip(changed, time)
    for (const key of ['depth', 'rotationX', 'rotationY', 'anchorDepth'] as const) expect(actual[key]).toBeCloseTo(expected[key]!, 10)
  }
  const original = videoEditComposition(before, sequence.id), committed = videoEditComposition(owner.document, sequence.id)
  const output = { width: sequence.width, height: sequence.height, displayWidth: sequence.width, displayHeight: sequence.height }
  // 目标几何按片段新时钟求值，相机偏移与绑定切换仍取原序列时刻。
  for (const time of [1.125, duration - .125, 24, 24.125, duration + 11.875]) {
    const sourceTime = time < 24 ? time * 12 / duration : time - duration + 12
    const target = evaluateSpatialFrame({ ...original, spatialCamera: { aim: { kind: 'clip', clipId: time < 24 ? clip.id : 'later' } } }, sourceTime, output, 'final').camera.resolvedAim
    const reference = evaluateSpatialFrame({ ...committed, spatialCamera: { ...sequence.spatialCamera, aim: { kind: 'point', point: target }, bindings: undefined } }, time, output, 'final')
    const actual = evaluateSpatialFrame(committed, time, output, 'final')
    actual.camera.view.forEach((value, index) => expect(value).toBeCloseTo(reference.camera.view[index], 10))
  }
  expect(planVideoEditSpatialPropagationOffThread).toHaveBeenCalledTimes(1)
  expect(vi.mocked(planVideoEditSpatialPropagationOffThread).mock.calls[0][0].sequenceTimeMap).toEqual([])
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document.sequences).toEqual(before.sequences)
})
it('空间传播删除目标与世界目标烘焙一次提交，撤销恢复同一绑定', async () => {
  const owner = await fixture(), before = owner.document, history = owner.past.length
  const sequence = before.sequences[0], output = { width: sequence.width, height: sequence.height, displayWidth: sequence.width, displayHeight: sequence.height }
  const original = evaluateSpatialFrame(videoEditComposition(before, sequence.id), 1.25, output, 'final').camera
  await editVideoProject(before.id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, clips: [] })) }), { signal: new AbortController().signal, operation: 'delete' })
  expect(owner.document.sequences[0].clips).toHaveLength(0)
  const camera = evaluateSpatialFrame(videoEditComposition(owner.document, sequence.id), 1.25, output, 'final').camera
  expect(camera.view).toEqual(original.view)
  expect(owner.past).toHaveLength(history + 1)
  expect(planVideoEditSpatialPropagationOffThread).toHaveBeenCalledTimes(1)
  undoVideoEdit(before.id)
  expect(owner.document.sequences).toEqual(before.sequences)
})
it('整份文档传播不会把根序列的相机和可选状态传给普通序列', async () => {
  const owner = await fixture(), id = owner.document.id, plain = createVideoEditSequence('普通序列')
  editVideoProject(id, document => ({ ...document, sequences: [...document.sequences, plain] }))
  const camera = owner.document.sequences[0].spatialCamera
  await editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id === plain.id ? { ...sequence, name: '改名' } : sequence) }), { signal: new AbortController().signal })
  expect(owner.document.sequences[0].spatialCamera).toEqual(camera)
  expect(owner.document.sequences[1]).toEqual({ ...plain, name: '改名' })
})
it('规划取消或期间内容变化都不发布候选，不污染撤销栈', async () => {
  const owner = await fixture(), before = owner.document, history = owner.past.length
  let finish!: () => void
  vi.mocked(planVideoEditSpatialPropagationOffThread).mockImplementation(async request => { await new Promise<void>(resolve => { finish = resolve }); return planSpatialPropagation(request) })
  const candidate = (document: typeof before) => ({ ...document, sequences: document.sequences.map(value => ({ ...value, clips: [] })) })
  const controller = new AbortController()
  const cancelled = editVideoProject(before.id, candidate, { signal: controller.signal })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  controller.abort(); finish()
  await expect(cancelled).rejects.toThrow()
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
  const pending = editVideoProject(before.id, candidate, { signal: new AbortController().signal })
  await vi.waitFor(() => expect(planVideoEditSpatialPropagationOffThread).toHaveBeenCalledTimes(2))
  editVideoProject(before.id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, name: '后续编辑' })) }))
  const later = owner.document
  finish()
  await expect(pending).rejects.toThrow('已修改')
  expect(owner.document).toBe(later); expect(owner.past).toHaveLength(history + 1)
})
it('助手集合删除等待空间规划时，不覆盖用户的后续修改', async () => {
  const owner = await fixture(), id = owner.document.id, before = owner.document, sequence = before.sequences[0], history = owner.past.length
  let finish!: () => void
  vi.mocked(planVideoEditSpatialPropagationOffThread).mockImplementation(async request => { await new Promise<void>(resolve => { finish = resolve }); return planSpatialPropagation(request) })
  const app = createApplicationHarness()
  try {
    const pending = app.call('change_application_entities', { summary: '删除空间目标', changes: [{ kind: 'remove_items', entityType: 'video_edit.clip', parent: { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }, targets: [{ kind: 'video_edit.clip', id: `${id}:${sequence.clips[0].id}` }] }] })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, name: '后续编辑' })) }))
    const later = owner.document
    finish()
    expect(await pending).toMatchObject({ ok: false })
    expect(owner.document).toBe(later); expect(owner.past).toHaveLength(history + 1)
  } finally { app.dispose() }
})
