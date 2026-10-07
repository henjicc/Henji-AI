import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { VideoEditSequenceFrameRateRequired } from '@/core/videoEdit/projectItems'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { closeVideoEditProject, listVideoEditInstances, undoVideoEdit, editVideoProject, beginVideoEditGesture, updateVideoEditGesture, finishVideoEditGesture } from './videoEditService'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { dropVideoEditInput } from './videoEditDrop'
import { importVideoEditPathsAndFolders, planVideoEditFolderImport, VideoEditPartialImportFailure } from './videoEditFolderImport'
import { cancelVideoEditImport, videoEditImportTask, subscribeVideoEditImport, type VideoEditImportProgress } from './videoEditImportTask'
import { useSettingsStore } from '@/stores/settingsStore'
import { readVideoEditData } from './videoEditReflection'
import { createApplicationHarness } from '@/tests/applicationHarness'

const rateMetrics = vi.hoisted(() => ({ probedPacketCount: 256, bestGuessFrameRate: 30, frameRateIsConstant: true }))
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], UrlSource: class {},
  Input: class {
    async getPrimaryVideoTrack() { return { codec: null, displayWidth: 1920, displayHeight: 1080, canDecode: async () => true, computeFrameRateMetrics: async () => ({ ...rateMetrics }) } }
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
  Object.assign(rateMetrics, { probedPacketCount: 256, bestGuessFrameRate: 30, frameRateIsConstant: true })
  useSettingsStore.getState().setVideoEditBinsFirst(true)
  useSettingsStore.getState().setVideoEditImportFolderBins(true)
  useSettingsStore.getState().setVideoEditDuplicatePolicy('skip')
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
  expect(probing.every((value, index) => !index || value.completed >= probing[index - 1].completed)).toBe(true)
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
  expect({ ...owner.document, revision: original.revision }).toEqual(original); expect(owner.past).toHaveLength(history); expect(videoEditImportTask(owner.document.id)).toBeUndefined()
})

it('落位回调之前取消，保留已导入的素材和对应素材箱，清除仍为空的新素材箱且一步撤销', async () => {
  const owner = (await createVideoEditProject())!; const original = owner.document; const history = owner.past.length
  await expect(importVideoEditPathsAndFolders(owner.document.id, ['D:/drop/拍摄'], undefined, async candidate => {
    cancelVideoEditImport(owner.document.id); return candidate
  })).rejects.toMatchObject({ name: 'AbortError' })
  expect(owner.document.items).toHaveLength(3); expect(owner.document.bins.map(bin => bin.name)).toEqual(['拍摄', '子文件夹']); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(owner.document.id); expect({ ...owner.document, revision: original.revision }).toEqual(original)
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

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function simpleTree(paths: Record<string, string[]>): void {
  vi.mocked(getPlatform().system.fs.readDirPage).mockImplementation(async (path, options) => {
    if (options?.close) return { entries: [], realPath: path }
    if (!(path in paths)) throw new Error('ENOTDIR')
    return { realPath: path, entries: paths[path].map(name => ({ name, isDirectory: false })) }
  })
}
it.each(['unknown', 'variable'] as const)('目录拖入%s帧率视频先回滚全部批次与素材箱，确认后重新导入且只提交一步', async mode => {
  const root = resolve('fixture', mode)
  simpleTree({ [root]: Array.from({ length: 40 }, (_, index) => `${String(index).padStart(3, '0')}.mp4`) })
  Object.assign(rateMetrics, { probedPacketCount: mode === 'unknown' ? 0 : 256, frameRateIsConstant: false })
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  editVideoProject(id, document => ({ ...document, sequences: [], bins: [{ id: 'target', name: '原有素材箱' }] }))
  editVideoProject(id, document => ({ ...document, bins: [...document.bins, { id: 'redo-bin', name: '待重做素材箱' }] }))
  undoVideoEdit(id)
  const before = owner.document; const history = owner.past.length
  const future = owner.future
  const input = { kind: 'sources' as const, sources: [{ path: root }] }
  const error = await dropVideoEditInput(id, input, { frame: 0 }, 'target').catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(VideoEditSequenceFrameRateRequired)
  if (!(error instanceof VideoEditSequenceFrameRateRequired)) throw error
  expect(error.settings).toMatchObject({ width: 1920, height: 1080, binId: 'target' })
  expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history); expect(owner.future).toBe(future)
  expect(videoEditImportTask(id)).toBeUndefined()
  // Closing the confirmation performs no operation; a later confirmed retry imports the whole request.
  await dropVideoEditInput(id, input, { frame: 0 }, 'target', { sequenceSettings: { ...error.settings, frameRate: { numerator: 60, denominator: 1 } } })
  expect(owner.document.items).toHaveLength(40); expect(owner.document.media).toHaveLength(40)
  expect(owner.document.bins).toHaveLength(2); expect(owner.document.sequences[0]).toMatchObject({ frameRate: { numerator: 60, denominator: 1 }, binId: 'target' })
  expect(owner.document.sequences[0].clips).toHaveLength(40); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect({ ...owner.document, revision: before.revision }).toEqual(before)
})
it('落位要求补信息时只回滚自己的新增内容，保留其他编辑与排队导入及其撤销边界', async () => {
  const rootA = resolve('fixture', 'reject'); const rootB = resolve('fixture', 'keep')
  simpleTree({ [rootA]: ['a.mp4'], [rootB]: ['b.mp4'] })
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const history = owner.past.length
  const gate = deferred(); const error = new VideoEditSequenceFrameRateRequired({ width: 1920, height: 1080 })
  const first = importVideoEditPathsAndFolders(id, [rootA], undefined, () => { throw error }).catch((reason: unknown) => reason)
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async path => { if (path.endsWith('a.mp4')) await gate.promise; return true })
  await vi.waitFor(() => expect(owner.document.bins).toHaveLength(1))
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, name: '用户修改' })) }))
  const second = importVideoEditPathsAndFolders(id, [rootB])
  await vi.waitFor(() => expect(owner.document.bins).toHaveLength(2))
  gate.resolve(); expect(await first).toBe(error); await second
  expect(owner.document.items.map(item => item.name)).toEqual(['b.mp4'])
  expect(owner.document.media.map(media => media.name)).toEqual(['b.mp4'])
  expect(owner.document.bins.map(bin => bin.name)).toEqual(['keep'])
  expect(owner.document.sequences[0].name).toBe('用户修改'); expect(owner.past).toHaveLength(history + 2)
  undoVideoEdit(id); expect(owner.document.items).toEqual([]); expect(owner.document.bins).toEqual([])
  expect(owner.document.sequences[0].name).toBe('用户修改')
  undoVideoEdit(id); expect(owner.document.sequences[0].name).toBe('序列 1')
})
it.each(['removed', 'locked'] as const)('导入期间目标%s后原样报告落位错误，不保留本次素材和多余历史', async change => {
  const root = resolve('fixture', 'target-changed'); simpleTree({ [root]: ['a.mp4'] })
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const sequenceId = owner.activeSequenceId; const history = owner.past.length
  const gate = deferred()
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async () => { await gate.promise; return true })
  const importing = dropVideoEditInput(id, { kind: 'sources', sources: [{ path: root }] }, { frame: 0, track: 1 }, undefined, { sequenceId }).catch((reason: unknown) => reason)
  await vi.waitFor(() => expect(owner.document.bins).toHaveLength(1))
  editVideoProject(id, document => ({ ...document, sequences: change === 'removed' ? [] : document.sequences.map(sequence => ({ ...sequence, tracks: sequence.tracks.map(track => track.index === 1 ? { ...track, locked: true } : track) })) }))
  gate.resolve(); const error = await importing
  expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(VideoEditPartialImportFailure)
  expect((error as Error).message).toContain(change === 'removed' ? '原落点序列已移除' : '目标轨道已锁定')
  expect(owner.document).toMatchObject({ media: [], items: [], bins: [] }); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document.sequences[0].tracks.every(track => !track.locked)).toBe(true)
})
it('异步落位期间文档改变时回滚导入，保留期间编辑并原样报告落点改变', async () => {
  const root = resolve('fixture', 'placement-changed'); simpleTree({ [root]: ['a.mp4'] })
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const history = owner.past.length
  const error = await importVideoEditPathsAndFolders(id, [root], undefined, async candidate => {
    editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, name: '落位期间编辑' })) }))
    return candidate
  }).catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(VideoEditPartialImportFailure)
  expect((error as Error).message).toContain('导入落点已改变')
  expect(owner.document).toMatchObject({ media: [], items: [], bins: [] }); expect(owner.document.sequences[0].name).toBe('落位期间编辑')
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document.sequences[0].name).toBe('序列 1')
})
it('探测后续批次失败仍报告部分导入并保留已经导入的32项', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const history = owner.past.length
  const paths = Array.from({ length: 33 }, (_, index) => resolve('fixture', `${String(index).padStart(3, '0')}.mp4`))
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async path => path !== paths[32])
  await expect(importVideoEditPathsAndFolders(id, paths)).rejects.toMatchObject({ name: 'VideoEditPartialImportFailure', imported: 32, cancelled: false })
  expect(owner.document.items).toHaveLength(32); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document.items).toEqual([]); expect(owner.document.media).toEqual([])
})
it('等待中的目录立即建素材箱；两次拖入共用队列累加总数，分别一步撤销，助手读回整队状态', async () => {
  simpleTree({ 'D:/queue/A': ['a.mp4', 'b.mp4'], 'D:/queue/B': ['c.mp4'] })
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const history = owner.past.length
  const gate = deferred(); const progress: VideoEditImportProgress[] = []
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async path => { if (path.endsWith('a.mp4')) await gate.promise; return true })
  const first = importVideoEditPathsAndFolders(id, ['D:/queue/A'], undefined, undefined, { onProgress: value => progress.push(value) })
  await vi.waitFor(() => expect(videoEditImportTask(id)).toMatchObject({ total: 2, totalKnown: true }))
  expect(owner.document.bins.map(bin => bin.name)).toEqual(['A']); expect(owner.document.items).toEqual([])
  const second = importVideoEditPathsAndFolders(id, ['D:/queue/B'])
  await vi.waitFor(() => expect(readVideoEditData({ kind: 'video_edit.document', id }).mediaImport).toMatchObject({ queued: 1, requests: 2, total: 3, totalKnown: true }))
  expect(owner.document.bins.map(bin => bin.name)).toEqual(['A', 'B']); expect(owner.document.items).toEqual([])
  gate.resolve(); await Promise.all([first, second])
  expect(owner.document.items).toHaveLength(3); expect(owner.past).toHaveLength(history + 2)
  expect(progress.at(-1)?.total).toBe(3); expect(videoEditImportTask(id)).toBeUndefined()
  undoVideoEdit(id); expect(owner.document.items.map(item => item.name)).toEqual(['a.mp4', 'b.mp4']); expect(owner.document.bins.map(bin => bin.name)).toEqual(['A'])
  undoVideoEdit(id); expect(owner.document.items).toEqual([]); expect(owner.document.bins).toEqual([])
})
it('取消整队：活动请求与等待请求都停止，未处理文件不写入，新建空素材箱删除', async () => {
  simpleTree({ 'D:/cancel/A': ['a.mp4'], 'D:/cancel/B': ['b.mp4'] })
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const history = owner.past.length; const gate = deferred()
  const exists = vi.mocked(getPlatform().system.fs.exists).mockImplementation(async () => { await gate.promise; return true })
  const first = importVideoEditPathsAndFolders(id, ['D:/cancel/A']).catch(error => error)
  await vi.waitFor(() => expect(exists).toHaveBeenCalled())
  const second = importVideoEditPathsAndFolders(id, ['D:/cancel/B']).catch(error => error)
  await vi.waitFor(() => expect(owner.document.bins).toHaveLength(2))
  cancelVideoEditImport(id); gate.resolve()
  expect((await Promise.all([first, second])).every(error => error.name === 'AbortError')).toBe(true)
  expect(exists).not.toHaveBeenCalledWith('D:/cancel/B/b.mp4')
  expect(owner.document.items).toEqual([]); expect(owner.document.bins).toEqual([]); expect(owner.past).toHaveLength(history); expect(videoEditImportTask(id)).toBeUndefined()
})
it('分批素材即时出现；取消保留已经导入的32项，删除新建空箱，保留原有空箱，仍一步撤销', async () => {
  const paths = Array.from({ length: 64 }, (_, index) => `${String(index).padStart(3, '0')}.mp4`)
  simpleTree({ 'D:/partial': paths })
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  editVideoProject(id, document => ({ ...document, bins: [{ id: 'existing-empty', name: '原有空箱' }] }))
  const history = owner.past.length
  await expect(importVideoEditPathsAndFolders(id, ['D:/partial'], undefined, undefined, { onProgress: progress => {
    if (progress.completed > 32) { expect(owner.document.items).toHaveLength(32); cancelVideoEditImport(id) }
  } })).rejects.toMatchObject({ name: 'AbortError' })
  expect(owner.document.items).toHaveLength(32); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(id); expect(owner.document.items).toEqual([]); expect(owner.document.bins).toEqual([{ id: 'existing-empty', name: '原有空箱' }])
})
it('同一真实来源、同一父箱再次导入只补新增文件；不同父箱允许分别导入，散文件同箱也去重', async () => {
  const paths = { 'D:/repeat': ['a.mp4'] }; simpleTree(paths)
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  await importVideoEditPathsAndFolders(id, ['D:/repeat'])
  const history = owner.past.length; const bin = owner.document.bins[0]
  expect(bin.sourceFolderPath).toBe('D:/repeat')
  expect(await importVideoEditPathsAndFolders(id, ['D:/repeat'])).toMatchObject({ itemIds: [], skipped: 1 })
  expect(owner.past).toHaveLength(history); expect(owner.document.bins).toHaveLength(1); expect(owner.document.items).toHaveLength(1)
  paths['D:/repeat'].push('b.mp4')
  expect((await importVideoEditPathsAndFolders(id, ['D:/repeat'])).itemIds).toHaveLength(1)
  expect(owner.document.bins).toHaveLength(1); expect(owner.document.items).toHaveLength(2)
  expect(await importVideoEditPathsAndFolders(id, ['D:/repeat/a.mp4'], bin.id)).toMatchObject({ itemIds: [], skipped: 1 })
  editVideoProject(id, document => ({ ...document, bins: [...document.bins, { id: 'parent', name: '另一个父箱' }] }))
  await importVideoEditPathsAndFolders(id, ['D:/repeat'], 'parent')
  expect(owner.document.bins).toHaveLength(3); expect(owner.document.items).toHaveLength(4); expect(owner.document.media).toHaveLength(2)
})
it('关闭按目录建箱后平铺到目标素材箱；重复处理选择仍导入一份时复用媒体并添加素材项', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  editVideoProject(id, document => ({ ...document, bins: [{ id: 'target', name: '当前素材箱' }] }))
  useSettingsStore.getState().setVideoEditImportFolderBins(false)
  await importVideoEditPathsAndFolders(id, ['D:/drop/拍摄'], 'target')
  expect(owner.document.bins).toHaveLength(1); expect(owner.document.items.every(item => item.binId === 'target')).toBe(true)
  useSettingsStore.getState().setVideoEditDuplicatePolicy('import')
  await importVideoEditPathsAndFolders(id, ['D:/drop/拍摄/B 9.mp4'], 'target')
  expect(owner.document.items).toHaveLength(4); expect(owner.document.media).toHaveLength(3)
})
it('导入期间其他编辑有自己的撤销边界；撤销该编辑不丢后续导入文件，再撤销导入移除整个请求', async () => {
  simpleTree({ 'D:/interleaved': ['a.mp4'] })
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const history = owner.past.length; const gate = deferred()
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async () => { await gate.promise; return true })
  const importing = importVideoEditPathsAndFolders(id, ['D:/interleaved'])
  await vi.waitFor(() => expect(owner.document.bins).toHaveLength(1))
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, name: '用户修改的序列' })) }))
  gate.resolve(); await importing
  expect(owner.past).toHaveLength(history + 2); expect(owner.document.sequences[0].name).toBe('用户修改的序列')
  undoVideoEdit(id); expect(owner.document.sequences[0].name).toBe('序列 1'); expect(owner.document.items).toHaveLength(1)
  undoVideoEdit(id); expect(owner.document.items).toEqual([]); expect(owner.document.bins).toEqual([])
})

it('来源真实路径用于去重，分页游标继续使用原入口路径，不能用真实路径替换游标归属', async () => {
  const read = vi.mocked(getPlatform().system.fs.readDirPage).mockImplementation(async (path, options) => {
    if (path !== 'D:/alias' && path !== 'D:/real') throw new Error('ENOTDIR')
    if (options?.cursor && path !== 'D:/alias') throw new Error('目录读取已结束')
    return options?.cursor ? { realPath: 'D:/real', entries: [{ name: 'b.mp4', isDirectory: false }] } : { realPath: 'D:/real', entries: [{ name: 'a.mp4', isDirectory: false }], ...(path === 'D:/alias' ? { cursor: 'second-page' } : {}) }
  })
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  await importVideoEditPathsAndFolders(id, ['D:/alias'])
  expect(read).toHaveBeenCalledWith('D:/alias', { cursor: 'second-page' })
  expect(owner.document.bins[0].sourceFolderPath).toBe('D:/real'); expect(owner.document.items).toHaveLength(2)
  expect(await importVideoEditPathsAndFolders(id, ['D:/real'])).toMatchObject({ skipped: 1, itemIds: [] })
  expect(owner.document.bins).toHaveLength(1)
})
it('导入在用户参数手势结束后继续提交，调整可独立撤销而不丢已导入文件', async () => {
  simpleTree({ 'D:/gesture': ['a.mp4'] })
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const history = owner.past.length; const gate = deferred()
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async () => { await gate.promise; return true })
  const importing = importVideoEditPathsAndFolders(id, ['D:/gesture'])
  await vi.waitFor(() => expect(owner.document.bins).toHaveLength(1))
  const gesture = beginVideoEditGesture(id)
  updateVideoEditGesture(gesture, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, name: '手势改名' })) }))
  gate.resolve()
  await vi.waitFor(() => expect(videoEditImportTask(id)?.completed).toBe(1))
  expect(owner.document.items).toEqual([])
  finishVideoEditGesture(gesture); await importing
  expect(owner.document.items).toHaveLength(1); expect(owner.past).toHaveLength(history + 2)
  undoVideoEdit(id); expect(owner.document.sequences[0].name).toBe('序列 1'); expect(owner.document.items).toHaveLength(1)
  undoVideoEdit(id); expect(owner.document.bins).toEqual([]); expect(owner.document.items).toEqual([])
})
it('导入途中撤销该请求后，迟到的探测结果不会把素材或素材箱写回来', async () => {
  simpleTree({ 'D:/undo': ['a.mp4'] })
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const gate = deferred()
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async () => { await gate.promise; return true })
  const importing = importVideoEditPathsAndFolders(id, ['D:/undo']).catch(error => error)
  await vi.waitFor(() => expect(owner.document.bins).toHaveLength(1))
  undoVideoEdit(id); gate.resolve()
  expect(await importing).toBeInstanceOf(Error); expect(owner.document.bins).toEqual([]); expect(owner.document.items).toEqual([])
})
it('连续向空时间线拖入时，排队请求落进前一请求建立的首个序列，各自一步撤销', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  editVideoProject(id, document => ({ ...document, sequences: [] }))
  const gate = deferred()
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async path => { if (path.endsWith('a.mp4')) await gate.promise; return true })
  const first = dropVideoEditInput(id, { kind: 'sources', sources: [{ path: 'D:/a.mp4' }] }, { frame: 0 })
  const second = dropVideoEditInput(id, { kind: 'sources', sources: [{ path: 'D:/b.mp4' }] }, { frame: 60 })
  await vi.waitFor(() => expect(videoEditImportTask(id)?.total).toBe(2))
  gate.resolve(); await Promise.all([first, second])
  expect(owner.document.sequences).toHaveLength(1); expect(owner.document.sequences[0].clips).toHaveLength(2)
  undoVideoEdit(id); expect(owner.document.sequences[0].clips).toHaveLength(1); expect(owner.document.items).toHaveLength(1)
  undoVideoEdit(id); expect(owner.document.sequences).toEqual([]); expect(owner.document.items).toEqual([])
})
it('助手重复导入作为已跳过返回成功；取消部分导入返回真实保留事实与不可重放标记', async () => {
  simpleTree({ 'D:/assistant': Array.from({ length: 64 }, (_, index) => `${String(index).padStart(3, '0')}.mp4`) })
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue(['D:/assistant'])
  const app = createApplicationHarness(); let cancelled = false
  const stop = subscribeVideoEditImport(() => { if (!cancelled && (videoEditImportTask(id)?.completed ?? 0) > 32) { cancelled = true; cancelVideoEditImport(id) } })
  try {
    const result = await app.call('import_video_edit_folder', { documentRef: { kind: 'video_edit.document', id } })
    expect(result).toMatchObject({ ok: false, error: { details: { transaction: { replayMutation: false, effects: [expect.objectContaining({ entityType: 'video_edit.document' })] } } } })
    expect(owner.document.items).toHaveLength(32)
    stop()
    expect(await app.call('import_video_edit_folder', { documentRef: { kind: 'video_edit.document', id } })).toMatchObject({ ok: true })
    expect(owner.document.items).toHaveLength(64)
    expect(await app.call('import_video_edit_folder', { documentRef: { kind: 'video_edit.document', id } })).toMatchObject({ ok: true })
    expect(owner.document.items).toHaveLength(64)
  } finally { stop(); app.dispose() }
})
