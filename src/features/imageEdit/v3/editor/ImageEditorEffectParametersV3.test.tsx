// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createImageEditAdjustmentLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditorEffectParametersV3 } from './ImageEditorEffectParametersV3'
import type { ImageEditorV3Controller } from './types'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('参数预览合并最新值，结束只提交一次，禁用和卸载取消待执行样本', () => {
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const controller = { sessionId: 'test', setParameterPreview: vi.fn(), clearParameterPreview: vi.fn(), commitLayerParamsPreview: vi.fn() } as unknown as ImageEditorV3Controller
  const layer = createImageEditAdjustmentLayerV3('a', '曝光', 'exposure', { stops: 0, offset: 0, gamma: 1 })
  const view = render(<ImageEditorEffectParametersV3 controller={controller} layer={layer} disabled={false} />)
  const input = view.getAllByRole('slider')[0]
  fireEvent.change(input, { target: { value: '1' } })
  fireEvent.change(input, { target: { value: '2' } })
  expect(frames.size).toBe(1)
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) })
  expect(controller.setParameterPreview).toHaveBeenCalledWith(expect.any(String), 'a', expect.objectContaining({ stops: 2 }))
  fireEvent.pointerUp(input)
  expect(controller.commitLayerParamsPreview).toHaveBeenCalledTimes(1)
  fireEvent.change(input, { target: { value: '3' } })
  view.rerender(<ImageEditorEffectParametersV3 controller={controller} layer={layer} disabled />)
  expect(frames.size).toBe(0)
  view.rerender(<ImageEditorEffectParametersV3 controller={controller} layer={layer} disabled={false} />)
  fireEvent.change(view.getAllByRole('slider')[0], { target: { value: '4' } })
  view.unmount()
  expect(frames.size).toBe(0)
})
