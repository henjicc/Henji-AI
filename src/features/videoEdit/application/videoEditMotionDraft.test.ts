// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { optimizeMotionDraft } from '@/core/creativeIntent/candidates'
import { createVideoEditTestProject, reopenVideoEdit, failVideoEditSaves } from './videoEditDocumentTestKit'
import { appendVideoEditClip, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditView, undoVideoEdit } from './videoEditService'
import { startVideoMotion, demonstrateVideoMotion, recordVideoMotionPresentation, videoMotionState, videoMotionComposition, setVideoMotionOptions, setVideoMotionPointer, stopVideoMotion, optimizeVideoMotion, applyVideoMotion, configureVideoMotion, reopenVideoMotion, videoMotionLiveResources, setVideoMotionIntent, previewVideoMotion, pinVideoMotionFrame } from './videoEditMotionDraft'
import { readMotionPages } from './videoEditMotionResources'
import { useVideoEditMotionGesture } from '../panels/useVideoEditMotionGesture'
import { configureVideoMotionConstraints, organizeVideoMotionAnnotation } from './videoEditMotionDraft'
import { createVideoEditAnnotation, updateVideoEditAnnotation } from './videoEditAnnotations'
import { motionClipPose } from '@/core/videoEdit/motionDraft'
import { proposeVideoExplanationMotion } from './videoEditMotionDraft'
import { motionDigest } from './videoEditMotionResources'
import { updateVideoEditClipProperties } from './videoEditClipProperties'
import type { IntentDifferencePlan } from '@/core/creativeIntent/intentPlan'
import i18n from '@/i18n/config'
import { updateVideoEditCreativeIntents } from './videoEditService'

vi.mock('./videoEditMotionWorkerClient', () => ({ optimizeVideoEditMotionOffThread: async (input: Parameters<typeof optimizeMotionDraft>[0], signal: AbortSignal, pages?: AsyncIterable<Parameters<typeof optimizeMotionDraft>[0]['samples']>) => { const samples = [...input.samples]; if (pages) for await (const page of pages) samples.push(...page); signal.throwIfAborted(); input = { ...input, samples }; return { result: optimizeMotionDraft(input), original: optimizeMotionDraft({ ...input, draft: { ...input.draft, fidelity: 1 }, intent: undefined, beatFrames: undefined }).candidates[0] } } }))
const files = new Map<string, Uint8Array>()
beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  installHarnessNativeStorage(); files.clear(); vi.stubGlobal('crypto', webcrypto)
  vi.spyOn(getPlatform().system.paths, 'tempDir').mockResolvedValue('D:/temp')
  vi.spyOn(getPlatform().system.paths, 'join').mockImplementation(async (...parts) => parts.join('/'))
  vi.spyOn(getPlatform().system.fs, 'writeFile').mockImplementation(async (path, bytes) => { files.set(path, bytes) })
  vi.spyOn(getPlatform().system.fs, 'readFile').mockImplementation(async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path)! })
  vi.spyOn(getPlatform().system.fs, 'remove').mockImplementation(async path => { files.delete(path) })
  vi.spyOn(getPlatform().documents, 'importFile').mockImplementation(async request => { const path = `D:/materials/${files.size}-${crypto.randomUUID()}.json`; files.set(path, files.get(request.sourcePath)!); return { path, copied: true } })
})
afterEach(async () => { for (const owner of listVideoEditInstances()) { if (videoMotionState(owner)?.status === 'paused') await stopVideoMotion(owner.document.id); await closeVideoEditProject(owner.document.id) } vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
const setup = async () => { const owner = await createVideoEditTestProject(); appendVideoEditClip(owner.document.id); const clip = getActiveVideoEditSequence(owner).clips[0]; setVideoEditView(owner.document.id, { selection: clip.id, frame: 0 }); return owner }
it('原稿读取允许无关元数据更新，但原稿被移除时不能用旧资源恢复', async () => {
  const owner = await setup(); const id = owner.document.id
  await startVideoMotion(id, 'place'); const state = videoMotionState(owner)!
  present(owner, 0); demonstrateVideoMotion(id, state.pose, 'down')
  present(owner, 30); demonstrateVideoMotion(id, { ...state.pose, position: [.7, .5] }, 'up')
  present(owner, 30)
  await stopVideoMotion(id)
  const read = vi.mocked(getPlatform().system.fs.readFile).getMockImplementation()!
  let remove = false
  let injected = false
  vi.mocked(getPlatform().system.fs.readFile).mockImplementation(async (...args) => {
    if (!injected) {
      injected = true
      const current = owner.document.creativeIntents!
      updateVideoEditCreativeIntents(id, {
        ...current,
        drafts: remove ? current.drafts.filter(draft => draft.id !== state.draft.id) : current.drafts,
        motionOptions: remove ? current.motionOptions?.filter(options => options.draftId !== state.draft.id) : current.motionOptions,
        sessions: [...current.sessions],
      })
    }
    return read(...args)
  })
  await reopenVideoMotion(id, state.draft.id)
  expect(videoMotionState(owner)?.draft.id).toBe(state.draft.id)
  remove = true
  injected = false
  await expect(reopenVideoMotion(id, state.draft.id)).rejects.toThrow('原稿数据已改变')
})
const present = (owner: Awaited<ReturnType<typeof setup>>, frame: number) => { setVideoEditView(owner.document.id, { frame }); recordVideoMotionPresentation(owner, { sequenceId: owner.activeSequenceId, frame, revision: videoMotionComposition(owner)!.revision, at: performance.now() }) }
it('自动采集保留同组多目标，不把纯时间轴定位录成动作，属性变化进入原稿', async () => {
  const owner = await setup(), id = owner.document.id
  appendVideoEditClip(id)
  const [first, second] = getActiveVideoEditSequence(owner).clips
  setVideoEditView(id, { selection: first.id, frame: 0 })
  await startVideoMotion(id)
  present(owner, 0); present(owner, 12)
  const state = videoMotionState(owner)!
  expect(state.recent).toHaveLength(0)
  updateVideoEditClipProperties(id, owner.activeSequenceId, first.id, { x: .2, rotation: 45, scale: 1.2 })
  present(owner, 12)
  expect(state.draft.takes[0].placement).toBe(true)
  expect(state.draft.targets[0].editable).toEqual(expect.arrayContaining(['position', 'rotationTurns', 'scaleXY']))
  await stopVideoMotion(id)
  setVideoEditView(id, { selection: second.id, frame: second.start })
  await startVideoMotion(id)
  const next = videoMotionState(owner)!
  expect(next.draft.id).toBe(state.draft.id)
  present(owner, second.start)
  setVideoMotionPointer(id, true)
  demonstrateVideoMotion(id, { ...next.pose, position: [.7, .5] })
  setVideoEditView(id, { scrubbing: true })
  present(owner, second.start + 10)
  setVideoMotionPointer(id, false)
  await stopVideoMotion(id)
  expect(next.draft.targets).toHaveLength(2)
  expect(next.draft.takes, JSON.stringify(next.draft.takes.map(take => ({ range: take.timelineRange, place: take.placement, visit: take.visitRef })))) .toHaveLength(2)
  expect(next.draft.takes[1].placement).toBeUndefined()
  const samples = []
  for await (const page of readMotionPages(id, next.draft)) if (page.kind === 'samples') samples.push(...page.entries)
  expect(new Set(samples.map(sample => sample.targetRef.id)).size).toBe(2)
  expect(getActiveVideoEditSequence(owner).clips[0].rotation).toBe(first.rotation)
})
it('多目标候选按各片段起点映射关键帧，整组应用只增加一次作品历史', async () => {
  const owner = await setup(), id = owner.document.id
  appendVideoEditClip(id)
  const [first, second] = getActiveVideoEditSequence(owner).clips
  editVideoProject(id, document => { document.sequences[0].clips.find(clip => clip.id === second.id)!.start = 100; return document })
  for (const [clip, start] of [[first, 0], [second, 100]] as const) {
    setVideoEditView(id, { selection: clip.id, frame: start })
    await startVideoMotion(id); present(owner, start)
    const state = videoMotionState(owner)!
    demonstrateVideoMotion(id, { ...state.pose, position: [.3, .5] }, 'down'); present(owner, start)
    present(owner, start + 30)
    demonstrateVideoMotion(id, { ...state.pose, position: [.8, .5] }, 'up'); present(owner, start + 30)
    await stopVideoMotion(id)
  }
  await optimizeVideoMotion(id)
  const state = videoMotionState(owner)!
  expect(state.candidates.length, state.message).toBeGreaterThan(0)
  const candidate = state.candidates.find(value => value.id === state.preview)!
  expect(candidate.motions.map(motion => motion.range)).toEqual([[0, 30], [0, 30]])
  const history = owner.past.length
  await applyVideoMotion(id)
  expect(owner.past.length).toBe(history + 1)
  for (const clip of getActiveVideoEditSequence(owner).clips) expect(clip.curves?.x?.find(key => key.time === 30)?.value).toBeCloseTo(.3)
})

it('节拍吸附从片段通用开关进入正式整理；原稿不吸附、钉点优先、标记变化拒绝旧候选', async () => {
  const owner = await setup(), id = owner.document.id, clip = getActiveVideoEditSequence(owner).clips[0]
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, markers: [15, 30, 45].map(frame => ({ id: `beat-${frame}`, frame, name: '节拍', type: 'beat' as const })) })) }))
  updateVideoEditClipProperties(id, owner.activeSequenceId, clip.id, { snapToBeat: true })
  await startVideoMotion(id, 'place'); const state = videoMotionState(owner)!
  for (const [frame, x] of [[0, .2], [17, .8], [33, .3], [60, .7]]) {
    present(owner, frame); demonstrateVideoMotion(id, { ...state.pose, position: [x, .5] }, 'down'); present(owner, frame)
    demonstrateVideoMotion(id, { ...state.pose, position: [x, .5] }, 'up'); present(owner, frame)
  }
  await stopVideoMotion(id); await configureVideoMotion(id, { fidelity: 1 }); await pinVideoMotionFrame(id, 33); await optimizeVideoMotion(id)
  const candidate = state.candidates[0]
  expect(candidate.motions[0].curves.x!.map(point => point.time)).toContain(15)
  expect(candidate.motions[0].curves.x!.map(point => point.time)).toContain(33)
  expect(state.original!.motions[0].curves.x!.map(point => point.time)).toContain(17)
  await previewVideoMotion(id, 'original')
  await previewVideoMotion(id, candidate.id)
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, markers: sequence.markers?.map(mark => mark.frame === 15 ? { ...mark, frame: 16 } : mark) })) }))
  await expect(applyVideoMotion(id)).rejects.toThrow('变化')
  await optimizeVideoMotion(id); const before = structuredClone(getActiveVideoEditSequence(owner).clips[0].curves)
  const history = owner.past.length; await applyVideoMotion(id); expect(owner.past).toHaveLength(history + 1)
  expect(getActiveVideoEditSequence(owner).clips[0].curves?.x?.map(point => point.time)).toContain(16)
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].curves).toEqual(before)
})
it('讲解移动转成正式动作候选，单帧不猜时长，应用后一步撤销且旧基线拒绝',async()=>{
  const owner=await setup(),id=owner.document.id,sequence=getActiveVideoEditSequence(owner),clip=sequence.clips[0],before=structuredClone(clip)
  const plan:IntentDifferencePlan={changes:[{targetRef:{kind:'video_edit.clip',id:`${id}:${clip.id}`},property:'position',before:motionClipPose(clip,0).position,after:[.8,.5],expectedDigest:await motionDigest([sequence,owner.frame])}],protectedRefs:[],issues:[],status:'review',recordedOperationRefs:[{kind:'command',id:'must-not-replay'}]}
  await proposeVideoExplanationMotion(id,[plan],[0,0]);const state=videoMotionState(owner)!
  expect(state.candidates.length).toBeGreaterThan(0);expect(state.reviewRequest).toBe(1);expect(getActiveVideoEditSequence(owner).clips[0]).toEqual(before)
  expect(motionClipPose(videoMotionComposition(owner)!.clips[0],0).position[0]).toBeCloseTo(.8)
  const history=owner.past.length;await applyVideoMotion(id);expect(owner.past).toHaveLength(history+1)
  expect(motionClipPose(getActiveVideoEditSequence(owner).clips[0],0).position[0]).toBeCloseTo(.8)
  undoVideoEdit(id);expect(getActiveVideoEditSequence(owner).clips[0]).toEqual(before)
  await expect(proposeVideoExplanationMotion(id,[plan],[0,0])).rejects.toThrow('已变化')
})
it.each<[number, number]>([[0, 30], [30, 0]])('讲解移动保留实际起终帧顺序（%s → %s）', async (from, to) => {
  const owner = await setup(), id = owner.document.id, sequence = getActiveVideoEditSequence(owner), clip = sequence.clips[0]
  const before = motionClipPose(clip, from).position
  const plan: IntentDifferencePlan = { changes: [{ targetRef: { kind: 'video_edit.clip', id: `${id}:${clip.id}` }, property: 'position', before, after: [.8, .5], expectedDigest: await motionDigest([sequence, owner.frame]) }], protectedRefs: [], issues: [], status: 'review', recordedOperationRefs: [] }
  await proposeVideoExplanationMotion(id, [plan], [from, to])
  expect(videoMotionState(owner)!.draft.takes[0]).toMatchObject({ timelineRange: [from, to], direction: Math.sign(to - from) })
  await applyVideoMotion(id)
  const applied = getActiveVideoEditSequence(owner).clips[0]
  expect(motionClipPose(applied, from).position).toEqual(before)
  expect(motionClipPose(applied, to).position[0]).toBeCloseTo(.8)
})
it('箭头无需伪造录制即可整理，标注变化拒绝旧候选，应用追加处理回复且一次撤销', async () => {
  const owner = await setup(); const id = owner.document.id; const clip = getActiveVideoEditSequence(owner).clips[0]
  const annotation = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, endFrame: 60, clipId: clip.id, target: { kind: 'stroke', strokes: [[{ x: .2, y: .3 }, { x: .8, y: .6 }]] }, text: '沿箭头走' })
  await organizeVideoMotionAnnotation(id, annotation, 'path', [0, 60])
  const state = videoMotionState(owner)!; expect(state.draft.takes).toHaveLength(0); expect(state.candidates).toHaveLength(1)
  expect(motionClipPose(videoMotionComposition(owner)!.clips[0], 60).position[0]).toBeCloseTo(.8)
  updateVideoEditAnnotation(id, annotation, mark => ({ ...mark, text: '沿这个箭头走' }))
  await expect(applyVideoMotion(id)).rejects.toThrow('已变化')
  await optimizeVideoMotion(id)
  const before = structuredClone(getActiveVideoEditSequence(owner).annotations[0]); const history = owner.past.length
  await applyVideoMotion(id)
  const after = getActiveVideoEditSequence(owner).annotations[0]
  expect(after.status).toBe('addressed'); expect(after.author).toEqual(before.author); expect(after.createdAt).toBe(before.createdAt)
  expect(after.thread).toHaveLength(before.thread.length + 1); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).annotations[0]).toEqual(before)
  expect(getActiveVideoEditSequence(owner).clips[0].curves?.x).toBeUndefined()
})
it('参照改变拒绝旧候选，重新整理仍保留录制时的局部偏移且保存重开', async () => {
  const owner = await setup(); const id = owner.document.id; const target = getActiveVideoEditSequence(owner).clips[0]
  appendVideoEditClip(id); const reference = getActiveVideoEditSequence(owner).clips[1]
  editVideoProject(id, document => { const c = document.sequences[0].clips[1]; c.start = 0; c.duration = target.duration; c.x = .1; return document })
  setVideoEditView(id, { selection: target.id, frame: 0 }); await startVideoMotion(id, 'place')
  await configureVideoMotionConstraints(id, { referenceId: reference.id })
  const state = videoMotionState(owner)!; present(owner, 0)
  demonstrateVideoMotion(id, { ...state.pose, position: [.7, .5] }, 'down'); present(owner, 0)
  demonstrateVideoMotion(id, { ...state.pose, position: [.8, .5] }, 'up'); present(owner, 60)
  await stopVideoMotion(id); await optimizeVideoMotion(id)
  editVideoProject(id, document => { document.sequences[0].clips[1].x = .2; return document })
  await expect(applyVideoMotion(id)).rejects.toThrow('已变化')
  await optimizeVideoMotion(id); expect(state.candidates).toHaveLength(1)
  expect(motionClipPose(videoMotionComposition(owner)!.clips[0], 60).position[0]).toBeCloseTo(.9)
  await applyVideoMotion(id)
  expect(getActiveVideoEditSequence(owner).clips[0].groupId).toBe(target.groupId)
  const reopened = await reopenVideoEdit(id); await reopenVideoMotion(id, state.draft.id)
  expect(videoMotionState(reopened)!.constraints?.reference?.clip.x).toBe(.1)
  expect(motionClipPose(getActiveVideoEditSequence(reopened).clips[0], 60).position[0]).toBeCloseTo(.9)
})
it('相对参照选择不使用只清除参照，保留已选标注约束', async () => {
  const owner = await setup(), id = owner.document.id, clip = getActiveVideoEditSequence(owner).clips[0]
  appendVideoEditClip(id)
  const reference = getActiveVideoEditSequence(owner).clips[1]
  const annotationId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, endFrame: 60, clipId: clip.id, target: { kind: 'stroke', strokes: [[{ x: .2, y: .3 }, { x: .8, y: .6 }]] }, text: '沿箭头走' })
  setVideoEditView(id, { selection: clip.id, frame: 0 })
  await startVideoMotion(id, 'place')
  await configureVideoMotionConstraints(id, { referenceId: reference.id, annotation: { id: annotationId, role: 'path', span: [0, 60] } })
  const annotations = structuredClone(videoMotionState(owner)!.constraints!.annotations)
  await configureVideoMotionConstraints(id, { referenceId: '' })
  expect(videoMotionState(owner)!.constraints!.reference).toBeUndefined()
  expect(videoMotionState(owner)!.constraints!.annotations).toEqual(annotations)
})
it('录制不自动播放；找位置没有示范；仅真实呈现姿态进入原稿；一步应用撤销重做且重开保留钉点和原稿', async () => {
  const owner = await setup(); const id = owner.document.id; const history = owner.past.length
  await startVideoMotion(id, 'place'); expect(owner.playing).toBe(false)
  present(owner, 0); present(owner, 20); expect(videoMotionState(owner)!.draft.takes).toHaveLength(0)
  const state = videoMotionState(owner)!
  demonstrateVideoMotion(id, { ...state.pose, position: [.4, .5] }, 'down', performance.now()); expect(state.pending).toHaveLength(0)
  present(owner, 20); setVideoMotionOptions(id, { mode: 'demonstrate' })
  demonstrateVideoMotion(id, { ...state.pose, position: [.7, .5] }, 'up', performance.now()); present(owner, 60)
  expect(state.pending).toHaveLength(2); expect(state.draft.targets[0].editable).toEqual(['position'])
  await stopVideoMotion(id); await configureVideoMotion(id, { pinSampleId: state.recent.at(-1)!.sampleId }); await optimizeVideoMotion(id)
  expect(state.candidates.length).toBeGreaterThan(0); expect(owner.past).toHaveLength(history)
  await applyVideoMotion(id); expect(owner.past).toHaveLength(history + 1); const applied = structuredClone(getActiveVideoEditSequence(owner).clips[0].curves)
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].curves?.x).toBeUndefined(); expect(owner.document.creativeIntents?.drafts[0].pins).toHaveLength(1)
  undoVideoEdit(id, true); expect(getActiveVideoEditSequence(owner).clips[0].curves).toEqual(applied)
  expect(videoMotionLiveResources(owner).length).toBeGreaterThan(0)
  const draftId = state.draft.id; const reopened = await reopenVideoEdit(id); await reopenVideoMotion(id, draftId)
  expect(reopened.selection).toBe(state.draft.targets[0].ref.id.slice(id.length + 1))
  expect(videoMotionState(reopened)!.draft.pins).toHaveLength(1); expect(videoMotionState(reopened)!.original).toBeDefined(); expect(videoMotionState(reopened)!.recent).toHaveLength(2)
})
it('后续手调拒绝旧候选写入，损坏的页读回失败且原作品不改变', async () => {
  const owner = await setup(); const id = owner.document.id; await startVideoMotion(id, 'place'); present(owner, 0)
  const state = videoMotionState(owner)!; demonstrateVideoMotion(id, state.pose, 'down'); present(owner, 0); owner.scrubbing = true
  demonstrateVideoMotion(id, { ...state.pose, position: [.7, .5] }, 'up'); present(owner, 30); owner.scrubbing = false
  await stopVideoMotion(id); await optimizeVideoMotion(id)
  editVideoProject(id, doc => { doc.sequences[0].clips[0].x = .2; return doc })
  await expect(applyVideoMotion(id)).rejects.toThrow('已修改'); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(.2)
  const page = owner.document.creativeIntents!.resources.find(r => r.kind === 'page')!; files.set(page.path, new TextEncoder().encode('{}'))
  await expect(reopenVideoMotion(id, state.draft.id)).rejects.toThrow('已被修改')
  expect(videoMotionState(owner)).toBe(state)
})
it('单击不算示范；慢录取实际呈现帧；暂停后继续操作与倒退拆开重访段', async () => {
  const owner = await setup(); const id = owner.document.id
  await startVideoMotion(id, 'record'); present(owner, 0)
  const state = videoMotionState(owner)!
  setVideoMotionPointer(id, true); present(owner, 0); setVideoMotionPointer(id, false)
  expect(state.draft.takes).toHaveLength(0)
  setVideoMotionOptions(id, { speed: .5 }); expect(owner.playbackRate).toBe(.5)
  setVideoEditView(id, { frame: 30, playing: true })
  demonstrateVideoMotion(id, { ...state.pose, position: [.55, .5] }, 'down')
  recordVideoMotionPresentation(owner, { sequenceId: owner.activeSequenceId, frame: 2, revision: videoMotionComposition(owner)!.revision, at: performance.now() })
  expect(state.pending.at(-1)!.timeline!.frame).toBe(2)
  expect(state.draft.clockSegments.at(-1)!.anchors.at(-1)).toMatchObject({ presentedFrame: 2, requestedFrame: 30, playbackRate: .5 })
  setVideoEditView(id, { frame: 4, playing: false }); present(owner, 4)
  demonstrateVideoMotion(id, { ...state.pose, position: [.65, .5] }, 'up'); present(owner, 4)
  const before = state.draft.takes.length
  owner.scrubbing = true; setVideoMotionOptions(id, { mode: 'demonstrate' })
  present(owner, 10); present(owner, 5); owner.scrubbing = false
  expect(state.draft.takes.length).toBeGreaterThan(before)
  expect(state.draft.clockSegments.some(c => c.mode === 'seek')).toBe(true)
  await stopVideoMotion(id); expect(owner.playbackRate).toBe(1)
  expect(owner.document.creativeIntents!.drafts[0].takes.length).toBe(state.draft.takes.length)
})
it('关闭录制中的项目封存不可变页，重开仍能读回原稿', async () => {
  const owner = await setup(); const id = owner.document.id
  await startVideoMotion(id, 'place'); present(owner, 0)
  const state = videoMotionState(owner)!; demonstrateVideoMotion(id, state.pose, 'down'); present(owner, 0)
  await closeVideoEditProject(id)
  const reopened = await reopenVideoEdit(id); await reopenVideoMotion(id, state.draft.id)
  expect(videoMotionState(reopened)!.recent).toHaveLength(1)
})
it('应用后的磁盘失败只重试保存，不重复写曲线或增加撤销步', async () => {
  const owner = await setup(); const id = owner.document.id
  await startVideoMotion(id, 'place'); present(owner, 0)
  const state = videoMotionState(owner)!; demonstrateVideoMotion(id, state.pose, 'down'); present(owner, 0)
  demonstrateVideoMotion(id, { ...state.pose, position: [.7, .5] }, 'up'); present(owner, 30)
  await stopVideoMotion(id); await optimizeVideoMotion(id)
  const history = owner.past.length
  failVideoEditSaves(true)
  try { await expect(applyVideoMotion(id)).rejects.toThrow(); expect(owner.past.length).toBe(history + 1) }
  finally { failVideoEditSaves(false) }
  const curves = structuredClone(getActiveVideoEditSequence(owner).clips[0].curves)
  await applyVideoMotion(id)
  expect(owner.past.length).toBe(history + 1); expect(getActiveVideoEditSequence(owner).clips[0].curves).toEqual(curves)
  expect(state.draft.applications).toHaveLength(1); expect(state.draft.applications[0].saved).toBe(true)
  const appliedRef = state.draft.applications[0].candidateRef
  await configureVideoMotion(id, { fidelity: .7 })
  expect(videoMotionLiveResources(owner).some(resource => resource.resourceId === appliedRef)).toBe(true)
})
it('多页封存失败保留全部原稿，恢复只重试写入；残影缓存不截断重开数据', async () => {
  const owner = await setup(); const id = owner.document.id
  await startVideoMotion(id, 'place'); present(owner, 0)
  const state = videoMotionState(owner)!
  vi.mocked(getPlatform().documents.importFile).mockRejectedValueOnce(new Error('模拟文件写入失败'))
  for (let i = 0; i < 320; i++) { demonstrateVideoMotion(id, { ...state.pose, position: [.5 + i / 10000, .5] }); present(owner, 0) }
  await expect(stopVideoMotion(id)).rejects.toThrow('模拟文件写入失败')
  expect(state.pending).toHaveLength(320)
  await stopVideoMotion(id)
  const all = []
  for await (const page of readMotionPages(id, state.draft)) if (page.kind === 'samples') all.push(...page.entries)
  expect(all).toHaveLength(320); expect(all.map(sample => sample.seq)).toEqual(Array.from({ length: 320 }, (_, i) => i))
  const reopened = await reopenVideoEdit(id); await reopenVideoMotion(id, state.draft.id)
  let count = 0; for await (const page of readMotionPages(id, videoMotionState(reopened)!.draft)) count += page.count
  expect(count).toBe(320); expect(videoMotionState(reopened)!.recent.length).toBeLessThan(count)
})
it('结束示范的文档保存失败保持可重试状态，成功重试释放录制活动且不改曲线', async () => {
  const owner = await setup(); const id = owner.document.id
  await startVideoMotion(id, 'place'); present(owner, 0); const state = videoMotionState(owner)!
  demonstrateVideoMotion(id, state.pose, 'down'); present(owner, 0)
  const history = owner.past.length
  failVideoEditSaves(true)
  try { await expect(stopVideoMotion(id)).rejects.toThrow(); expect(state.status).toBe('paused'); expect(owner.motionRecording).toBe(true) }
  finally { failVideoEditSaves(false) }
  await stopVideoMotion(id); expect(state.status).toBe('reviewing'); expect(owner.motionRecording).toBe(false); expect(owner.past.length).toBe(history)
  setVideoMotionOptions(id, { speed: .25 }); expect(owner.playbackRate).toBe(1)
})
it('选中目标改变时取消未呈现事件，暂停后仍可结束与保存，不伪造原稿姿态', async () => {
  const owner = await setup(); const id = owner.document.id
  await startVideoMotion(id, 'place'); present(owner, 0); const state = videoMotionState(owner)!
  demonstrateVideoMotion(id, { ...state.pose, position: [.7, .5] })
  setVideoEditView(id, { selection: null })
  expect(state.status).toBe('paused'); expect(state.pending).toHaveLength(0)
  await stopVideoMotion(id)
  expect(state.status).toBe('reviewing'); expect(owner.motionRecording).toBe(false)
  expect(owner.document.creativeIntents!.drafts[0].takes).toHaveLength(0)
})
it('分时摆放的意图端点采用每帧最后呈现的确认姿态，与正式内核同帧折叠一致', async () => {
  const owner = await setup(); const id = owner.document.id
  await startVideoMotion(id, 'place'); present(owner, 20); const state = videoMotionState(owner)!
  demonstrateVideoMotion(id, { ...state.pose, position: [.5, .5] }, 'down'); present(owner, 20)
  demonstrateVideoMotion(id, { ...state.pose, position: [.4, .5] }, 'up'); present(owner, 20)
  demonstrateVideoMotion(id, { ...state.pose, position: [.6, .5] }, 'down'); present(owner, 60)
  demonstrateVideoMotion(id, { ...state.pose, position: [.7, .5] }, 'up'); present(owner, 60)
  await stopVideoMotion(id); await setVideoMotionIntent(id, 'overshoot')
  expect(state.intent).toMatchObject({ kind: 'overshoot', from: [.4, .5], to: [.7, .5] })
  await optimizeVideoMotion(id); expect(state.candidates.length).toBeGreaterThan(0); expect(state.preview).toBe('intent')
  await previewVideoMotion(id, 'expressive'); await configureVideoMotion(id, { fidelity: .7 }); await optimizeVideoMotion(id)
  expect(state.preview).toBe('expressive')
  await pinVideoMotionFrame(id, 'end'); expect(state.preview).toBe('expressive')
})
it.each([false, true])('项目关闭后卸载手势不会再查找已关闭实例（录制=%s）', async recording => {
  const owner = await setup(); const id = owner.document.id; const onError = vi.fn()
  const hook = renderHook(() => useVideoEditMotionGesture(owner, onError))
  if (recording) { await startVideoMotion(id, 'place'); present(owner, 0); demonstrateVideoMotion(id, videoMotionState(owner)!.pose, 'down'); present(owner, 0) }
  await closeVideoEditProject(id)
  expect(() => hook.unmount()).not.toThrow(); expect(onError).not.toHaveBeenCalled()
})
it('旧画面卸载不会取消同文档重开后新实例的正在示范指针', async () => {
  const previous = await setup(); const id = previous.document.id
  const hook = renderHook(() => useVideoEditMotionGesture(previous, vi.fn()))
  await closeVideoEditProject(id)
  const owner = await reopenVideoEdit(id); setVideoEditView(id, { selection: getActiveVideoEditSequence(owner).clips[0].id, frame: 0 })
  await startVideoMotion(id, 'record'); present(owner, 0); const state = videoMotionState(owner)!
  setVideoMotionPointer(id, true); demonstrateVideoMotion(id, { ...state.pose, position: [.6, .5] }); present(owner, 0)
  const before = state.pending.length; hook.unmount(); present(owner, 10)
  expect(state.pending.length).toBeGreaterThan(before)
  setVideoMotionPointer(id, false); await stopVideoMotion(id)
})
