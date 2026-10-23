import { describe, expect, it, vi } from 'vitest'
import { captureFixture } from './captureTestFixture'
import { getAudioCaptureSession } from './captureApplicationService'
import { allowNavigation } from '@/core/applicationLifecycle/navigationGuards'
import { runApplicationCloseGuards } from '@/core/applicationLifecycle/applicationCloseGuards'

const dependencies = vi.hoisted(() => ({ api: {} as ReturnType<typeof captureFixture>['api'], confirm: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioCapture: dependencies.api }) }))
vi.mock('@/stores/alertDialogStore', () => ({ requestAlertConfirmation: dependencies.confirm }))
vi.mock('./importCapturedAudio', () => ({ importCapturedAudio: vi.fn() }))

describe('录音离开屏障接入', () => {
  it('取消工作区切换和关闭保留录音，确认关闭先停止并保留恢复文件', async () => {
    const { api } = captureFixture(); dependencies.api = api
    dependencies.confirm.mockResolvedValue(false)
    const session = getAudioCaptureSession()
    await session.open(); await session.start()
    const proceed = vi.fn()
    expect(allowNavigation({ workspace: 'tools', toolId: 'audioEdit' }, proceed)).toBe(true)
    expect(allowNavigation({ workspace: 'tools', toolId: null }, proceed)).toBe(false)
    await vi.waitFor(() => expect(dependencies.confirm).toHaveBeenCalledOnce())
    await expect(runApplicationCloseGuards()).rejects.toThrow('已取消关闭')
    expect(proceed).not.toHaveBeenCalled()
    expect(api.stop).not.toHaveBeenCalled()
    dependencies.confirm.mockResolvedValue(true)
    await runApplicationCloseGuards()
    expect(api.stop).toHaveBeenCalledOnce()
    expect(api.trashFile).not.toHaveBeenCalled()
    expect(api.completeFile).not.toHaveBeenCalled()
    expect(session.store.getState().visible).toBe(false)
  })
})
