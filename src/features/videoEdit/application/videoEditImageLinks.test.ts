import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { closeVideoEditProject, editVideoProject, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { captureVideoEditResultTarget, commitVideoEditCreativeResult } from './videoEditResultTarget'
import { refreshStaleVideoEditImageDocumentClips, refreshVideoEditImageDocumentClips } from './videoEditImageLinks'

/*
 * 4.1 图片文档放进剪辑保持链接：图片文档写回后，剪辑里链接它的片段换用新渲染、记下新版本，
 * 位置与变换不变，旧素材项与旧媒体移出剪辑；版本没变时不重新渲染。受管渲染与工作副本读取在边界替换。
 */

const links = vi.hoisted(() => ({ prepare: vi.fn(), load: vi.fn(), ensure: vi.fn() }))
vi.mock('./videoEditCreativeSources', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), prepareVideoEditCreativeResult: links.prepare }))
vi.mock('@/features/imageEdit/documents/imageDocumentRuntime', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), ensureImageDocumentOpenInBackground: links.ensure }))
vi.mock('@/commands/imageEditorV3', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), loadImageEditorV3Document: links.load }))

const docRef = { docId: 'poster', path: 'D:/作品/项目/短片/海报.henjiimg' }
function asset(patch: Partial<AssetRecord> = {}): AssetRecord {
  return { id: 'render-1', mediaType: 'image', displayName: '海报', filePath: 'D:/作品/项目/短片/生成结果/海报-1.png', displayUrl: '', source: 'canvas', mimeType: 'image/png', sizeBytes: 1024, width: 1920, height: 1080, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [], ...patch }
}
const assets = new Map<string, AssetRecord>()
beforeEach(() => {
  installHarnessNativeStorage(); assets.clear(); links.prepare.mockReset(); links.load.mockReset(); links.ensure.mockReset(); links.ensure.mockResolvedValue(undefined)
  for (const value of [asset(), asset({ id: 'render-2', filePath: 'D:/作品/项目/短片/生成结果/海报-2.png', contentIdentity: 'b'.repeat(64), width: 1280, height: 720 })]) assets.set(value.id, value)
  vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockImplementation(async id => structuredClone(assets.get(id)!))
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/作品/项目/短片/生成结果')
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('图片文档写回后片段换用新渲染：位置与变换保留，旧素材项和旧媒体移出；版本没变时不重新渲染', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const sequence = owner.document.sequences[0]
  const target = captureVideoEditResultTarget(id, sequence.id, { mode: 'add', frame: 15, duration: 45, trackId: sequence.tracks.find(track => track.kind === 'video')!.id })
  const placed = await commitVideoEditCreativeResult(target, { asset: asset(), origin: { type: 'document', docRef, revision: 1 } })
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, clips: value.clips.map(clip => clip.id === placed.clipId ? { ...clip, x: 0.25, scale: 0.5 } : clip) })) }))
  const before = owner.document.sequences[0].clips[0]

  links.load.mockResolvedValue({ revision: 1 })
  expect(await refreshVideoEditImageDocumentClips(id, 'poster')).toBe(0)
  expect(links.prepare).not.toHaveBeenCalled()

  links.load.mockResolvedValue({ revision: 2 })
  links.prepare.mockResolvedValue({ asset: assets.get('render-2'), origin: { type: 'document', docRef, revision: 2 } })
  expect(await refreshVideoEditImageDocumentClips(id, 'poster')).toBe(1)
  expect(links.prepare).toHaveBeenCalledWith({ type: 'document', docRef }, expect.objectContaining({ place: expect.any(Function) }))
  const after = owner.document.sequences[0].clips[0]
  expect(after).toMatchObject({ id: placed.clipId, start: 15, duration: 45, x: 0.25, scale: 0.5, creativeSource: { type: 'document', docRef, revision: 2 } })
  expect(after.itemId).not.toBe(before.itemId)
  expect(owner.document.items.map(item => item.id)).toEqual([after.itemId])
  expect(owner.document.media.map(media => media.path)).toEqual(['D:/作品/项目/短片/生成结果/海报-2.png'])

  // 一次撤销回到上一张渲染
  undoVideoEdit(id)
  expect(owner.document.sequences[0].clips[0]).toMatchObject({ itemId: before.itemId, creativeSource: { revision: 1 } })
})

it('剪辑打开时核对：文档版本没变不动；剪辑没打开期间保存过（版本更新）就重新渲染，工作副本已回收时先在后台打开', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const sequence = owner.document.sequences[0]
  const target = captureVideoEditResultTarget(id, sequence.id, { mode: 'add', frame: 0, duration: 30, trackId: sequence.tracks.find(track => track.kind === 'video')!.id })
  await commitVideoEditCreativeResult(target, { asset: asset(), origin: { type: 'document', docRef, revision: 1 } })

  links.load.mockResolvedValue({ revision: 1 })
  expect(await refreshStaleVideoEditImageDocumentClips(id)).toBe(0)
  expect(links.prepare).not.toHaveBeenCalled()
  expect(links.ensure).not.toHaveBeenCalled()

  links.load.mockResolvedValueOnce(null).mockResolvedValue({ revision: 3 })
  links.prepare.mockResolvedValue({ asset: assets.get('render-2'), origin: { type: 'document', docRef, revision: 3 } })
  expect(await refreshStaleVideoEditImageDocumentClips(id)).toBe(1)
  expect(links.ensure).toHaveBeenCalledWith('poster')
  expect(owner.document.sequences[0].clips[0]).toMatchObject({ creativeSource: { revision: 3 } })
})
