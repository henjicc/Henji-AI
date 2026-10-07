// @vitest-environment jsdom
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { useSettingsStore } from '@/stores/settingsStore'
import { createVideoEditTestProject } from './videoEditDocumentTestKit'
import { appendVideoEditMedia, beginVideoEditGesture, closeVideoEditProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, type VideoEditInstance } from './videoEditService'
import { chooseVideoEditMedia, importVideoEditSources } from './videoEditMedia'
import { chooseVideoEditFolders, importVideoEditPathsAndFolders } from './videoEditFolderImport'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { cancelVideoEditImport, subscribeVideoEditImportCompletion, videoEditImportTask, withVideoEditImportTask } from './videoEditImportTask'
import { dropVideoEditInput } from './videoEditDrop'

vi.mock('mediabunny', () => ({
  ALL_FORMATS: [], UrlSource: class {},
  Input: class {
    async getPrimaryVideoTrack() { return { codec: 'h264', displayWidth: 1920, displayHeight: 1080, canDecode: async () => true, computeFrameRateMetrics: async () => ({ probedPacketCount: 256, bestGuessFrameRate: 30, frameRateIsConstant: true }) } }
    async getPrimaryAudioTrack() { return null }
    async getAudioTracks() { return [] }
    async computeDuration() { return 2 }
    dispose() {}
  },
}))
const root = resolve('fixture', 'lifecycle')
const path = resolve(root, 'control.mp4')
let owner: VideoEditInstance
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function placeSource(): Promise<void> {
  const item = owner.document.items.find(item => item.mediaId === 'ready-source')!
  const media = owner.document.media.find(media => media.id === item.mediaId)!
  const ids = await dropVideoEditInput(owner.document.id, { kind: 'source_range', projectId: owner.document.id, itemId: item.id, sourceIdentity: JSON.stringify([media.id, media.path, media.sourceRevision ?? '']), component: 'video', inUs: 0, outUs: 1000000 }, { frame: 0, track: 1 })
  expect(ids).toHaveLength(1)
  expect(getActiveVideoEditSequence(owner).clips.some(clip => clip.itemId === item.id)).toBe(true)
}
beforeEach(async () => {
  installHarnessNativeStorage()
  useSettingsStore.getState().setVideoEditDuplicatePolicy('skip')
  useSettingsStore.getState().setVideoEditImportFolderBins(true)
  vi.spyOn(getPlatform().system.fs, 'readDirPage').mockRejectedValue(new Error('ENOTDIR'))
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue(root)
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue(undefined)
  vi.spyOn(videoEditNativeMediaProbe, 'probe').mockResolvedValue({ status: 'unavailable' })
  owner = await createVideoEditTestProject()
  appendVideoEditMedia(owner.document.id, { id: 'ready-source', name: '已有源', path: resolve(root, 'ready.mp4'), kind: 'video', width: 1920, height: 1080, durationSeconds: 2 })
})
afterEach(async () => {
  for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})

it.each(['single', 'multiple', 'dialog_cancel', 'empty_selection', 'duplicate', 'empty_sources', 'empty_folder', 'skipped', 'unreadable_folder'] as const)('%s 导入结束后队列释放，源范围和下一次文件导入均可执行', async branch => {
  const id = owner.document.id
  if (branch === 'empty_sources') await importVideoEditSources(id, [])
  else if (branch === 'empty_folder' || branch === 'skipped' || branch === 'unreadable_folder') {
    vi.mocked(getPlatform().system.fs.readDirPage).mockImplementation(async input => {
      if (input !== root) throw new Error('ENOTDIR')
      return { realPath: input, entries: branch === 'empty_folder' ? [] : [{ name: branch === 'skipped' ? 'notes.txt' : 'missing.mp4', isDirectory: false }] }
    })
    if (branch === 'unreadable_folder') vi.mocked(getPlatform().system.fs.exists).mockResolvedValue(false)
    vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue([root])
    const result = await chooseVideoEditFolders(id)
    expect(result).toMatchObject({ itemIds: [], skipped: branch === 'empty_folder' ? 0 : 1 })
  } else {
    const selection = branch === 'dialog_cancel' ? null : branch === 'empty_selection' ? [] : branch === 'multiple' ? [path, resolve(root, 'second.mp4')] : path
    vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue(selection)
    const ids = await chooseVideoEditMedia(id)
    expect(ids).toHaveLength(branch === 'dialog_cancel' || branch === 'empty_selection' ? 0 : branch === 'multiple' ? 2 : 1)
    if (branch === 'duplicate') expect(await chooseVideoEditMedia(id)).toEqual([])
  }
  expect(videoEditImportTask(id)).toBeUndefined()
  await placeSource()
  vi.mocked(getPlatform().system.fs.exists).mockResolvedValue(true)
  expect(await importVideoEditSources(id, [{ path: resolve(root, 'next.mp4') }])).toHaveLength(1)
  expect(videoEditImportTask(id)).toBeUndefined()
})

it.each(['probe', 'prepare', 'afterImport', 'cancel_enumerating', 'cancel_probing'] as const)('%s 失败也结束任务与导入组，后续源范围和文件导入可用', async branch => {
  const id = owner.document.id
  const failure = new Error('故障替身')
  if (branch === 'probe') vi.mocked(getPlatform().system.fs.exists).mockRejectedValueOnce(failure)
  if (branch === 'cancel_enumerating') vi.mocked(getPlatform().system.fs.readDirPage).mockResolvedValue({ realPath: root, entries: [{ name: 'control.mp4', isDirectory: false }] })
  const importing = importVideoEditPathsAndFolders(id, [branch === 'cancel_enumerating' ? root : path], branch === 'prepare' ? 'missing-bin' : undefined, branch === 'afterImport' ? () => { throw failure } : undefined, {
    onProgress: progress => { if (branch === `cancel_${progress.phase}`) cancelVideoEditImport(id) },
  })
  if (branch.startsWith('cancel_')) await expect(importing).rejects.toMatchObject({ name: 'AbortError' })
  else await expect(importing).rejects.toBeInstanceOf(Error)
  expect(videoEditImportTask(id)).toBeUndefined()
  await placeSource()
  expect(await importVideoEditSources(id, [{ path: resolve(root, 'recovery.mp4') }])).toHaveLength(1)
  expect(videoEditImportTask(id)).toBeUndefined()
})

it('完成通知立即发生且不等待用户确认，不阻止下一次源范围拖放', async () => {
  const notice = vi.fn(); const stop = subscribeVideoEditImportCompletion(notice)
  try {
    vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue(path)
    await chooseVideoEditMedia(owner.document.id)
    expect(notice).toHaveBeenCalledWith(owner.document.id, 1, 0)
    expect(videoEditImportTask(owner.document.id)).toBeUndefined()
    await placeSource()
  } finally { stop() }
})

it('前一次导入仍在探测时源范围直接落片段，不等待队列；导入随后正常结束', async () => {
  const gate = deferred(); const entered = deferred(); const id = owner.document.id
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async () => { entered.resolve(); await gate.promise; return true })
  const importing = importVideoEditPathsAndFolders(id, [path])
  try {
    await entered.promise; expect(videoEditImportTask(id)).toBeDefined()
    await placeSource()
  } finally { gate.resolve(); await importing }
  expect(videoEditImportTask(id)).toBeUndefined()
})

it('导入只等待参数手势，手势结束后任务释放', async () => {
  const gate = deferred(); const entered = deferred(); const id = owner.document.id
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async () => { entered.resolve(); await gate.promise; return true })
  const importing = importVideoEditPathsAndFolders(id, [path])
  await entered.promise
  const gesture = beginVideoEditGesture(id)
  gate.resolve()
  try { expect(videoEditImportTask(id)).toBeDefined() } finally { finishVideoEditGesture(gesture) }
  await importing; expect(videoEditImportTask(id)).toBeUndefined(); await placeSource()
})

it('关闭剪辑取消活动与等待请求，旧探测返回后不会写入或留下悬空请求', async () => {
  const gate = deferred(); const entered = deferred(); const id = owner.document.id
  vi.mocked(getPlatform().system.fs.exists).mockImplementation(async () => { entered.resolve(); await gate.promise; return true })
  const first = importVideoEditPathsAndFolders(id, [path]).catch((error: unknown) => error)
  await entered.promise
  const second = importVideoEditSources(id, [{ path: resolve(root, 'queued.mp4') }]).catch((error: unknown) => error)
  const task = videoEditImportTask(id)!
  try { await closeVideoEditProject(id); expect(task.controller.signal.aborted).toBe(true) } finally { gate.resolve() }
  for (const error of await Promise.all([first, second])) expect(error).toBeInstanceOf(Error)
  expect(owner.document.items).toHaveLength(1)
})

it('任务准备、操作和清理抛错均拒绝请求且释放队列', async () => {
  const id = owner.document.id; const failure = new Error('任务阶段故障')
  for (const branch of ['prepare', 'operation', 'cleanup']) {
    await expect(withVideoEditImportTask(id, undefined, async () => { if (branch === 'operation') throw failure; return 1 }, {
      prepare: async () => { if (branch === 'prepare') throw failure },
      cleanup: () => { if (branch === 'cleanup') throw failure },
    })).rejects.toBe(failure)
    expect(videoEditImportTask(id)).toBeUndefined()
  }
  await placeSource()
})
