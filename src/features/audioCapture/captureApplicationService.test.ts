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
  it('切换与关闭直接停止并保留恢复文件，不要求二次确认', async () => {
    const { api } = captureFixture(); dependencies.api = api
    dependencies.confirm.mockResolvedValue(false)
    const session = getAudioCaptureSession()
    await session.open(); await session.start()
    const proceed = vi.fn()
    expect(allowNavigation({ workspace: 'tools', toolId: 'audioEdit' }, proceed)).toBe(true)
    expect(allowNavigation({ workspace: 'tools', toolId: null }, proceed)).toBe(false)
    await vi.waitFor(() => expect(proceed).toHaveBeenCalledOnce())
    expect(dependencies.confirm).not.toHaveBeenCalled()
    expect(api.trashFile).not.toHaveBeenCalled()
    await session.discard()
    expect(api.trashFile).toHaveBeenCalledOnce()
    await session.open(); await session.start()
    await runApplicationCloseGuards()
    expect(api.stop).toHaveBeenCalledTimes(2)
    expect(dependencies.confirm).not.toHaveBeenCalled()
    expect(api.completeFile).not.toHaveBeenCalled()
    expect(session.store.getState().visible).toBe(false)
  })
})
