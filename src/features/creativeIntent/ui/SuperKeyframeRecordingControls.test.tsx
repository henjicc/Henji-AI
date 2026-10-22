// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SuperKeyframeRecordingControls } from './CreativeIntentControls'

afterEach(cleanup)
const props = () => ({ status: 'idle' as const, busy: false, microphone: true, deviceId: '', devices: [{ value: '', label: '系统默认麦克风' }], takes: [], onMicrophone: vi.fn(), onDevice: vi.fn(), onRemove: vi.fn(), onStart: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onFinish: vi.fn(), onHandoff: vi.fn() })
it('剪辑只暴露录制与麦克风，不需要选择方式、属性或算法参数', () => {
  const input = props(), view = render(<SuperKeyframeRecordingControls {...input} />)
  fireEvent.click(view.getByRole('button', { name: '开始录制' }))
  expect(input.onStart).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('switch', { name: '麦克风' }))
  expect(input.onMicrophone).toHaveBeenCalledWith(false)
  for (const label of ['示范方式', '示范属性', '参照与约束', '钉住', '保真']) expect(view.queryByText(label)).toBeNull()
})
it('录制和审阅阶段分别提供完成、删段和交接，回调不自动发送', () => {
  const input = props(), view = render(<SuperKeyframeRecordingControls {...input} status="recording" />)
  fireEvent.click(view.getByRole('button', { name: '暂停' })); expect(input.onPause).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: '完成' })); expect(input.onFinish).toHaveBeenCalledOnce()
  view.rerender(<SuperKeyframeRecordingControls {...input} status="reviewing" takes={[{ id: 'take', label: '第 1 段' }]} />)
  fireEvent.click(view.getByRole('button', { name: '删除第 1 段' })); expect(input.onRemove).toHaveBeenCalledWith('take')
  fireEvent.click(view.getByRole('button', { name: '交给 AI' })); expect(input.onHandoff).toHaveBeenCalledOnce()
})
