// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from '../application/videoEditService'
import { applyVideoEditBuiltinEffect } from '../application/videoEditCompositing'
import { setVideoEditMaskEditing } from '../application/videoEditMaskEditing'
import { VideoEditMaskOverlay } from './VideoEditMaskOverlay'

vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))

beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/masks.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  // jsdom 没有布局与指针捕获：节目画面按 1920×480 显示（序列 1920×1080 被拉伸，验证按显示框换算）。
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) })
})
afterEach(async () => {
  cleanup(); setVideoEditMaskEditing(null)
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})

it('钢笔：逐点画、按住拖出控制柄、点回起点闭合成遮罩（一步撤销）；选中后拖顶点改路径', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'm1', name: '素材', path: 'D:/media/a.mp4', kind: 'video', durationSeconds: 20, width: 1920, height: 1080 })
  appendVideoEditClip(id, 'm1')
  const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips.find(entry => entry.kind === 'video')!
  const [effectId] = applyVideoEditBuiltinEffect(id, sequence.id, [clip.id], 'gaussian_blur')
  const target = { projectId: id, sequenceId: sequence.id, clipId: clip.id, effectId }
  setVideoEditMaskEditing({ ...target, pen: true })
  const view = render(<VideoEditMaskOverlay instance={owner} onError={error => { throw error }} />)
  const svg = view.container.querySelector('[data-video-edit-mask-overlay="pen"]')!
  const click = (x: number, y: number, dragTo?: [number, number]): void => {
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: x, clientY: y })
    if (dragTo) fireEvent.pointerMove(svg, { pointerId: 1, clientX: dragTo[0], clientY: dragTo[1] })
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: dragTo?.[0] ?? x, clientY: dragTo?.[1] ?? y })
  }
  click(192, 108); click(960, 108, [1152, 108]); click(960, 540)
  click(193, 109) // 回到起点：闭合
  const effect = (): NonNullable<ReturnType<typeof getActiveVideoEditSequence>['clips'][number]['effects']>[number] => getActiveVideoEditSequence(owner).clips.find(entry => entry.id === clip.id)!.effects![0]
  const mask = effect().mask
  expect(mask?.regionId).toBe('shapes')
  const shape = mask?.regionId === 'shapes' ? mask.shapes[0] : undefined
  expect(shape?.kind).toBe('path')
  expect(shape?.points?.map(point => point.map(value => Math.round(value * 100) / 100 + 0))).toEqual([[0.1, 0.1, 0, 0, 0, 0], [0.5, 0.1, -0.1, 0, 0.1, 0], [0.5, 0.5, 0, 0, 0, 0]])
  // 闭合后进入编辑：拖第三个顶点
  const handle = view.container.querySelector('[data-video-edit-mask-handle="vertex-2"]')!
  fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 960, clientY: 540 })
  fireEvent.pointerMove(view.container.querySelector('svg')!, { pointerId: 2, clientX: 1344, clientY: 756 })
  fireEvent.pointerUp(view.container.querySelector('svg')!, { pointerId: 2, clientX: 1344, clientY: 756 })
  const edited = effect().mask
  expect(edited?.regionId === 'shapes' && edited.shapes[0].points![2].slice(0, 2).map(value => Math.round(value * 100) / 100)).toEqual([0.7, 0.7])
  undoVideoEdit(id)
  const undone = effect().mask
  expect(undone?.regionId === 'shapes' && undone.shapes[0].points![2].slice(0, 2).map(value => Math.round(value * 100) / 100)).toEqual([0.5, 0.5])
  undoVideoEdit(id)
  expect(effect().mask).toBeUndefined()
})
