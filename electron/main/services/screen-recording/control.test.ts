import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingControlService } from './control'
import { DEFAULT_RECORDING_SHORTCUTS } from '../../../../src/core/screenRecording/contracts'

function fixture() {
  const backend = { start: vi.fn(async () => {}), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), mark: vi.fn(async () => {}), stop: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
  const register = vi.fn((_key: string, _callback: () => void): boolean => true); const unregister = vi.fn(); const released = vi.fn()
  const service = new RecordingControlService({ now: () => Date.now(), register, unregister, released, changed: vi.fn(), log: vi.fn() })
  return { service, backend, register, unregister, released }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers() })

describe('录制控制权威状态', () => {
  it('无会话不注册；倒计时后才实际启动、暂停不累计时长，标记与停止走同一后端', async () => {
    const { service, backend, register, unregister, released } = fixture()
    service.configureShortcuts(DEFAULT_RECORDING_SHORTCUTS); expect(register).not.toHaveBeenCalled()
    service.create('session', backend); expect(register).toHaveBeenCalledTimes(3)
    await expect(service.command('mark')).rejects.toThrow('录制过程中')
    await service.command('toggle'); expect(service.snapshot()?.phase).toBe('countdown'); expect(backend.start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000); expect(backend.start).toHaveBeenCalledTimes(1); expect(service.snapshot()?.phase).toBe('recording')
    await vi.advanceTimersByTimeAsync(2100); service.setMicrophoneLevel('session', .4)
    expect(service.snapshot()?.microphoneLevel).toBe(.4)
    await service.command('toggle'); expect(service.snapshot()?.phase).toBe('paused'); expect(service.snapshot()?.elapsedMs).toBe(2100)
    await vi.advanceTimersByTimeAsync(60000); expect(service.snapshot()?.elapsedMs).toBe(2100)
    await expect(service.command('mark')).rejects.toThrow('录制过程中')
    await service.command('toggle'); await vi.advanceTimersByTimeAsync(900); await service.command('mark'); await service.command('stop')
    expect(backend.mark).toHaveBeenCalledTimes(1); expect(service.snapshot()).toMatchObject({ phase: 'stopped', elapsedMs: 3000, microphoneLevel: null })
    expect(unregister).toHaveBeenCalledTimes(3); expect(released).toHaveBeenCalledTimes(1)
    await service.command('stop'); expect(backend.stop).toHaveBeenCalledTimes(1)
    await service.dispose()
  })
  it('倒计时可停止，后端启动不被调用；不存在迟到的启动', async () => {
    const { service, backend } = fixture(); service.create('session', backend)
    await service.command('toggle'); await vi.advanceTimersByTimeAsync(1000); await service.command('stop'); await vi.advanceTimersByTimeAsync(10000)
    expect(backend.start).not.toHaveBeenCalled(); expect(service.snapshot()?.phase).toBe('stopped')
    await service.dispose()
  })
  it('后端启动失败不显示录制；停止失败可重试、错误不吞掉', async () => {
    const { service, backend } = fixture(); service.create('session', backend)
    vi.mocked(backend.start).mockRejectedValueOnce(new Error('device gone'))
    await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    expect(service.snapshot()).toMatchObject({ phase: 'failed', busy: false }); expect(service.snapshot()?.error).toBeTruthy()
    vi.mocked(backend.stop).mockRejectedValueOnce(new Error('write failed'))
    await expect(service.command('stop')).rejects.toThrow('write failed'); expect(service.snapshot()?.phase).toBe('failed')
    await service.command('stop'); expect(service.snapshot()?.phase).toBe('stopped'); await service.dispose()
  })
  it('系统快捷键占用提示，只卸载本实例成功注册的键；热修改失败仍有按钮操作', async () => {
    const { service, backend, register, unregister } = fixture(); register.mockImplementation(key => key !== DEFAULT_RECORDING_SHORTCUTS.mark)
    service.create('session', backend); expect(service.snapshot()?.shortcutConflicts).toEqual(['mark'])
    expect(service.configureShortcuts({ toggle: 'Alt+F9', mark: null, stop: 'Alt+F11' })).toEqual([])
    expect(unregister.mock.calls.map(call => call[0])).toEqual([DEFAULT_RECORDING_SHORTCUTS.toggle, DEFAULT_RECORDING_SHORTCUTS.stop])
    await service.dispose(); expect(backend.cancel).toHaveBeenCalledTimes(1)
    expect(service.snapshot()).toBeNull(); await expect(service.command('stop')).rejects.toThrow('没有录制会话')
  })
  it('启动等待时停止串行收尾，重复暂停拒绝；销毁后的迟到完成不复活状态', async () => {
    const { service, backend } = fixture(); let finish!: () => void
    vi.mocked(backend.start).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    service.create('session', backend); await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    expect(service.snapshot()?.busy).toBe(true)
    await expect(service.command('toggle')).rejects.toThrow('状态正在切换')
    const stop = service.command('stop'); finish(); await stop
    expect(service.snapshot()?.phase).toBe('stopped'); expect(backend.stop).toHaveBeenCalledTimes(1)
    await service.dispose()
    vi.mocked(backend.start).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    service.create('new', backend); await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    await service.dispose(); finish(); await Promise.resolve(); await Promise.resolve()
    expect(service.snapshot()).toBeNull()
  })
})
