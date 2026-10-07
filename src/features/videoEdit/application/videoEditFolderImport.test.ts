import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { closeVideoEditProject, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { dropVideoEditInput } from './videoEditDrop'
import { importVideoEditPathsAndFolders, planVideoEditFolderImport } from './videoEditFolderImport'
import { cancelVideoEditImport, videoEditImportTask, type VideoEditImportProgress } from './videoEditImportTask'
import { createApplicationHarness } from '@/tests/applicationHarness'

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
  'D:/drop/全空': [{ name: '下级', isDirectory: true }],
  'D:/drop/全空/下级': [],
}
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/drop/folders.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/drop')
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.fs, 'readDirPage').mockImplementation(async (path, options) => { if (options?.close) return { entries: [], realPath: path }; if (!tree[path]) throw new Error('ENOTDIR'); const offset = Number(options?.cursor ?? 0); const entries = tree[path].slice(offset, offset + 256); return { entries, realPath: path, ...(offset + entries.length < tree[path].length ? { cursor: String(offset + entries.length) } : {}) } })
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
  expect(shoot.parentId).toBeUndefined(); expect(nested.parentId).toBe(shoot.id)
  // 只有不支持文件的文件夹也建同名空素材箱（PR）
  expect(bins).toHaveLength(3); expect(bins.find(bin => bin.name === '空文件夹')!.parentId).toBe(shoot.id)
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
it('只拖入空文件夹也按 PR 建同名空素材箱（含子文件夹），一步撤销', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const history = owner.past.length
  expect(await dropVideoEditInput(id, { kind: 'sources', sources: [{ path: 'D:/drop/全空' }] })).toEqual([])
  const top = owner.document.bins.find(bin => bin.name === '全空')!
  expect(owner.document.bins.map(bin => [bin.name, bin.parentId ?? null])).toEqual([['全空', null], ['下级', top.id]])
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document.bins).toEqual([])
})

it('分页导入1200个文件和24层目录，进度递增，超过200个素材箱仍只写入一步历史', async () => {
  const root = 'D:/large'; const local: typeof tree = { [root]: Array.from({ length: 1200 }, (_, index) => ({ name: `${index}.mp4`, isDirectory: false })) }
  for (let depth = 0; depth < 24; depth++) { const path = root + '/child'.repeat(depth); local[path] ??= []; local[path].push({ name: 'child', isDirectory: true }); local[`${path}/child`] = [] }
  for (let index = 0; index < 300; index++) { local[root].push({ name: `bin${index}`, isDirectory: true }); local[`${root}/bin${index}`] = [] }
  vi.mocked(getPlatform().system.fs.readDirPage).mockImplementation(async (path, options) => {
    if (options?.close) return { entries: [], realPath: path }
    const values = local[path]; if (!values) throw new Error('ENOTDIR')
    const offset = Number(options?.cursor ?? 0); const entries = values.slice(offset, offset + 128)
    return { entries, realPath: path, ...(offset + entries.length < values.length ? { cursor: String(offset + entries.length) } : {}) }
  })
  const owner = (await createVideoEditProject())!; const history = owner.past.length
  const progress: VideoEditImportProgress[] = []
  const result = await importVideoEditPathsAndFolders(owner.document.id, [root], undefined, undefined, { onProgress: value => progress.push({ ...value }) })
  expect(result).toMatchObject({ skipped: 0 }); expect(result.itemIds).toHaveLength(1200)
  expect(owner.document.media).toHaveLength(1200); expect(owner.document.bins).toHaveLength(325); expect(owner.past).toHaveLength(history + 1)
  const probing = progress.filter(value => value.phase === 'probing')
  expect(probing.at(-1)).toMatchObject({ completed: 1200, total: 1200 })
  expect(probing.every((value, index) => !index || value.completed > probing[index - 1].completed)).toBe(true)
  expect(videoEditImportTask(owner.document.id)).toBeUndefined()
  undoVideoEdit(owner.document.id); expect(owner.document.items).toEqual([]); expect(owner.document.bins).toEqual([])
})

it('真实路径相同的联接回环和读不出的目录跳过计数，并关闭未读完的页', async () => {
  const read = vi.mocked(getPlatform().system.fs.readDirPage).mockImplementation(async (path, options) => {
    if (options?.close) return { entries: [], realPath: 'D:/loop' }
    if (path.endsWith('/denied')) throw new Error('EACCES')
    if (path.endsWith('/back')) return { realPath: 'D:/loop', cursor: 'unfinished', entries: [] }
    return { realPath: path, entries: [{ name: 'ok.mp4', isDirectory: false }, { name: 'back', isDirectory: true }, { name: 'denied', isDirectory: true }] }
  })
  const owner = (await createVideoEditProject())!
  const result = await importVideoEditPathsAndFolders(owner.document.id, ['D:/loop'])
  expect(result.skipped).toBe(2); expect(result.itemIds).toHaveLength(1); expect(owner.document.bins).toHaveLength(1)
  expect(read).toHaveBeenCalledWith('D:/loop/back', { cursor: 'unfinished', close: true })
})

it.each(['enumerating', 'probing'] as const)('在%s进度取消后没有写入或撤销步', async phase => {
  const owner = (await createVideoEditProject())!; const original = owner.document; const history = owner.past.length
  await expect(importVideoEditPathsAndFolders(owner.document.id, ['D:/drop/拍摄'], undefined, undefined, {
    onProgress: progress => { if (progress.phase === phase) cancelVideoEditImport(owner.document.id) },
  })).rejects.toMatchObject({ name: 'AbortError' })
  expect(owner.document).toBe(original); expect(owner.past).toHaveLength(history); expect(videoEditImportTask(owner.document.id)).toBeUndefined()
})

it('落位回调完成之前取消，暂存素材箱和素材全部丢弃', async () => {
  const owner = (await createVideoEditProject())!; const original = owner.document; const history = owner.past.length
  await expect(importVideoEditPathsAndFolders(owner.document.id, ['D:/drop/拍摄'], undefined, async candidate => {
    cancelVideoEditImport(owner.document.id); return candidate
  })).rejects.toMatchObject({ name: 'AbortError' })
  expect(owner.document).toBe(original); expect(owner.past).toHaveLength(history)
})

it('助手文件夹导入通过同一选择窗口、递归链路与保存回读', async () => {
  const owner = (await createVideoEditProject())!; const history = owner.past.length
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue(['D:/drop/拍摄'])
  const app = createApplicationHarness()
  try {
    expect(await app.call('import_video_edit_folder', { documentRef: { kind: 'video_edit.document', id: owner.document.id } })).toMatchObject({ ok: true })
    expect(owner.document.items).toHaveLength(3); expect(owner.document.bins).toHaveLength(3); expect(owner.past).toHaveLength(history + 1)
  } finally { app.dispose() }
})
