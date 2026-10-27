// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from './application/videoEditDocumentTestKit'
import { closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances, subscribeVideoEdit, videoEditRevision, type VideoEditInstance } from './application/videoEditService'
import { captureVideoEditCommandContext } from './application/videoEditCommands'
import { createVideoEditAnnotation, selectVideoEditAnnotation, videoEditAnnotationBrush } from './application/videoEditAnnotations'
import { timelineCommandPresentation } from './timeline/timelineCommandPresentation'
import { VideoEditAnnotationToolOptions } from './VideoEditAnnotationToolOptions'
import { VideoEditAnnotationOverlay } from './VideoEditAnnotationOverlay'

beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

function Options({ owner, onError }: { owner: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const context = captureVideoEditCommandContext(owner.document.id, 'timeline', { includeClipboard: false })
  return <><VideoEditAnnotationToolOptions instance={owner} presentation={id => timelineCommandPresentation(context, id, {})} onError={onError} /><VideoEditAnnotationOverlay instance={owner} active onError={onError} /></>
}

it('参数条：形状进入批注工具，颜色与粗细改画笔并改选中的那条；有待发送时才出现发送', async () => {
  const owner = await createVideoEditTestProject(); const errors = vi.fn()
  const view = render(<Options owner={owner} onError={errors} />)
  const shapes = within(view.getByRole('radiogroup', { name: '批注形状' }))
  expect(view.queryByRole('button', { name: /发送给助手/ })).toBeNull()
  fireEvent.click(shapes.getByRole('radio', { name: '圈' }))
  expect(owner.tool).toBe('annotate'); expect(videoEditAnnotationBrush(owner.document.id).shape).toBe('ellipse')
  const sequence = getActiveVideoEditSequence(owner)
  let id = ''
  act(() => { id = createVideoEditAnnotation(owner.document.id, sequence.id, { frame: 0, target: { kind: 'point', x: .5, y: .5 }, text: '这里', style: { color: 'red' } }) })
  expect(view.getByRole('button', { name: '发送给助手 · 1' })).toBeTruthy()
  const layer = view.getByLabelText('画面标注层'); Object.defineProperty(layer, 'setPointerCapture', { value: vi.fn() }); vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  // 点选画面上的那条批注，再在参数条换颜色：它跟着变
  act(() => selectVideoEditAnnotation(owner.document.id, id))
  fireEvent(view.container.querySelector(`[data-annotation-id="${id}"]`)!, new MouseEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, bubbles: true }))
  fireEvent(layer, new MouseEvent('pointerup', { clientX: 50, clientY: 50, button: 0, bubbles: true }))
  fireEvent.click(view.getByRole('radio', { name: '蓝色' }))
  expect(videoEditAnnotationBrush(owner.document.id).color).toBe('blue')
  expect(getActiveVideoEditSequence(owner).annotations.find(mark => mark.id === id)?.style).toEqual({ color: 'blue' })
  // 粗细同理：选中的那条跟着变；中等粗细不写进文件
  fireEvent.click(within(view.getByRole('radiogroup', { name: '批注粗细' })).getByRole('radio', { name: '粗' }))
  expect(videoEditAnnotationBrush(owner.document.id).weight).toBe('bold')
  expect(getActiveVideoEditSequence(owner).annotations.find(mark => mark.id === id)?.style).toEqual({ color: 'blue', weight: 'bold' })
  fireEvent.click(within(view.getByRole('radiogroup', { name: '批注粗细' })).getByRole('radio', { name: '中' }))
  expect(getActiveVideoEditSequence(owner).annotations.find(mark => mark.id === id)?.style).toEqual({ color: 'blue' })
  expect(errors).not.toHaveBeenCalled()
})
