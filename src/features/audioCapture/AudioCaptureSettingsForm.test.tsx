// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureFixture, captureInventory } from './captureTestFixture'
import { captureChannelOptions, captureDeviceOptions, captureHostOptions, captureRateOptions } from './captureSettingsModel'
import { DEFAULT_AUDIO_CAPTURE_SETTINGS } from '@/core/audioCapture/contracts'
import { AudioCaptureSettingsForm } from './AudioCaptureSettingsForm'

const current = vi.hoisted(() => ({ api: {} as ReturnType<typeof captureFixture>['api'] }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioCapture: current.api }) }))
afterEach(cleanup)
describe('录音设置', () => {
  it('实际主机、重名输入、成对通道和 probe 禁用', () => {
    expect(captureHostOptions({ ...captureInventory, asioCompiled: false }).map(option => option.value)).toEqual(['default', 'WASAPI'])
    expect(captureDeviceOptions(captureInventory, { ...DEFAULT_AUDIO_CAPTURE_SETTINGS, hostApi: 'WASAPI' }).map(option => option.label)).toEqual(['系统默认输入', '麦克风（1）', '麦克风（2）'])
    expect(captureChannelOptions(8, 2).map(option => option.label)).toEqual(['输入 1/2', '输入 3/4', '输入 5/6', '输入 7/8'])
    expect(captureChannelOptions(2, 1)).toHaveLength(1)
    expect(captureRateOptions([{ sampleRate: 48000, bitDepth: 24, supported: true }], 24).find(option => option.value === 44100)).toMatchObject({ disabled: true, label: '44.1 kHz · 设备不支持' })
    expect(captureRateOptions([], 24).find(option => option.value === 48000)?.label).toBe('48 kHz')
  })
  it('WASAPI 显示独占，冲突错误就地保留并重新读取', async () => {
    const { api } = captureFixture(); current.api = api
    const release = vi.fn()
    vi.mocked(api.onDevicesChanged).mockReturnValue(release)
    vi.mocked(api.setSettings).mockRejectedValue(new Error('录音设置已改变，请重新读取后修改'))
    const view = render(<AudioCaptureSettingsForm />)
    await screen.findByText('独占模式')
    await waitFor(() => expect(screen.getByRole('radio', { name: '32 位浮点' }).getAttribute('aria-disabled')).toBe('true'))
    fireEvent.click(screen.getByRole('radio', { name: '16 位' }))
    await screen.findByText('录音设置已改变，请重新读取后修改', undefined, { timeout: 5000 })
    expect(api.setSettings).toHaveBeenCalledWith(expect.objectContaining({ bitDepth: 16 }), 1)
    expect(api.getSettings).toHaveBeenCalledTimes(2)
    view.unmount(); expect(release).toHaveBeenCalledOnce()
  })
  it('ASIO 只读驱动频率与缓冲，录音中禁用设置', async () => {
    const { api, state } = captureFixture(); current.api = api
    state.settings.hostApi = 'ASIO'; state.effectiveSettings.hostApi = 'ASIO'
    render(<AudioCaptureSettingsForm disabled />)
    await screen.findByText('在驱动面板中修改')
    expect(screen.queryByText('独占模式')).toBeNull()
    expect(screen.getByText('首选 256 帧 · 64–2048 帧')).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开 ASIO 控制面板' }).getAttribute('aria-disabled')).toBe('true')
    expect(api.probe).not.toHaveBeenCalled()
  })
  it('已拔出的设备显示名称而非内部定位值，设备事件刷新生效提示', async () => {
    const { api, state } = captureFixture(); current.api = api
    state.settings.deviceName = '外接话筒'; state.settings.deviceOrdinal = 7
    state.notice = '设备已断开，已回退到系统默认输入'
    render(<AudioCaptureSettingsForm />)
    await screen.findByText('外接话筒（未连接）')
    expect(screen.getByText(/设备已断开，已回退/)).toBeTruthy()
    const changed = vi.mocked(api.onDevicesChanged).mock.calls[0][0]
    changed(captureInventory)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('["外接话筒",7]')).toBeNull()
  })
})
