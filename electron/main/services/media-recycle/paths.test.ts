import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { canonicalPath, createPathCanonicalizer, isWindowsNetworkPath, pathKey } from './paths'

afterEach(() => { vi.restoreAllMocks() })

it('一万余条重复及缺失引用复用本轮解析，下一轮重新读取路径', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-reference-paths-'))
  try {
    const missing = path.join(root, 'missing', 'file.png')
    const realpath = vi.spyOn(fs, 'realpath')
    const resolve = createPathCanonicalizer()
    const keys = await Promise.all(Array.from({ length: 11_263 }, () => resolve(missing)))
    expect(new Set(keys)).toEqual(new Set([pathKey(missing)]))
    expect(realpath.mock.calls.filter(([file]) => file === missing)).toHaveLength(1)
    expect(realpath.mock.calls.filter(([file]) => file === root)).toHaveLength(1)
    await createPathCanonicalizer()(missing)
    expect(realpath.mock.calls.filter(([file]) => file === missing)).toHaveLength(2)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

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
