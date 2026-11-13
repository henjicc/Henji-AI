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
  it('摄像头预览/设备提醒与电平跟随会话；暂停与终态清除预览，旧会话不能写新会话', async () => {
    const { service, backend } = fixture()
    service.create('live', backend); await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    const status = { cameraPreview: 'data:image/jpeg;base64,YWJj', warnings: ['system-audio-silent' as const] }
    service.setTrackStatus('old', status); expect(service.snapshot()?.cameraPreview).toBeUndefined()
    service.setTrackStatus('live', status); service.setMicrophoneLevel('live', .4); expect(service.snapshot()).toMatchObject({ cameraPreview: status.cameraPreview, microphoneLevel: .4, trackWarnings: status.warnings })
    await service.command('toggle'); expect(service.snapshot()?.cameraPreview).toBeNull()
    await service.command('stop'); service.setTrackStatus('live', status); expect(service.snapshot()?.cameraPreview).toBeNull()
    await service.dispose()
  })
  it('异步设备失败不会被迟到启动回执覆盖，停止后销毁仍经过释放屏障', async () => {
    const { service, backend } = fixture(); let finish!: () => void
    backend.start.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    service.create('session', backend); await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    service.fail('session', '磁盘空间不足'); finish(); await vi.advanceTimersByTimeAsync(0)
    expect(service.snapshot()).toMatchObject({ phase: 'failed', error: '磁盘空间不足' })
    await service.command('stop'); await service.dispose()
    expect(backend.cancel).toHaveBeenCalledOnce()
  })
  it('采集失败终止钩子/媒体资源；启动迟到完成不覆盖失败状态；标记备注走同一后端', async () => {
    const { service, backend } = fixture(); let finish!: () => void
    backend.start.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    service.create('session', backend); await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    await service.captureFailed('session', new Error('disk full')); finish(); await Promise.resolve(); await Promise.resolve()
    expect(service.snapshot()?.phase).toBe('failed'); expect(backend.cancel).toHaveBeenCalledTimes(1)
    await service.dispose()
    service.create('next', backend); await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    await service.command('mark', '重点'); expect(backend.mark).toHaveBeenCalledWith(expect.any(AbortSignal), '重点')
    await expect(service.command('toggle', '错误备注')).rejects.toThrow('备注只能')
    await service.dispose()
  })
  it('无会话不注册；倒计时内预热采集、数到零才算开始，暂停不累计时长，标记与停止走同一后端', async () => {
    const { service, backend, register, unregister, released } = fixture()
    service.configureShortcuts(DEFAULT_RECORDING_SHORTCUTS); expect(register).not.toHaveBeenCalled()
    service.create('session', backend); expect(register).toHaveBeenCalledTimes(3)
    await expect(service.command('mark')).rejects.toThrow('录制过程中')
    await service.command('toggle'); expect(service.snapshot()).toMatchObject({ phase: 'countdown', countdown: 3 }); await vi.advanceTimersByTimeAsync(0); expect(backend.start).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000); expect(service.snapshot()).toMatchObject({ phase: 'countdown', countdown: 1, elapsedMs: 0 })
    await vi.advanceTimersByTimeAsync(1000); expect(backend.start).toHaveBeenCalledTimes(1); expect(service.snapshot()?.phase).toBe('recording')
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
  it('倒计时内停止：预热的采集收尾为空区间，不会在之后迟到开始', async () => {
    const { service, backend } = fixture(); const order: string[] = []
    const hooks = { ...backend, began: vi.fn(async () => { order.push('began') }), ending: vi.fn(async () => { order.push('ending') }) }
    backend.stop.mockImplementation(async () => { order.push('stop') })
    service.create('session', hooks)
    await service.command('toggle'); await vi.advanceTimersByTimeAsync(1000); await service.command('stop'); await vi.advanceTimersByTimeAsync(10000)
    expect(order).toEqual(['began', 'ending', 'stop']); expect(service.snapshot()?.phase).toBe('stopped')
    await service.dispose()
  })
  it('暂停先记下按下时刻再停采集，继续在各轨都恢复后才记下结束时刻', async () => {
    const { service, backend } = fixture(); const order: string[] = []
    backend.pause.mockImplementation(async () => { order.push('pause') }); backend.resume.mockImplementation(async () => { order.push('resume') })
    service.create('session', { ...backend, pausing: async () => { order.push('pausing') }, resumed: async () => { order.push('resumed') } })
    await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    await service.command('toggle'); await service.command('toggle')
    expect(order).toEqual(['pausing', 'pause', 'resume', 'resumed']); expect(service.snapshot()?.phase).toBe('recording')
    await service.dispose()
  })
  it('采集预热慢于倒计时：零时显示准备中而非开始计时，就绪那一刻才开始；开始时刻只记一次', async () => {
    const { service, backend } = fixture(); let finish!: () => void
    backend.start.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const began = vi.fn(async () => {}); service.create('session', { ...backend, began })
    await service.command('toggle'); await vi.advanceTimersByTimeAsync(4000)
    expect(service.snapshot()).toMatchObject({ phase: 'countdown', countdown: 0, elapsedMs: 0 }); expect(began).not.toHaveBeenCalled()
    finish(); await vi.advanceTimersByTimeAsync(0)
    expect(service.snapshot()?.phase).toBe('recording'); expect(began).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1500); expect(service.snapshot()?.elapsedMs).toBe(1500)
    await service.command('toggle'); await service.command('toggle'); expect(began).toHaveBeenCalledTimes(1)
    await service.dispose()
  })
  it('后端启动失败不显示录制并释放采集；失败后停止不再对着已释放的后端重走一遍', async () => {
    const { service, backend } = fixture(); service.create('session', backend)
    vi.mocked(backend.start).mockRejectedValueOnce(new Error('device gone'))
    await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    expect(service.snapshot()).toMatchObject({ phase: 'failed', busy: false }); expect(service.snapshot()?.error).toBeTruthy()
    expect(backend.cancel).toHaveBeenCalledTimes(1)
    await service.command('stop'); expect(backend.stop).not.toHaveBeenCalled(); expect(service.snapshot()?.phase).toBe('failed')
    await service.dispose(); expect(service.snapshot()).toBeNull()
  })
  it('停止失败不吞掉错误，随即释放采集；再按停止直接返回', async () => {
    const { service, backend } = fixture(); service.create('session', backend)
    await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    vi.mocked(backend.stop).mockRejectedValueOnce(new Error('write failed'))
    await expect(service.command('stop')).rejects.toThrow('write failed')
    expect(service.snapshot()?.phase).toBe('failed'); expect(backend.cancel).toHaveBeenCalledTimes(1)
    await service.command('stop'); expect(backend.stop).toHaveBeenCalledTimes(1)
    await service.dispose()
  })
  it('被录的来源没了：按停止同一条路收尾，快照记下原因；已停止或已失败时不再处理', async () => {
    const { service, backend } = fixture(); const order: string[] = []
    backend.stop.mockImplementation(async () => { order.push('stop') })
    service.create('session', { ...backend, ending: async () => { order.push('ending') } })
    await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    expect(service.sourceEnded('other', 'window')).toBe(false); expect(backend.stop).not.toHaveBeenCalled()
    expect(service.sourceEnded('session', 'window')).toBe(true); await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['ending', 'stop']); expect(service.snapshot()).toMatchObject({ phase: 'stopped', sourceEnded: 'window', error: null })
    expect(backend.cancel).not.toHaveBeenCalled()
    expect(service.sourceEnded('session', 'window')).toBe(false); expect(backend.stop).toHaveBeenCalledTimes(1)
    await service.dispose()
  })
  it('暂停中来源没了照样停止；正在切换状态时等它做完再停', async () => {
    const { service, backend } = fixture(); let finish!: () => void
    service.create('session', backend); await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    vi.mocked(backend.pause).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pausing = service.command('toggle'); await vi.advanceTimersByTimeAsync(0)
    expect(service.sourceEnded('session', 'display')).toBe(true); finish(); await pausing; await vi.advanceTimersByTimeAsync(0)
    expect(service.snapshot()).toMatchObject({ phase: 'stopped', sourceEnded: 'display' }); expect(backend.stop).toHaveBeenCalledTimes(1)
    await service.dispose()
  })
  it('用户已按停止、收尾未完时来源才没了：不接手、不记来源原因', async () => {
    const { service, backend } = fixture(); let finish!: () => void
    service.create('session', backend); await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    vi.mocked(backend.stop).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const stopping = service.command('stop'); await vi.advanceTimersByTimeAsync(0)
    expect(service.sourceEnded('session', 'window')).toBe(false); finish(); await stopping
    expect(service.snapshot()?.phase).toBe('stopped'); expect(service.snapshot()?.sourceEnded).toBeUndefined()
    await service.dispose()
  })
  it('来源没了触发的停止本身失败：按失败呈现，不再带来源原因', async () => {
    const { service, backend } = fixture()
    service.create('session', backend); await service.command('toggle'); await vi.advanceTimersByTimeAsync(3000)
    vi.mocked(backend.stop).mockRejectedValueOnce(new Error('write failed'))
    expect(service.sourceEnded('session', 'window')).toBe(true); await vi.advanceTimersByTimeAsync(0)
    expect(service.snapshot()?.phase).toBe('failed'); expect(service.snapshot()?.sourceEnded).toBeUndefined()
    await service.dispose()
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
