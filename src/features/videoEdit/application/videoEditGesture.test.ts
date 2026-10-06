// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { appendVideoEditClip, appendVideoEditSequence, beginVideoEditGesture, closeVideoEditProject, createVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, saveVideoEdit, setVideoEditView, switchVideoEditSequence, undoVideoEdit, updateVideoEditGesture } from './videoEditService'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { savedVideoEdit, reopenVideoEdit } from './videoEditDocumentTestKit'
import { harnessDocumentStore } from '@/tests/harnessNativeStorage'

const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/gesture.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
const position = (x: number) => (document: VideoEditDocument): VideoEditDocument => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, clips: sequence.clips.map(clip => ({ ...clip, x })) }) })

it('连续预览只提交一次历史，保存等待结束且不落盘半段参数，撤销重做一致', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); await saveVideoEdit(id)
  const history = owner.past.length; const saved = JSON.stringify(savedVideoEdit(owner)); const handle = beginVideoEditGesture(id)
  for (let index = 1; index <= 8; index++) updateVideoEditGesture(handle, position(index / 10))
  expect(owner.past).toHaveLength(history); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(.8)
  let finished = false; const saving = saveVideoEdit(id).then(() => { finished = true })
  await Promise.resolve(); expect(finished).toBe(false); expect(JSON.stringify(savedVideoEdit(owner))).toBe(saved)
  finishVideoEditGesture(handle); await saving
  expect(owner.past).toHaveLength(history + 1); expect(savedVideoEdit(owner).sequences[0].clips[0].x).toBe(.8)
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0)
  undoVideoEdit(id, true); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(.8)
})

it('取消和撤销预览保留旧历史/重做，非法更新不破坏可用预览', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); editVideoProject(id, position(.6)); undoVideoEdit(id)
  const past = owner.past.length; const future = owner.future.length; const handle = beginVideoEditGesture(id)
  updateVideoEditGesture(handle, position(.9)); expect(() => updateVideoEditGesture(handle, position(Infinity))).toThrow()
  expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(.9)
  finishVideoEditGesture(handle, false)
  expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0); expect(owner.past).toHaveLength(past); expect(owner.future).toHaveLength(future)
  const again = beginVideoEditGesture(id); updateVideoEditGesture(again, position(.7)); undoVideoEdit(id)
  expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0); expect(owner.past).toHaveLength(past)
  undoVideoEdit(id, true); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(.6)
})

it('竞争写入被拒绝；切选区/序列取消原预览，晚到句柄不能写新对象', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); const second = appendVideoEditSequence(id); const first = owner.activeSequenceId
  const handle = beginVideoEditGesture(id); updateVideoEditGesture(handle, position(.8))
  expect(() => editVideoProject(id, position(.1))).toThrow('完成当前参数调整')
  expect(() => beginVideoEditGesture(id)).toThrow('完成当前参数调整')
  setVideoEditView(id, { selection: null }); expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0)
  expect(() => updateVideoEditGesture(handle, position(.2))).toThrow('原参数调整已结束')
  const next = beginVideoEditGesture(id); updateVideoEditGesture(next, position(.9)); switchVideoEditSequence(id, second)
  expect(owner.document.sequences.find(sequence => sequence.id === first)!.clips[0].x).toBe(0)
  finishVideoEditGesture(next); expect(owner.activeSequenceId).toBe(second)
})

it('关闭取消原预览并保存有效版本，同ID重开不接受旧句柄', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); await saveVideoEdit(id)
  const handle = beginVideoEditGesture(id); updateVideoEditGesture(handle, position(.8))
  await closeVideoEditProject(id); const reopened = await reopenVideoEdit(owner.document.id)
  expect(getActiveVideoEditSequence(reopened).clips[0].x).toBe(0)
  expect(() => updateVideoEditGesture(handle, position(.1))).toThrow('原参数调整已结束')
  finishVideoEditGesture(handle); expect(getActiveVideoEditSequence(reopened).clips[0].x).toBe(0)
})

it('关闭保存期间拒绝新的手势和写入，合并并发关闭，失败后解除关闭状态', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); await saveVideoEdit(id); editVideoProject(id, position(.6))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const store = harnessDocumentStore(); store.saveGate = gate
  const first = closeVideoEditProject(id); const second = closeVideoEditProject(id)
  await vi.waitFor(() => expect(store.activeSaves).toBe(1))
  expect(() => beginVideoEditGesture(id)).toThrow('剪辑正在关闭')
  expect(() => editVideoProject(id, position(.9))).toThrow('剪辑正在关闭')
  store.saveGate = null; release(); await Promise.all([first, second])
  expect(listVideoEditInstances()).toEqual([]); expect(savedVideoEdit(owner).sequences[0].clips[0].x).toBe(.6)
  const reopened = await reopenVideoEdit(owner.document.id); editVideoProject(id, position(.7))
  store.failSaves = 1
  await expect(closeVideoEditProject(id)).rejects.toThrow('剪辑未能保存到磁盘')
  const handle = beginVideoEditGesture(id); finishVideoEditGesture(handle)
  expect(listVideoEditInstances()).toContain(reopened)
})
