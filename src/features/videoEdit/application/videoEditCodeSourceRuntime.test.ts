import { expect, it, vi } from 'vitest'
import type { CodeFileReference } from '@/core/videoEdit/codeMaterial/sources'

const mocks = vi.hoisted(() => ({ install: vi.fn(), read: vi.fn() }))
vi.mock('@/core/videoEdit/codeMaterial/sources', () => ({ installCodeSourceReader: mocks.install }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({ documents: { readCodeFile: mocks.read } }) }))

import { initializeVideoEditCodeSourceRuntime } from './videoEditCodeSourceRuntime'

it('导入不安装 reader，显式重复装配只安装一次并委托当前平台读取', async () => {
  expect(mocks.install).not.toHaveBeenCalled()
  initializeVideoEditCodeSourceRuntime()
  initializeVideoEditCodeSourceRuntime()
  expect(mocks.install).toHaveBeenCalledTimes(1)
  const file = { hash: 'source-hash', location: 'source-location', path: 'main.ts' }
  mocks.read.mockResolvedValue('source')
  const reader = mocks.install.mock.calls[0][0] as (file: CodeFileReference) => Promise<string>
  expect(await reader(file)).toBe('source')
  expect(mocks.read).toHaveBeenCalledWith(file)
})
