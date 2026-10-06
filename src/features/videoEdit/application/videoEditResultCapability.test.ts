// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { Blob as NativeBlob } from 'node:buffer'
import { useImageEditorHandoffStore } from '@/features/imageEdit/store/imageEditorHandoffStore'
import { appendVideoEditClip, closeVideoEditProject, listVideoEditInstances, setVideoEditView, undoVideoEdit } from './videoEditService'
import { registerVideoEditProgramCapture } from './videoEditProgramCapture'
import { editVideoEditProgramFrame, readVideoEditImageReturn } from './videoEditFrameEdit'
import { commitVideoEditCreativeResult } from './videoEditResultTarget'
vi.mock('@/features/navigation/application/surfaceNavigationService', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), openApplicationSurface: vi.fn(() => ({ status: 'opened' })) }))
import { planVideoEditSend, sendCreativeResultToVideoEdit } from './videoEditResultSend'
import { createLegacyTrackVideoEditProject } from './videoEditDocumentTestKit'

// Only the producer (generation history) and native I/O are replaced; the public
// registry, permissions, transfer, library collection and project save are real.
const generation = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/features/generation/application/generationResultSource', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), readGenerationResultMedia: generation.read }))
vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class {
  async getPrimaryVideoTrack() { return null } async getPrimaryAudioTrack() { return null } async computeDuration() { return 0 } dispose() {}
} }))
const files = new Map<string, string>(); const assets = new Map<string, AssetRecord>()
const content = { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'c'.repeat(64) }
beforeEach(() => {
  installHarnessNativeStorage(); files.clear(); assets.clear()
  generation.read.mockReset().mockResolvedValue({ mediaType: 'image', source: 'D:/generated/poster.png', name: '海报' })
  const platform = getPlatform()
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/place.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockImplementation(async (path, text) => { files.set(path, text) })
  vi.spyOn(platform.system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/generated')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue(content)
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => {
    const existing = [...assets.values()].find(asset => asset.filePath === input.filePath); if (existing) return existing
    const value: AssetRecord = { id: `asset-${assets.size + 1}`, filePath: input.filePath, mediaType: input.mediaType, displayName: input.displayName ?? '结果', displayUrl: '', source: input.source, mimeType: 'image/png', ...content, width: 3840, height: 2160, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: input.libraryIds ?? [] }
    assets.set(value.id, value); return value
  })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => structuredClone(assets.get(id)!))
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('公共能力与界面发送走同一固定目标事务：落点、来源、资产与一次撤销一致', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const sequence = owner.document.sequences[0]
  const track = sequence.tracks.find(track => track.kind === 'video')!
  const app = createApplicationHarness()
  try {
    const placed = await app.requireResult('place_video_edit_creative_result', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }, placement: { mode: 'add', frame: 12, trackRef: { kind: 'video_edit.track', id: `${id}:${track.id}` }, durationFrames: 20 }, result: { type: 'generation', resultRef: { kind: 'generation.result', id: 'history-7' }, outputIndex: 0 } })
    const clipId = String((placed.resultRef as { id: string }).id).slice(id.length + 1)
    expect(placed.verification).toMatchObject({ verified: true }); expect(placed.assetRef).toEqual({ kind: 'asset', id: 'asset-1' })
    expect(owner.document.sequences[0].clips.find(clip => clip.id === clipId)).toMatchObject({ start: 12, duration: 20, track: track.index, creativeSource: { type: 'generation', recordId: 'history-7', outputIndex: 0 } })
    expect(generation.read).toHaveBeenCalledWith('history-7', undefined, { outputIndex: 0, localOnly: true })

    // UI path: the plan shows where it will land; replacing the selected clip keeps its slot.
    setVideoEditView(id, { selection: clipId })
    const plan = planVideoEditSend({ mediaKind: 'image', mode: 'replace' })
    expect(plan).toMatchObject({ available: true, placement: { mode: 'replace', clipId } })
    generation.read.mockResolvedValue({ mediaType: 'image', source: 'D:/generated/second.png', name: '第二张' })
    const receipt = await sendCreativeResultToVideoEdit({ type: 'generation', recordId: 'history-8', outputIndex: 0 }, { mediaKind: 'image', mode: 'replace' })
    expect(receipt).toMatchObject({ clipId, assetId: 'asset-2', verified: true })
    expect(owner.document.sequences[0].clips).toHaveLength(1)
    expect(owner.document.sequences[0].clips[0]).toMatchObject({ id: clipId, start: 12, duration: 20, creativeSource: { recordId: 'history-8' } })
    expect(planVideoEditSend({ mediaKind: 'audio', mode: 'replace' })).toMatchObject({ available: false, reason: expect.stringContaining('不是声音片段') })
    undoVideoEdit(id); expect(owner.document.sequences[0].clips[0].creativeSource).toMatchObject({ recordId: 'history-7' })

    // 回到来源（4.1）：公共入口与时间线右键同一条路，生成记录来源打开生成页
    const source = await app.requireResult('open_video_edit_clip_source', { documentRef: { kind: 'video_edit.document', id }, clipRef: { kind: 'video_edit.clip', id: `${id}:${clipId}` } }) as { status: string; sourceType: string; verification: { verified: boolean } }
    expect(source).toMatchObject({ status: 'opened', sourceType: 'generation', verification: { verified: true } })
    generation.read.mockResolvedValueOnce(null)
    const gone = await app.requireResult('open_video_edit_clip_source', { documentRef: { kind: 'video_edit.document', id }, clipRef: { kind: 'video_edit.clip', id: `${id}:${clipId}` } }) as { status: string; message: string }
    expect(gone).toMatchObject({ status: 'missing' }); expect(gone.message).toContain('已被删除')

    const otherProject = (await createLegacyTrackVideoEditProject())
    const forged = await app.call('place_video_edit_creative_result', { documentRef: { kind: 'video_edit.document', id }, sequenceRef: { kind: 'video_edit.sequence', id: `${otherProject.document.id}:${otherProject.document.sequences[0].id}` }, placement: { mode: 'replace', clipRef: { kind: 'video_edit.clip', id: `${id}:${clipId}` } }, result: { type: 'generation', resultRef: { kind: 'generation.result', id: 'history-9' }, outputIndex: 0 } })
    expect(JSON.stringify(forged)).toContain('必须属于目标剪辑')
    expect(owner.document.sequences[0].clips[0].creativeSource).toMatchObject({ recordId: 'history-7' })
  } finally { app.dispose() }
})

it('编辑当前帧先固定上方空画面轨道，再出帧交给图片编辑；回填落到原帧上方', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const sequence = owner.document.sequences[0]
  const lowest = sequence.tracks.filter(track => track.kind === 'video').sort((a, b) => a.index - b.index)[0]
  appendVideoEditClip(id, undefined, { frame: 0, track: lowest.index })
  setVideoEditView(id, { frame: 30, playing: false })
  const unregister = registerVideoEditProgramCapture(owner, sequence.id, async () => new NativeBlob(['png'], { type: 'image/png' }) as unknown as Blob)
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValue('D:/frames/frame-30.png')
  vi.mocked(getPlatform().system.fs.exists).mockResolvedValue(false)
  vi.spyOn(getPlatform().system.fs, 'writeFile').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue(content)
  try {
    const sessionRef = (await editVideoEditProgramFrame(id))!
    expect(useImageEditorHandoffStore.getState().pending).toMatchObject({ sessionRef, sourceUrl: 'D:/frames/frame-30.png' })
    const bound = readVideoEditImageReturn(sessionRef)!
    expect(bound.label).toContain('00:00:01:00')
    setVideoEditView(id, { frame: 0 })
    const asset = await getPlatform().assetLibrary.createAsset({ filePath: 'D:/managed/edited.png', mediaType: 'image', source: 'canvas' })
    const receipt = await commitVideoEditCreativeResult(bound.target, { asset, origin: { type: 'document', docRef: { docId: 'doc', path: 'D:/作品/图片文档/doc.henjiimg' }, revision: 1 } })
    const placed = owner.document.sequences[0].clips.find(clip => clip.id === receipt.clipId)!
    expect(placed.start).toBe(30); expect(placed.track).toBeGreaterThan(lowest.index)
  } finally { unregister() }
})
