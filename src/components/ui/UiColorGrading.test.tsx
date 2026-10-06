// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { UiColorWheel, UiToneCurve } from './UiColorGrading'

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn(); Element.prototype.hasPointerCapture = () => true
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('曲线连续拖动仅开始/结束一次，Esc 停止后续指针写入；键盘可调整控制点', () => {
  const onBegin = vi.fn(); const onFinish = vi.fn(); const onCancel = vi.fn(); const onChange = vi.fn()
  const view = render(<UiToneCurve label="主曲线" values={[0, 25, 50, 75, 100]} {...{ onBegin, onFinish, onCancel, onChange }} />)
  const plot = view.getByLabelText('主曲线'); const point = view.getByRole('slider', { name: '主曲线 · 输入 50%' })
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  fireEvent.pointerDown(point, { button: 0 }); fireEvent.pointerMove(plot, { clientY: 25 }); fireEvent.pointerMove(plot, { clientY: 20 }); fireEvent.pointerUp(plot)
  expect(onBegin).toHaveBeenCalledOnce(); expect(onFinish).toHaveBeenCalledOnce(); expect(onChange).toHaveBeenLastCalledWith(2, 80)
  fireEvent.pointerDown(point, { button: 0 }); fireEvent.keyDown(point, { key: 'Escape' }); onChange.mockClear(); fireEvent.pointerMove(plot, { clientY: 10 })
  expect(onCancel).toHaveBeenCalledOnce(); expect(onChange).not.toHaveBeenCalled()
  fireEvent.keyDown(point, { key: 'ArrowUp' }); expect(onChange).toHaveBeenCalledWith(2, 51)
})
it('色轮方向与强度使用意图单位；捕获丢失回退，Home 回到中性；禁用后不写入', () => {
  const onBegin = vi.fn(); const onFinish = vi.fn(); const onCancel = vi.fn(); const onChange = vi.fn()
  const view = render(<UiColorWheel label="中间调色轮" hue={0} strength={20} {...{ onBegin, onFinish, onCancel, onChange }} />)
  const wheel = view.getByRole('slider'); vi.spyOn(wheel, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  fireEvent.pointerDown(wheel, { button: 0, clientX: 100, clientY: 50 }); expect(onChange).toHaveBeenLastCalledWith(0, 100)
  fireEvent.pointerMove(wheel, { clientX: 50, clientY: 100 }); expect(onChange).toHaveBeenLastCalledWith(90, 100)
  fireEvent.lostPointerCapture(wheel); expect(onCancel).toHaveBeenCalledOnce(); onChange.mockClear()
  fireEvent.pointerMove(wheel, { clientX: 0, clientY: 0 }); expect(onChange).not.toHaveBeenCalled()
  fireEvent.keyDown(wheel, { key: 'Home' }); expect(onChange).toHaveBeenLastCalledWith(0, 0)
  view.rerender(<UiColorWheel label="中间调色轮" hue={0} strength={20} disabled {...{ onBegin, onFinish, onCancel, onChange }} />)
  onChange.mockClear(); fireEvent.pointerDown(wheel, { button: 0, clientX: 100, clientY: 50 }); fireEvent.keyDown(wheel, { key: 'ArrowUp' }); expect(onChange).not.toHaveBeenCalled()
})
