// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { getDocumentOperations } from './documentOperations'
import { projectExportDirectory, uniqueOutputPath } from './projectOutputs'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'

beforeEach(installHarnessNativeStorage)
afterEach(() => { vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('项目里的文档默认导出到项目的“导出”文件夹；不在项目里时要求指定位置', async () => {
  vi.spyOn(getDocumentOperations(), 'findProject').mockResolvedValue({ id: 'p', path: 'E:\\文档\\项目A' } as Awaited<ReturnType<ReturnType<typeof getDocumentOperations>['findProject']>>)
  await expect(projectExportDirectory({ kind: 'project', projectId: 'p' })).resolves.toBe('E:\\文档\\项目A\\导出')
  await expect(projectExportDirectory({ kind: 'user' })).rejects.toThrow('destination')
})

it('重名加序号，同时写出的字幕已存在也换下一个序号，不覆盖已有文件', async () => {
  const fs = getPlatform().system.fs
  const existing = new Set(['D:/out/口播-剪辑.wav', 'D:/out/口播-剪辑 (2).srt'])
  vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
  vi.spyOn(fs, 'exists').mockImplementation(async (path: string) => existing.has(path))
  await expect(uniqueOutputPath('D:/out', '口播-剪辑', 'wav', ['srt'])).resolves.toBe('D:/out/口播-剪辑 (3).wav')
  await expect(uniqueOutputPath('D:/out/', '口播:剪辑', 'xml')).resolves.toBe('D:/out/口播-剪辑.xml')
})
