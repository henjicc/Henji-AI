import { describe, expect, it, vi } from 'vitest'
import { captureFixture } from './captureTestFixture'
import { getAudioCaptureSession } from './captureApplicationService'
import { allowNavigation } from '@/core/applicationLifecycle/navigationGuards'
import { runApplicationCloseGuards } from '@/core/applicationLifecycle/applicationCloseGuards'

const dependencies = vi.hoisted(() => ({ api: {} as ReturnType<typeof captureFixture>['api'], confirm: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioCapture: dependencies.api }) }))
vi.mock('@/stores/alertDialogStore', () => ({ requestAlertConfirmation: dependencies.confirm }))
vi.mock('./importCapturedAudio', () => ({ importCapturedAudio: vi.fn() }))

describe('录音放后台', () => {
  it('切换工作区、离开音频编辑都不停止录音；关闭窗口才停止并保留恢复文件，不要求二次确认', async () => {
    const { api } = captureFixture(); dependencies.api = api
    const session = getAudioCaptureSession()
    await session.open(); await session.start()
    const proceed = vi.fn()
    expect(allowNavigation({ workspace: 'tools', toolId: null }, proceed)).toBe(true)
    expect(allowNavigation({ workspace: 'videoEdit', toolId: null }, proceed)).toBe(true)
    expect(api.stop).not.toHaveBeenCalled()
    expect(session.store.getState().phase).toBe('recording')
    await runApplicationCloseGuards()
    expect(api.stop).toHaveBeenCalledOnce()
    expect(dependencies.confirm).not.toHaveBeenCalled()
    expect(api.completeFile).not.toHaveBeenCalled()
    expect(api.trashFile).not.toHaveBeenCalled()
    expect(session.store.getState().visible).toBe(false)
  })
})
