// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import path from 'node:path'
const mock = vi.hoisted(() => ({ files: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({ clipboard: { readClipboardFiles: mock.files } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))
import { readClipboardFiles } from './clipboard'
import { resolveLargeUploadAction, useLargeUploadPromptStore } from '@/services/largeUploadPolicy'
import { useSettingsStore } from '@/stores/settingsStore'
const largePath = path.resolve(path.sep, 'media', 'large.mp4')
const initialStrategy = useSettingsStore.getState().largeUploadStrategy
afterEach(() => {
  vi.resetAllMocks()
  useLargeUploadPromptStore.setState({ queue: [] })
  useSettingsStore.setState({ largeUploadStrategy: initialStrategy })
})
it('剪贴板命令只读路径 DTO，不将大文件转换为字节或选择持久化策略', async () => {
  const entries = [{ path: largePath, mimeType: 'video/mp4', size: 2 * 1024 ** 3 }]
  mock.files.mockResolvedValue(entries)
  expect(await readClipboardFiles()).toEqual(entries)
  expect(mock.files).toHaveBeenCalledOnce()
  expect(useLargeUploadPromptStore.getState().queue).toEqual([])
})
it('现有导入策略在100MiB边界复制，大文件按复制、引用或询问设置决策', async () => {
  const file = new File([], 'large.mp4', { type: 'video/mp4' })
  useSettingsStore.setState({ largeUploadStrategy: 'ask' })
  Object.defineProperty(file, 'size', { value: 100 * 1024 ** 2, configurable: true })
  expect(await resolveLargeUploadAction(file, largePath)).toBe('copy')
  expect(useLargeUploadPromptStore.getState().queue).toHaveLength(0)
  Object.defineProperty(file, 'size', { value: 100 * 1024 ** 2 + 1 })
  for (const strategy of ['copy', 'reference'] as const) {
    useSettingsStore.setState({ largeUploadStrategy: strategy })
    expect(await resolveLargeUploadAction(file, largePath)).toBe(strategy)
  }
  useSettingsStore.setState({ largeUploadStrategy: 'ask' })
  const pending = resolveLargeUploadAction(file, largePath)
  expect(useLargeUploadPromptStore.getState().queue).toHaveLength(1)
  useLargeUploadPromptStore.getState().settleCurrent('reference', false)
  expect(await pending).toBe('reference')
})
