import { expect, it, vi } from 'vitest'

const blocker = vi.hoisted(() => {
  const started = new Set<number>()
  let next = 0
  return { started, start: vi.fn(() => { started.add(++next); return next }), stop: vi.fn((id: number) => { started.delete(id) }), isStarted: (id: number) => started.has(id) }
})
vi.mock('electron', () => ({ powerSaveBlocker: blocker }))
vi.mock('./logging', () => ({ createMainLogger: () => ({ info: vi.fn() }) }))
import { holdRecordingWakeLock } from './recording-power'

it('录音与录屏同时进行时共用一个睡眠阻止，最后一路结束才释放，重复释放不影响别的录制', () => {
  const audio = holdRecordingWakeLock('音频编辑录音')
  const screen = holdRecordingWakeLock('录屏')
  expect(blocker.start).toHaveBeenCalledOnce()
  expect(blocker.start).toHaveBeenCalledWith('prevent-app-suspension')
  audio(); audio()
  expect(blocker.stop).not.toHaveBeenCalled()
  expect(blocker.started.size).toBe(1)
  screen()
  expect(blocker.stop).toHaveBeenCalledOnce()
  expect(blocker.started.size).toBe(0)
  holdRecordingWakeLock('音频编辑录音')()
  expect(blocker.start).toHaveBeenCalledTimes(2)
  expect(blocker.stop).toHaveBeenCalledTimes(2)
})
