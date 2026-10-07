// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from './application/videoEditDocumentTestKit'
import { closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances } from './application/videoEditService'
import { VideoEditAnnotationOverlay } from './VideoEditAnnotationOverlay'

beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('多条笔迹合成一个草稿，确认前不写入；取消不产生历史', async () => {
  const owner = await createVideoEditTestProject(); const errors = vi.fn(); const before = owner.past.length
  const view = render(<VideoEditAnnotationOverlay instance={owner} mode="stroke" onError={errors} />)
  const layer = view.getByLabelText('画面标注层'); Object.defineProperty(layer, 'setPointerCapture', { value: vi.fn() }); vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  const send = (type: string, x: number, y: number) => fireEvent(layer, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }))
  send('pointerdown', 10, 20); send('pointermove', 20, 30); send('pointerup', 30, 40)
  expect(getActiveVideoEditSequence(owner).annotations).toHaveLength(0)
  send('pointerdown', 50, 60); send('pointermove', 60, 70); send('pointerup', 70, 80)
  fireEvent.change(view.getByLabelText('这里要改什么？'), { target: { value: '移动这两处' } }); fireEvent.keyDown(view.getByLabelText('这里要改什么？'), { key: 'Enter' })
  const mark = getActiveVideoEditSequence(owner).annotations[0]; expect(mark).toMatchObject({ status: 'draft', target: { kind: 'stroke', strokes: [[{ x: .1, y: .2 }, { x: .2, y: .3 }, { x: .3, y: .4 }], [{ x: .5, y: .6 }, { x: .6, y: .7 }, { x: .7, y: .8 }]] } }); expect(owner.past.length).toBe(before + 1)
  send('pointerdown', 10, 10); send('pointerup', 20, 20); fireEvent.click(view.getByRole('button', { name: '取消' })); expect(owner.past.length).toBe(before + 1); expect(errors).not.toHaveBeenCalled()
})
