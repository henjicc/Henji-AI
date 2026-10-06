// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { closeVideoEditProject, createVideoEditProject, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { dropVideoEditInput } from './videoEditDrop'
import { planVideoEditFolderImport } from './videoEditFolderImport'

vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], UrlSource: class {},
  Input: class {
    async getPrimaryVideoTrack() { return { codec: null, displayWidth: 1920, displayHeight: 1080, canDecode: async () => true, computeFrameRateMetrics: async () => ({ probedPacketCount: 256, bestGuessFrameRate: 30, frameRateIsConstant: true }) } }
    async getPrimaryAudioTrack() { return null }
    async getAudioTracks() { return [] }
    async computeDuration() { return 2 }
    dispose() {}
  },
}))
const tree: Record<string, Array<{ name: string; isDirectory: boolean }>> = {
  'D:/drop/拍摄': [{ name: 'B 10.mp4', isDirectory: false }, { name: 'B 9.mp4', isDirectory: false }, { name: 'notes.txt', isDirectory: false }, { name: 'desktop.ini', isDirectory: false }, { name: '子文件夹', isDirectory: true }, { name: '空文件夹', isDirectory: true }],
  'D:/drop/拍摄/子文件夹': [{ name: 'C.mp4', isDirectory: false }, { name: 'missing.mp4', isDirectory: false }],
  'D:/drop/拍摄/空文件夹': [{ name: 'readme.md', isDirectory: false }],
}
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/drop/folders.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/drop')
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.fs, 'readDir').mockImplementation(async path => { if (!tree[path]) throw new Error('ENOTDIR'); return tree[path] })
  vi.spyOn(getPlatform().system.fs, 'exists').mockImplementation(async path => !path.includes('missing'))
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue('browser')
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('文件夹按层级建同名素材箱，散文件留在落点；不支持与读不出的文件跳过计数，系统文件不计；一次历史', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const history = owner.past.length
  let skipped = 0
  const ids = await dropVideoEditInput(id, { kind: 'sources', sources: [{ path: 'D:/drop/拍摄' }, { path: 'D:/drop/散.mp4' }] }, undefined, undefined, { onSkipped: count => { skipped = count } })
  expect(skipped).toBe(3) // notes.txt、readme.md、missing.mp4
  const bins = owner.document.bins
  const shoot = bins.find(bin => bin.name === '拍摄')!; const nested = bins.find(bin => bin.name === '子文件夹')!
  expect(shoot.parentId).toBeUndefined(); expect(nested.parentId).toBe(shoot.id); expect(bins).toHaveLength(2)
  const binOf = (name: string) => owner.document.items.find(item => item.name === name)?.binId
  expect(binOf('B 9.mp4')).toBe(shoot.id); expect(binOf('C.mp4')).toBe(nested.id); expect(binOf('散.mp4')).toBeUndefined()
  // 文件按自然顺序
  expect(owner.document.items.filter(item => item.binId === shoot.id).map(item => item.name)).toEqual(['B 9.mp4', 'B 10.mp4'])
  expect(ids).toHaveLength(4); expect(owner.past.length).toBe(history + 1)
  undoVideoEdit(id); expect(owner.document.bins).toEqual([]); expect(owner.document.items).toEqual([])
})
it('没有文件夹时保持原来的导入：散文件读不出就报错，不静默跳过', async () => {
  const owner = (await createVideoEditProject())!
  await expect(dropVideoEditInput(owner.document.id, { kind: 'sources', sources: [{ path: 'D:/drop/missing.mp4' }] })).rejects.toThrow('源文件已移动或丢失')
  expect(planVideoEditFolderImport([{ path: 'D:/x', name: 'x', files: ['D:/x/a.MOV', 'D:/x/b.psd'], folders: [] }])).toEqual({ files: [{ path: 'D:/x/a.MOV', chain: ['x'] }], unsupported: 1 })
})
