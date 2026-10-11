// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CreativeIntentControls, type CreativeIntentControlsProps } from './CreativeIntentControls'

afterEach(cleanup)
function props(): CreativeIntentControlsProps {
  return { status: 'reviewing', candidates: [{ id: 'candidate', label: '保留节奏' }], selected: 'candidate', fidelity: .5, intent: 'path', mode: 'navigate', speed: 1, property: 'position', capture: 'place', pins: [], takes: [], canPin: true,
    onStart: vi.fn(), onStop: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onCancel: vi.fn(), onOptimize: vi.fn(), onApply: vi.fn(), onPreview: vi.fn(), onFidelity: vi.fn(), onPin: vi.fn(), onUnpin: vi.fn(), onTake: vi.fn(), onMode: vi.fn(), onSpeed: vi.fn(), onProperty: vi.fn(), onCapture: vi.fn(), onIntent: vi.fn(), onPlay: vi.fn() }
}
it('保真滑杆拖动只更新本地预览，取消不重算，放手只提交一次', () => {
  const p = props(); render(<CreativeIntentControls {...p} />)
  const slider = screen.getByRole('slider', { name: '保真度' })
  fireEvent.change(slider, { target: { value: '.8' } }); expect(p.onFidelity).not.toHaveBeenCalled()
  fireEvent.keyDown(slider, { key: 'Escape' }); fireEvent.blur(slider); expect(p.onFidelity).not.toHaveBeenCalled()
  fireEvent.change(slider, { target: { value: '.6' } }); fireEvent.pointerUp(slider); fireEvent.blur(slider)
  expect(p.onFidelity).toHaveBeenCalledOnce(); expect(p.onFidelity).toHaveBeenCalledWith(.6)
})
it('原稿与候选切换只发送选择意图，钉住按钮保持键盘焦点与单一应用动作', () => {
  const p = props(); render(<CreativeIntentControls {...p} />)
  fireEvent.click(screen.getByRole('button', { name: '原稿 A' })); fireEvent.click(screen.getByRole('button', { name: '保留节奏 B' }))
  expect(p.onPreview).toHaveBeenNthCalledWith(1, 'original'); expect(p.onPreview).toHaveBeenNthCalledWith(2, 'candidate')
  const pin = screen.getByRole('button', { name: '钉住当前位置' }); pin.focus(); expect(document.activeElement).toBe(pin); fireEvent.click(pin)
  expect(p.onPin).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole('button', { name: '应用' })); expect(p.onApply).toHaveBeenCalledOnce()
  expect(p.selected).toBe('candidate')
})
it('应用保存失败只提供重试保存，不再整理或增加编辑事务', () => {
  const p = props(); render(<CreativeIntentControls {...p} selected="base" needsSave />)
  fireEvent.click(screen.getByRole('button', { name: '重试保存' })); expect(p.onApply).toHaveBeenCalledOnce(); expect(p.onOptimize).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '重新整理' })).toBeNull()
})
it('选中候选后仍能重新整理，无需先预览已经过期的原稿', () => {
  const p = props(); render(<CreativeIntentControls {...p} />)
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }))
  expect(p.onOptimize).toHaveBeenCalledOnce(); expect(p.onPreview).not.toHaveBeenCalled(); expect(p.onApply).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '应用' })).toBeDefined()
})
it('图片侧静态配置直接共用候选和钉点，无需伪造录制回调或播放能力', () => {
  const source = props()
  const p: CreativeIntentControlsProps = { profile: 'layout', status: 'reviewing', candidates: source.candidates, selected: source.selected, fidelity: source.fidelity, pins: [], canPin: true, onCancel: source.onCancel, onOptimize: source.onOptimize, onApply: source.onApply, onPreview: source.onPreview, onFidelity: source.onFidelity, onPin: source.onPin, onUnpin: source.onUnpin }
  render(<CreativeIntentControls {...p} />)
  expect(screen.queryByRole('button', { name: '开始示范' })).toBeNull()
  expect(screen.queryByRole('button', { name: '正常速预览' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '钉住所选图层' })); expect(p.onPin).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '保留节奏 B' })); expect(p.onPreview).toHaveBeenCalledWith('candidate')
})

it('机位配置隐藏二维选项，候选预览与钉住走同源回调', () => {
  const source = props()
  const p: CreativeIntentControlsProps = { profile: 'camera', property: 'position', status: 'reviewing', candidates: [{ id: 'smooth', label: '平滑推拉' }, { id: 'orbit', label: '环绕' }, { id: 'dolly-hold', label: '推近停顿' }], selected: 'smooth', fidelity: .5, pins: [], canPin: true, onStart: vi.fn(), onStop: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onPlay: vi.fn(), onProperty: vi.fn(), onCancel: source.onCancel, onOptimize: source.onOptimize, onApply: source.onApply, onPreview: source.onPreview, onFidelity: source.onFidelity, onPin: source.onPin, onUnpin: source.onUnpin }
  render(<CreativeIntentControls {...p} />)
  expect(screen.queryByRole('slider')).toBeNull()
  expect(screen.queryByRole('button', { name: '分时摆放' })).toBeNull()
  expect(screen.queryByRole('button', { name: '示范运动' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '原稿' })); fireEvent.click(screen.getByRole('button', { name: '环绕' }))
  expect(p.onPreview).toHaveBeenNthCalledWith(1, 'original'); expect(p.onPreview).toHaveBeenNthCalledWith(2, 'orbit')
  fireEvent.click(screen.getByRole('button', { name: '钉住当前机位' })); expect(p.onPin).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '应用' })); expect(p.onApply).toHaveBeenCalledOnce()
})

it('整理通过共享外发确认预检，取消不生成，发送后只生成一次', async () => {
  const p = props(), confirm = vi.fn(async () => {}), prepareGeneration = vi.fn(async () => ({ modelName: '实际模型', imageCount: 2, confirm }))
  render(<CreativeIntentControls {...p} contextKey="session" prepareGeneration={prepareGeneration} />)
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }))
  await screen.findByRole('dialog'); expect(p.onOptimize).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(confirm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重新整理' })); await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('checkbox', { name: '本次讲解不再询问' }))
  fireEvent.click(screen.getByRole('button', { name: '发送' })); fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(p.onOptimize).toHaveBeenCalledOnce())
  expect(confirm).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledWith(true)
})
