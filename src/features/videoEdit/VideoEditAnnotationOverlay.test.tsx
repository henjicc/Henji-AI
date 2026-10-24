// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from './application/videoEditDocumentTestKit'
import { closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances } from './application/videoEditService'
import { VideoEditAnnotationOverlay } from './VideoEditAnnotationOverlay'
import { setVideoEditAnnotationBrush } from './application/videoEditAnnotations'

beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('多条笔迹合成一个草稿，确认前不写入；取消不产生历史', async () => {
  const owner = await createVideoEditTestProject(); const errors = vi.fn(); const before = owner.past.length
  setVideoEditAnnotationBrush(owner.document.id, { shape: 'stroke' })
  const view = render(<VideoEditAnnotationOverlay instance={owner} active onError={errors} />)
  const layer = view.getByLabelText('画面标注层'); Object.defineProperty(layer, 'setPointerCapture', { value: vi.fn() }); vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  const send = (type: string, x: number, y: number) => fireEvent(layer, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }))
  send('pointerdown', 10, 20); send('pointermove', 20, 30); send('pointerup', 30, 40)
  expect(getActiveVideoEditSequence(owner).annotations).toHaveLength(0)
  send('pointerdown', 50, 60); send('pointermove', 60, 70); send('pointerup', 70, 80)
  fireEvent.change(view.getByLabelText('这里要改什么？'), { target: { value: '移动这两处' } }); fireEvent.keyDown(view.getByLabelText('这里要改什么？'), { key: 'Enter' })
  const mark = getActiveVideoEditSequence(owner).annotations[0]; expect(mark).toMatchObject({ status: 'draft', target: { kind: 'stroke', strokes: [[{ x: .1, y: .2 }, { x: .2, y: .3 }, { x: .3, y: .4 }], [{ x: .5, y: .6 }, { x: .6, y: .7 }, { x: .7, y: .8 }]] } }); expect(owner.past.length).toBe(before + 1)
  send('pointerdown', 10, 10); send('pointerup', 20, 20); fireEvent.click(view.getByRole('button', { name: '取消' })); expect(owner.past.length).toBe(before + 1); expect(errors).not.toHaveBeenCalled()
})
it('箭头按住 Shift 吸附 45°，带所选颜色；编号自动递增；Esc 放弃', async () => {
  const owner = await createVideoEditTestProject(); const errors = vi.fn()
  setVideoEditAnnotationBrush(owner.document.id, { shape: 'arrow', color: 'blue' })
  const view = render(<VideoEditAnnotationOverlay instance={owner} active onError={errors} />)
  const layer = view.getByLabelText('画面标注层'); Object.defineProperty(layer, 'setPointerCapture', { value: vi.fn() }); vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  const send = (type: string, x: number, y: number, shiftKey = false) => fireEvent(layer, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, shiftKey }))
  const answer = (text: string) => { fireEvent.change(view.getByLabelText('这里要改什么？'), { target: { value: text } }); fireEvent.keyDown(view.getByLabelText('这里要改什么？'), { key: 'Enter' }) }
  send('pointerdown', 10, 10); send('pointermove', 50, 46); send('pointerup', 50, 46, true); answer('指这里')
  const arrow = getActiveVideoEditSequence(owner).annotations[0]
  expect(arrow).toMatchObject({ style: { color: 'blue' }, target: { kind: 'arrow', from: { x: .1, y: .1 } } })
  if (arrow.target.kind !== 'arrow') throw new Error('expected arrow'); expect(arrow.target.to.x).toBeCloseTo(arrow.target.to.y, 5)
  act(() => setVideoEditAnnotationBrush(owner.document.id, { shape: 'marker' }))
  send('pointerdown', 70, 70); send('pointerup', 70, 70); answer('第一处')
  send('pointerdown', 80, 20); send('pointerup', 80, 20); answer('第二处')
  expect(getActiveVideoEditSequence(owner).annotations.map(mark => mark.target.kind === 'marker' ? mark.target.number : 0)).toEqual([0, 1, 2])
  send('pointerdown', 30, 80); send('pointerup', 30, 80); fireEvent.keyDown(view.getByLabelText('这里要改什么？'), { key: 'Escape' })
  expect(getActiveVideoEditSequence(owner).annotations).toHaveLength(3); expect(errors).not.toHaveBeenCalled()
})
it('选中已有标注可整体拖动，Delete 删除', async () => {
  const owner = await createVideoEditTestProject(); const errors = vi.fn()
  setVideoEditAnnotationBrush(owner.document.id, { shape: 'region' })
  const view = render(<VideoEditAnnotationOverlay instance={owner} active onError={errors} />)
  const layer = view.getByLabelText('画面标注层'); Object.defineProperty(layer, 'setPointerCapture', { value: vi.fn() }); vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  const send = (target: Element, type: string, x: number, y: number) => fireEvent(target, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }))
  send(layer, 'pointerdown', 10, 10); send(layer, 'pointermove', 30, 30); send(layer, 'pointerup', 30, 30)
  fireEvent.change(view.getByLabelText('这里要改什么？'), { target: { value: '框住' } }); fireEvent.keyDown(view.getByLabelText('这里要改什么？'), { key: 'Enter' })
  const id = getActiveVideoEditSequence(owner).annotations[0].id
  const hit = layer.querySelector(`[data-annotation-id="${id}"]`)!.firstElementChild!
  send(hit, 'pointerdown', 20, 20); send(layer, 'pointermove', 40, 30); send(layer, 'pointerup', 40, 30)
  const moved = getActiveVideoEditSequence(owner).annotations[0].target; if (moved.kind !== 'region') throw new Error('expected region')
  for (const [value, expected] of [[moved.x, .3], [moved.y, .2], [moved.width, .2], [moved.height, .2]]) expect(value).toBeCloseTo(expected, 6)
  fireEvent.keyDown(layer, { key: 'Delete' })
  expect(getActiveVideoEditSequence(owner).annotations).toHaveLength(0); expect(errors).not.toHaveBeenCalled()
})
