// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances, type VideoEditInstance } from '../application/videoEditService'
import { createVideoEditAnnotation } from '../application/videoEditAnnotations'
import { useVideoEditAnnotationRange } from './useVideoEditAnnotationRange'
import { VideoEditAnnotationMarks } from './VideoEditAnnotationMarks'

function Ruler({ instance }: { instance: VideoEditInstance }) {
  const { range: _range, ...handlers } = useVideoEditAnnotationRange(instance, 2, 100, () => { throw new Error('圈段失败') })
  return <div data-testid="ruler" {...handlers} />
}
beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('滚动标尺圈段采用含两端帧、取消不修改入出点；可见标记跳转到批注而通过项隐藏', async () => {
  const owner = await createVideoEditTestProject(); const view = render(<Ruler instance={owner} />); const ruler = view.getByTestId('ruler')
  Object.defineProperty(ruler, 'setPointerCapture', { value: vi.fn() }); vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue(new DOMRect(-50, 0, 600, 28))
  const send = (type: string, x: number) => fireEvent(ruler, new MouseEvent(type, { clientX: x, clientY: 2, button: 0, altKey: true, shiftKey: true, bubbles: true }))
  send('pointerdown', 100); send('pointerup', 170); expect(owner).toMatchObject({ inFrame: 25, outFrame: 61, activePanel: 'annotations' })
  send('pointerdown', 200); send('pointercancel', 220); send('pointerup', 230); expect(owner.inFrame).toBe(25); expect(owner.outFrame).toBe(61)
  createVideoEditAnnotation(owner.document.id, owner.activeSequenceId, { frame: 30, target: { kind: 'point', x: .5, y: .5 }, text: '这一帧改亮', status: 'open' })
  view.rerender(<VideoEditAnnotationMarks instance={owner} sequence={getActiveVideoEditSequence(owner)} pixels={2} left={40} width={100} onError={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: '跳到标注 1' })); expect(owner.frame).toBe(30)
})
it('挨得太近的批注合成一个计数，指针停上去展开成一排序号，可逐个跳转', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  for (const frame of [30, 31, 80]) createVideoEditAnnotation(id, owner.activeSequenceId, { frame, target: { kind: 'point', x: .5, y: .5 }, text: `第 ${frame} 帧`, status: 'open' })
  const view = render(<VideoEditAnnotationMarks instance={owner} sequence={getActiveVideoEditSequence(owner)} pixels={2} left={0} width={400} onError={vi.fn()} />)
  expect(view.getByRole('button', { name: '跳到标注 3' })).toBeTruthy()
  expect(view.queryByRole('button', { name: '跳到标注 1' })).toBeNull()
  fireEvent.pointerEnter(view.getByRole('button', { name: '这里有 2 条批注' }).parentElement!)
  fireEvent.click(view.getByRole('button', { name: '跳到标注 2' })); expect(owner.frame).toBe(31)
})
