/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageEditAdjustmentLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditorColorGradeParametersV3 } from './ImageEditorColorGradeParametersV3'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function setup() {
  const frames = new Map<number, () => void>(); let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  const layer = createImageEditAdjustmentLayerV3('grade', '调整', 'color_grade', {})
  const controller = { sessionId: 'grade-test', setParameterPreview: vi.fn(), clearParameterPreview: vi.fn(), commitLayerParamsPreview: vi.fn() }
  const view = render(<ImageEditorColorGradeParametersV3 controller={controller} layer={layer} disabled={false} />)
  const flush = (): void => { const scheduled = [...frames.values()]; frames.clear(); act(() => scheduled.forEach(callback => callback())) }
  return { view, layer, controller, frames, flush }
}
describe('图片调整复用中立参数事务', () => {
  it('仅基本组展开，连续拖动一帧发布最新值、松手一笔提交', () => {
    const { view, controller, frames, flush } = setup()
    expect(view.getByRole('button', { name: '展开曲线' }).getAttribute('aria-expanded')).toBe('false')
    const input = view.getByRole('slider', { name: '曝光滑杆' })
    fireEvent.pointerDown(input, { pointerId: 1 })
    for (let i = 1; i <= 10; i++) fireEvent.change(input, { target: { value: i / 10 } })
    expect(frames.size).toBe(1); expect(controller.commitLayerParamsPreview).not.toHaveBeenCalled()
    flush()
    expect(controller.setParameterPreview).toHaveBeenCalledTimes(1)
    expect(controller.setParameterPreview.mock.calls[0][2]).toMatchObject({ exposure: 1 })
    fireEvent.pointerUp(input, { pointerId: 1 })
    expect(controller.commitLayerParamsPreview).toHaveBeenCalledTimes(1)
    expect(controller.commitLayerParamsPreview.mock.calls[0][2]).toMatchObject({ exposure: 1 })
    expect(frames.size).toBe(0)
  })
  it('HSL 观察不进权威 params；取消和禁用清除排队帧', () => {
    const { view, controller, layer, frames, flush } = setup()
    expect(view.queryByRole('checkbox', { name: '查看 HSL 选区' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '展开HSL 辅助' }))
    fireEvent.click(view.getByRole('checkbox', { name: '查看 HSL 选区' }))
    flush()
    expect(controller.setParameterPreview.mock.calls[0][2]).toHaveProperty('hsl_show_mask', true)
    const input = view.getByRole('slider', { name: '曝光滑杆' })
    fireEvent.pointerDown(input); fireEvent.change(input, { target: { value: .7 } }); fireEvent.pointerUp(input)
    expect(controller.commitLayerParamsPreview.mock.calls[0][2]).not.toHaveProperty('hsl_show_mask')
    fireEvent.pointerDown(input); fireEvent.change(input, { target: { value: .9 } }); fireEvent.pointerCancel(input)
    expect(frames.size).toBe(0); expect(controller.commitLayerParamsPreview).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(input); fireEvent.change(input, { target: { value: 1.1 } })
    view.rerender(<ImageEditorColorGradeParametersV3 controller={controller} layer={layer} disabled />)
    expect(frames.size).toBe(0)
    expect(view.getByRole('slider', { name: '曝光滑杆' }).matches(':disabled')).toBe(true)
    expect(controller.clearParameterPreview).toHaveBeenCalled()
  })
})
