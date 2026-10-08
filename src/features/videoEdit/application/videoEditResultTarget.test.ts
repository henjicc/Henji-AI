import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { videoEditNativeMediaProbe } from './videoEditMediaProbe'
import { getPlatform } from '@/platform/runtime'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import path from 'node:path'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditSequence } from '@/core/videoEdit/document'
import { listVideoEditInstances, closeVideoEditProject, editVideoProject, switchVideoEditSequence, undoVideoEdit, saveVideoEdit, subscribeVideoEditDomain } from './videoEditService'
import { VideoEditCollectionExecutor } from './videoEditExecutors'
import { captureVideoEditResultTarget, commitVideoEditCreativeResult, type VideoEditCreativeResult } from './videoEditResultTarget'
import { VIDEO_EDIT_FIELDS } from './videoEditFields'
import { reopenVideoEdit, replaceSavedVideoEdit } from './videoEditDocumentTestKit'
import { harnessDocumentStore } from '@/tests/harnessNativeStorage'

const mediaMode = vi.hoisted(() => ({ video: false }))
vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class {
  async getPrimaryVideoTrack() { return mediaMode.video ? { displayWidth: 3840, displayHeight: 2160, canDecode: async () => true, computeFrameRateMetrics: async () => ({ probedPacketCount: 256, bestGuessFrameRate: 30, frameRateIsConstant: true }) } : null }
  async getPrimaryAudioTrack() { return { canDecode: async () => true } }
  async getAudioTracks() { return [{ numberOfChannels: 2, sampleRate: 48000 }] }
  async computeDuration() { return 3 }
  dispose() {}
} }))
const files = new Map<string, string>()
const origin = { type: 'generation' as const, recordId: 'generation-1', outputIndex: 0 }
function asset(patch: Partial<AssetRecord> = {}): AssetRecord {
  return { id: 'finished-image', mediaType: 'image', displayName: '生成原图', filePath: 'D:/results/source.png', displayUrl: 'henji-media://local/result', source: 'generated', mimeType: 'image/png', sizeBytes: 1024, width: 3840, height: 2160, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [], ...patch }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
beforeEach(() => {
  installHarnessNativeStorage(); files.clear(); mediaMode.video = false
  // 测试环境没有原生解码服务：按“不可用”走后备探测，而不是让替身抛错再记一条探测异常。
  vi.spyOn(videoEditNativeMediaProbe, 'forcedBackend').mockResolvedValue(undefined)
  vi.spyOn(videoEditNativeMediaProbe, 'probe').mockResolvedValue({ status: 'unavailable' })
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/result-target.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, text) => { files.set(path, text) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/results')
  vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue(asset())
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
async function setup() {
  const owner = (await createVideoEditProject())!; const sequence = owner.document.sequences[0]
  return { owner, sequence, target: captureVideoEditResultTarget(owner.document.id, sequence.id, { mode: 'add', frame: 30, duration: 60, trackId: sequence.tracks.find(track => track.kind === 'video')!.id }), result: { asset: asset(), origin } satisfies VideoEditCreativeResult }
}

it('切序列与选区后仍回原序列：一次媒体/片段历史、固定来源、保存重开和重复回执', async () => {
  const { owner, result } = await setup(); const first = owner.document.sequences[0]; const other = createVideoEditSequence('另一序列')
  editVideoProject(owner.document.id, doc => ({ ...doc, sequences: [...doc.sequences, other] }))
  const target = captureVideoEditResultTarget(owner.document.id, first.id, { mode: 'add', frame: 30, duration: 60, trackId: first.tracks.find(track => track.kind === 'video')!.id })
  const pending = deferred<AssetRecord>(); vi.mocked(getPlatform().assetLibrary.inspectAsset).mockReturnValueOnce(pending.promise)
  const history = owner.past.length; const operation = commitVideoEditCreativeResult(target, result)
  switchVideoEditSequence(owner.document.id, other.id); pending.resolve(asset())
  const receipt = await operation
  expect(receipt.verified).toBe(true); expect(owner.activeSequenceId).toBe(other.id); expect(owner.past).toHaveLength(history + 1)
  expect(owner.document.sequences[0].clips[0]).toMatchObject({ start: 30, duration: 60, creativeSource: origin })
  expect(owner.document.sequences[1].clips).toHaveLength(0)
  expect(await commitVideoEditCreativeResult(target, result)).toEqual(receipt); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(owner.document.id); expect(owner.document.media).toHaveLength(0); expect(owner.document.items).toHaveLength(0)
  undoVideoEdit(owner.document.id, true); await saveVideoEdit(owner.document.id)
  const reopened = await reopenVideoEdit(owner.document.id)
  expect(reopened.document.sequences[0].clips[0].creativeSource).toEqual(origin)
  await expect(commitVideoEditCreativeResult(target, result)).rejects.toThrow('已关闭')
})

it('开始前已修改与读取中修改均拒绝迟到回填，既有修改不丢失', async () => {
  const { owner, target, result } = await setup()
  editVideoProject(owner.document.id, doc => ({ ...doc, sequences: doc.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '新修改' }) }))
  await expect(commitVideoEditCreativeResult(target, result)).rejects.toThrow('已有修改')
  const next = captureVideoEditResultTarget(owner.document.id, owner.activeSequenceId, { mode: 'add', frame: 0, trackId: owner.document.sequences[0].tracks[0].id })
  const pending = deferred<AssetRecord>(); vi.mocked(getPlatform().assetLibrary.inspectAsset).mockReturnValueOnce(pending.promise)
  const operation = commitVideoEditCreativeResult(next, result); const rejected = expect(operation).rejects.toThrow('已有修改')
  editVideoProject(owner.document.id, doc => ({ ...doc, sequences: doc.sequences.map((sequence, index) => index ? sequence : { ...sequence, name: '读取中又修改' }) })); pending.resolve(asset()); await rejected
  expect(owner.document.sequences[0].name).toBe('读取中又修改'); expect(owner.document.media).toHaveLength(0)
})

it('资产重新定位或内容身份变化不能替换原结果；取消不创建历史', async () => {
  const { owner, target, result } = await setup()
  vi.mocked(getPlatform().assetLibrary.inspectAsset).mockResolvedValue(asset({ filePath: 'D:/results/other.png' }))
  await expect(commitVideoEditCreativeResult(target, result)).rejects.toThrow('已改变')
  expect(owner.past).toHaveLength(0); expect(owner.document.items).toHaveLength(0)
  vi.mocked(getPlatform().assetLibrary.inspectAsset).mockResolvedValueOnce(asset()).mockResolvedValue(asset({ contentIdentity: 'b'.repeat(64) }))
  await expect(commitVideoEditCreativeResult(target, result)).rejects.toThrow('已改变')
  const controller = new AbortController(); controller.abort(new Error('取消回填'))
  await expect(commitVideoEditCreativeResult(target, result, controller.signal)).rejects.toThrow('取消回填')
  expect(owner.past).toHaveLength(0)
})

it('保存失败后重试只保存，不重复导入、字幕或历史', async () => {
  const { owner, target, result } = await setup()
  harnessDocumentStore().failSaves = 1
  await expect(commitVideoEditCreativeResult(target, result)).rejects.toMatchObject({ name: 'ApplicationPersistenceFailure',
    facts: { memoryState: 'modified', persistenceState: 'unconfirmed', recovery: { capabilityId: 'save_video_edit', replayMutation: false } } })
  expect(owner.document.sequences[0].clips).toHaveLength(1); expect(owner.past).toHaveLength(1)
  const calls = vi.mocked(getPlatform().assetLibrary.inspectAsset).mock.calls.length
  expect((await commitVideoEditCreativeResult(target, result)).verified).toBe(true)
  expect(owner.past).toHaveLength(1); expect(vi.mocked(getPlatform().assetLibrary.inspectAsset).mock.calls).toHaveLength(calls)
})

it('替换保留原时间/画面与节目字幕锚点，原文件和旧素材项保留', async () => {
  const { owner, target, result } = await setup(); const first = await commitVideoEditCreativeResult(target, result)
  editVideoProject(owner.document.id, doc => ({ ...doc, sequences: doc.sequences.map(seq => ({ ...seq, clips: seq.clips.map(clip => ({ ...clip, x: .4, sourceInUs: 1_000_000 })), captions: [{ id: 'old-caption', clipId: first.clipId, start: 31, duration: 5, text: '保留节目位置' }] })) }))
  const replacement = captureVideoEditResultTarget(owner.document.id, owner.activeSequenceId, { mode: 'replace', clipId: first.clipId })
  const nextAsset = asset({ id: 'next-image', filePath: 'D:/results/next.png', contentIdentity: 'b'.repeat(64) }); vi.mocked(getPlatform().assetLibrary.inspectAsset).mockResolvedValue(nextAsset)
  await commitVideoEditCreativeResult(replacement, { asset: nextAsset, origin: { ...origin, outputIndex: 1 } })
  expect(owner.document.sequences[0].clips[0]).toMatchObject({ id: first.clipId, start: 30, duration: 60, x: .4, sourceInUs: 0, creativeSource: { outputIndex: 1 } })
  expect(owner.document.sequences[0].captions?.[0]).toMatchObject({ start: 31, duration: 5 })
  expect(owner.document.media.map(media => media.path)).toEqual(['D:/results/source.png', 'D:/results/next.png'])
})

it('口播字幕按输出秒换算到序列帧并与音频同事务，错误字幕零提交', async () => {
  const { owner } = await setup(); const sequence = owner.document.sequences[0]; const audioAsset = asset({ id: 'audio', mediaType: 'audio', filePath: 'D:/results/audio.wav', width: 0, height: 0, durationSeconds: 3 })
  vi.mocked(getPlatform().assetLibrary.inspectAsset).mockResolvedValue(audioAsset)
  const target = captureVideoEditResultTarget(owner.document.id, sequence.id, { mode: 'add', frame: 30, trackId: sequence.tracks.find(track => track.kind === 'audio')!.id })
  const origin = { type: 'document' as const, docRef: { docId: 'voice', path: 'D:/作品/口播/voice.henji-audio' }, revision: 1 }
  await expect(commitVideoEditCreativeResult(target, { asset: audioAsset, origin, captions: '1\n00:00:00,000 --> 00:00:08,000\n超长\n' })).rejects.toThrow('字幕范围')
  expect(owner.past).toHaveLength(0)
  const receipt = await commitVideoEditCreativeResult(target, { asset: audioAsset, origin, captions: '1\n00:00:00,500 --> 00:00:01,000\n剪后字幕\n' })
  expect(owner.past).toHaveLength(1); expect(owner.document.sequences[0].captions?.[0]).toMatchObject({ clipId: receipt.clipId, start: 45, duration: 15, text: '剪后字幕' })
  undoVideoEdit(owner.document.id); expect(owner.document.media).toHaveLength(0); expect(owner.document.sequences[0].captions ?? []).toHaveLength(0)
})

it('已拆分的纯画面片段替换为有声视频仍只用画面，完成来源不公开写入器', async () => {
  const { owner, target } = await setup(); mediaMode.video = true
  const original = asset({ mediaType: 'video', filePath: 'D:/results/source.mp4', durationSeconds: 3 })
  vi.mocked(getPlatform().assetLibrary.inspectAsset).mockResolvedValue(original)
  const first = await commitVideoEditCreativeResult(target, { asset: original, origin })
  editVideoProject(owner.document.id, doc => ({ ...doc, sequences: doc.sequences.map(seq => ({ ...seq, clips: seq.clips.map(clip => ({ ...clip, sourceComponent: 'video' as const })) })) }))
  const next = asset({ ...original, id: 'new-video', filePath: 'D:/results/new.mp4', contentIdentity: 'b'.repeat(64) }); vi.mocked(getPlatform().assetLibrary.inspectAsset).mockResolvedValue(next)
  const replacement = captureVideoEditResultTarget(owner.document.id, owner.activeSequenceId, { mode: 'replace', clipId: first.clipId })
  await commitVideoEditCreativeResult(replacement, { asset: next, origin: { ...origin, outputIndex: 2 } })
  expect(owner.document.sequences[0].clips[0].sourceComponent).toBe('video')
  const field = VIDEO_EDIT_FIELDS['video_edit.clip'].find(field => field.propertyId === 'video_edit.clip.creative_source')!
  expect(field.writer).toBeUndefined(); expect(field.read({})).toBeNull()
})

it('发布订阅者立即撤销时不返回不存在片段的已核实回执，也不重复回填', async () => {
  const { owner, target, result } = await setup(); let undone = false
  const stop = subscribeVideoEditDomain(() => { if (!undone && owner.document.sequences[0].clips.length) { undone = true; undoVideoEdit(owner.document.id) } })
  try { await expect(commitVideoEditCreativeResult(target, result)).rejects.toThrow('后续修改') } finally { stop() }
  expect(undone).toBe(true); expect(owner.document.sequences[0].clips).toHaveLength(0); expect(owner.past).toHaveLength(0)
  await expect(commitVideoEditCreativeResult(target, result)).rejects.toThrow('已有修改'); expect(owner.document.sequences[0].clips).toHaveLength(0)
})

it('同一资产替换重置源入点时字幕与标记仍保持节目位置', async () => {
  const { owner, target, result } = await setup(); const first = await commitVideoEditCreativeResult(target, result)
  editVideoProject(owner.document.id, doc => ({ ...doc, sequences: doc.sequences.map(seq => ({ ...seq, clips: seq.clips.map(clip => ({ ...clip, sourceInUs: 500_000 })), markers: [{ id: 'mark', frame: 40, name: '节拍', clipId: first.clipId }], captions: [{ id: 'cap', clipId: first.clipId, start: 35, duration: 10, text: '原位置' }] })) }))
  const replacement = captureVideoEditResultTarget(owner.document.id, owner.activeSequenceId, { mode: 'replace', clipId: first.clipId })
  await commitVideoEditCreativeResult(replacement, { ...result, origin: { ...origin, outputIndex: 3 } })
  const sequence = owner.document.sequences[0]
  expect(owner.document.items).toHaveLength(1); expect(sequence.clips[0]).toMatchObject({ id: first.clipId, sourceInUs: 0, creativeSource: { outputIndex: 3 } })
  expect(sequence.captions?.[0]).toMatchObject({ start: 35, duration: 10 }); expect(sequence.markers?.[0]).toMatchObject({ frame: 40 })
})

it('公共创建与属性修改都不能伪造创作来源', async () => {
  const { owner, target, result } = await setup(); const receipt = await commitVideoEditCreativeResult(target, result)
  const executor = new VideoEditCollectionExecutor('video_edit.clip'); const id = owner.document.id; const sequenceId = owner.document.sequences[0].id
  const item = owner.document.items[0]
  await expect(executor.apply({ kind: 'collection', entityType: executor.entityType, parent: { kind: 'video_edit.sequence', id: `${id}:${sequenceId}` }, expectedRevisions: {}, operation: { kind: 'create', items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.name': '伪造', 'video_edit.clip.kind': 'image', 'video_edit.clip.creative_source': { kind: 'generation.result', id: 'fake', version: 'fake' } } }] } })).rejects.toThrow('仅接受已公开')
  const field = VIDEO_EDIT_FIELDS['video_edit.clip'].find(field => field.propertyId === 'video_edit.clip.creative_source')!
  expect(field.writer).toBeUndefined(); expect(owner.document.sequences[0].clips.find(clip => clip.id === receipt.clipId)?.creativeSource).toEqual(origin)
})

it('损坏或字段缺失的剪辑文件给出可理解的拒绝，不向界面泄露 schema 路径', async () => {
  // 文件本身读不懂（不是 JSON、外壳损坏）由主进程文档仓库拒绝；这里是外壳完好、剪辑内容缺字段
  const owner = await createVideoEditProject(); const id = owner.document.id; await closeVideoEditProject(id)
  replaceSavedVideoEdit(id, { media: [], bins: [], items: [], sequences: [{ id: 's' }] })
  const partial = reopenVideoEdit(id)
  await expect(partial).rejects.toThrow('内容格式不受当前版本支持'); await expect(partial).rejects.not.toThrow('sequences')
})

it('t88之前同版本内联源码明确提示旧开发格式，打开失败不改写原文件', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const sequences = structuredClone(owner.document.sequences)
  await closeVideoEditProject(id)
  replaceSavedVideoEdit(id, { media: [], bins: [], items: [], sequences, codeMaterials: [{ id: 'old-code', name: '旧代码', defaultVersionId: 'old-version', versions: [{ id: 'old-version', apiVersion: 1, languageVersion: 3, source: 'export default {}' }] }] })
  const original = structuredClone(harnessDocumentStore().stored(id))
  const failure = reopenVideoEdit(id)
  await expect(failure).rejects.toThrow('这份剪辑是旧版本格式，当前开发版不再支持打开')
  await expect(failure).rejects.not.toThrow('损坏')
  expect(harnessDocumentStore().stored(id)).toEqual(original)
})

it('素材面板只新增素材，回执可读回；重复发送与撤销不产生片段或多余历史', async () => {
  const { owner, result, sequence } = await setup()
  const target = captureVideoEditResultTarget(owner.document.id, sequence.id, { mode: 'library' })
  const receipt = await commitVideoEditCreativeResult(target, { asset: result.asset })
  expect(receipt).toMatchObject({ itemId: owner.document.items[0].id, verified: true })
  expect(owner.document.media[0]).toMatchObject({ assetId: result.asset.id, assetContent: { contentIdentity: result.asset.contentIdentity } })
  expect(owner.document.sequences[0].clips).toHaveLength(0)
  expect(await commitVideoEditCreativeResult(target, { asset: result.asset })).toEqual(receipt)
  expect(owner.past).toHaveLength(1)
  undoVideoEdit(owner.document.id)
  expect(owner.document.items).toHaveLength(0); expect(owner.document.media).toHaveLength(0)
})

it.each(['overwrite', 'insert'] as const)('%s 复用时间线裁切/插入，并在同一次撤销恢复媒体和原片段', async mode => {
  const { owner, target, result, sequence } = await setup()
  const first = await commitVideoEditCreativeResult(target, result)
  const before = structuredClone(owner.document)
  const nextAsset = asset({ id: 'new-image', filePath: path.resolve(path.sep, 'results', 'new.png'), contentIdentity: 'b'.repeat(64) })
  vi.mocked(getPlatform().assetLibrary.inspectAsset).mockResolvedValue(nextAsset)
  const incoming = captureVideoEditResultTarget(owner.document.id, sequence.id, { mode, frame: 40, duration: 10, trackId: sequence.tracks.find(track => track.kind === 'video')!.id })
  const past = owner.past.length
  const receipt = await commitVideoEditCreativeResult(incoming, { asset: nextAsset, origin: { ...origin, outputIndex: 2 } })
  const clips = owner.document.sequences[0].clips
  expect(clips.find(clip => clip.id === receipt.clipId)).toMatchObject({ start: 40, duration: 10, creativeSource: { outputIndex: 2 } })
  expect(clips.filter(clip => clip.id !== receipt.clipId).map(clip => [clip.start, clip.duration]).sort((a, b) => a[0] - b[0])).toEqual(mode === 'overwrite' ? [[30, 10], [50, 40]] : [[30, 10], [50, 50]])
  expect(clips.some(clip => clip.id === first.clipId)).toBe(true)
  expect(owner.past).toHaveLength(past + 1)
  undoVideoEdit(owner.document.id)
  expect(owner.document.media).toEqual(before.media); expect(owner.document.items).toEqual(before.items)
  expect(owner.document.sequences[0]).toEqual(before.sequences[0])
})
