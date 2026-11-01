import { expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ on: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: ipc }))
import { registerReplayBoot } from './boot'

it('reader 独立启动、播放器后启动与释放都由同一同步入口按窗口路由', () => {
  const read = (id: number): unknown => {
    const event = { sender: { id }, returnValue: undefined as unknown }
    ipc.on.mock.calls[0][1](event, 'https://fixture.invalid/')
    return event.returnValue
  }
  const stopReader = registerReplayBoot(1, () => ({ phase: 'reader' }))
  expect(read(1)).toEqual({ phase: 'reader' })
  const stopPlayer = registerReplayBoot(2, () => ({ phase: 'bootstrap', storage: {} }))
  expect(ipc.on).toHaveBeenCalledOnce()
  expect(read(2)).toEqual({ phase: 'bootstrap', storage: {} })
  expect(read(3)).toEqual({ phase: 'none' })
  stopReader()
  expect(read(1)).toEqual({ phase: 'none' })
  expect(read(2)).toEqual({ phase: 'bootstrap', storage: {} })
  stopPlayer()
})
