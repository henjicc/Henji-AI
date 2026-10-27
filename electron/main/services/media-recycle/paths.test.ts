import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { canonicalPath, isWindowsNetworkPath, pathKey } from './paths'

afterEach(() => { vi.restoreAllMocks() })

it('区分 Windows 网络路径与本机设备路径', () => {
  expect(isWindowsNetworkPath('\\\\nas\\media\\a.mp4')).toBe(true)
  expect(isWindowsNetworkPath('//image.example.com/a.png')).toBe(true)
  expect(isWindowsNetworkPath('\\\\?\\C:\\media\\a.mp4')).toBe(false)
  expect(isWindowsNetworkPath('\\\\.\\pipe\\x')).toBe(false)
  expect(isWindowsNetworkPath('C:\\media\\a.mp4')).toBe(false)
  expect(isWindowsNetworkPath('/media/a.mp4')).toBe(false)
})

it.skipIf(process.platform !== 'win32')('网络路径按原样比对，不做名称解析，不占文件线程池', async () => {
  const realpath = vi.spyOn(fs, 'realpath')
  for (const value of ['//image.example.com/app/pic/a.png', '\\\\nas\\media\\a.mp4']) {
    expect(await canonicalPath(value)).toBe(pathKey(path.resolve(value)))
  }
  expect(realpath).not.toHaveBeenCalled()
})
