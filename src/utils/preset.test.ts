import { expect, it, vi } from 'vitest'
import { createPreset, loadPresets } from './preset'
import { readJsonFromAppData, writeJsonToAppData } from './save/appDataJson'

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), read: vi.fn(), write: vi.fn() }))
vi.mock('@/services/presets/PresetService', () => ({ presetService: { getPresets: mocks.list, createPreset: mocks.create } }))
vi.mock('@/platform/desktopApi', () => ({ join: async (...parts: string[]) => parts.join('/'), readFile: mocks.read, writeTextFile: mocks.write }))
vi.mock('@/utils/dataPath', () => ({ getProgramDataRoot: async () => '/app-data' }))

it('预设读失败不当空库且禁止创建；JSON 仅不存在返回空，写入走原子文本入口', async () => {
  mocks.list.mockRejectedValueOnce(new Error('read denied')).mockRejectedValueOnce(new Error('read denied'))
  await expect(loadPresets()).rejects.toThrow('read denied')
  await expect(createPreset('新建', '提示词', 'prompt')).rejects.toThrow('read denied')
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.write).not.toHaveBeenCalled()

  mocks.list.mockResolvedValue([])
  mocks.create.mockImplementation(async input => ({ ...input, id: 'new', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' }))
  await expect(createPreset('新建', '提示词', 'full', { params: { width: 1024 }, imageFilePaths: ['/media/image.png'] }))
    .resolves.toMatchObject({ prompt: '提示词', params: { width: 1024 }, images: { filePaths: ['/media/image.png'] } })
  expect(mocks.create).toHaveBeenCalledOnce()

  mocks.read.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }))
  await expect(readJsonFromAppData('library.json')).resolves.toBeNull()
  mocks.read.mockRejectedValueOnce(new Error('access denied'))
  await expect(readJsonFromAppData('library.json')).rejects.toThrow('access denied')
  mocks.read.mockResolvedValueOnce(new TextEncoder().encode('{'))
  await expect(readJsonFromAppData('library.json')).rejects.toThrow()
  await writeJsonToAppData('library.json', { entries: [] })
  expect(mocks.write).toHaveBeenCalledWith('/app-data/library.json', '{"entries":[]}')
})
