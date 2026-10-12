import i18n from '@/i18n/config'
import { GlobalAlertDialog } from '@/components/ui/GlobalAlertDialog'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CreativeIntentControls, type CreativeIntentControlsProps } from './CreativeIntentControls'

function render(ui: React.ReactElement) { return renderView(ui, { wrapper: ({ children }) => <>{children}<GlobalAlertDialog /></> }) }
afterEach(() => useAlertDialogStore.setState({ queue: [] }))
afterEach(cleanup)
beforeEach(async () => { await i18n.changeLanguage('zh-CN') })
function props(): Extract<CreativeIntentControlsProps, { profile?: 'motion' }> {
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
it('仅录制轨迹显示速度，分段切换继续委托原回调', () => {
  const p = props(), view = render(<CreativeIntentControls {...p} />)
  expect(screen.queryByLabelText('录制速度')).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: '录制轨迹' })); expect(p.onCapture).toHaveBeenCalledWith('record')
  view.rerender(<CreativeIntentControls {...p} capture="record" />)
  expect(screen.getByLabelText('录制速度')).toBeDefined()
  fireEvent.click(screen.getByRole('radio', { name: '示范运动' })); expect(p.onMode).toHaveBeenCalledWith('demonstrate')
})
it('无可钉姿态时隐藏整个区块，已有钉点仍保留；idle 主动作说明下一步', () => {
  const p = props(), view = render(<CreativeIntentControls {...p} status="idle" canPin={false} candidates={[]} />)
  expect(screen.queryByText('钉住姿态')).toBeNull()
  const organize = screen.getByRole('button', { name: '整理' }) as HTMLButtonElement
  expect(organize.disabled).toBe(true); expect(organize.title).toBe('先示范一次运动')
  view.rerender(<CreativeIntentControls {...p} canPin={false} pins={[{ id: 'pin', label: '姿态' }]} />)
  expect(screen.getByText('钉住姿态')).toBeDefined()
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
  const p = props(), confirm = vi.fn(async () => {}), prepareGeneration = vi.fn(async () => ({ costMessage: '费用暂无法预估，按模型实际计费', hasProject: true, cancel: vi.fn(async () => {}), modelName: '实际模型', imageCount: 2, confirm }))
  render(<CreativeIntentControls {...p} contextKey="session" prepareGeneration={prepareGeneration} />)
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }))
  await screen.findByRole('alertdialog'); expect(p.onOptimize).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '拒绝' })) }); expect(confirm).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重新整理' })); await screen.findByRole('alertdialog')
  const allow = screen.getByRole('button', { name: '本项目始终允许' }); fireEvent.click(allow); fireEvent.click(allow)
  await waitFor(() => expect(p.onOptimize).toHaveBeenCalledOnce())
  expect(confirm).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledWith(true)
})
