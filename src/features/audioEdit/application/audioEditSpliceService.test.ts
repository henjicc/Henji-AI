// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { documentKindRegistry } from '@/core/documents/kinds'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands } from '@/features/documents/documentSessionTestKit'
import { createAudioEditDraft, editAudioEditProject, flushAudioEditProject, resetAudioEditProjectInstancesForTests, setAudioEditDocumentRegistryForTests, undoAudioEditProject } from './audioEditProjectInstances'
import { insertAudioEditFile, prepareAudioEditTake, restoreAudioEditTake } from './audioEditSpliceService'
import type { AudioEditSpliceRequest } from '@/core/audioEdit/splice'
import type { AudioEditSourceMetadata } from '@/core/audioEdit/types'

const api = vi.hoisted(() => ({ splice: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ audioEdit: api }) }))
let commands: FakeDocumentCommands
const source: AudioEditSourceMetadata = { mediaType: 'audio', sourcePath: '/old.wav', audioPath: '/old.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }
beforeEach(() => {
  commands = new FakeDocumentCommands()
  setAudioEditDocumentRegistryForTests(new DocumentSessionRegistry({ commands, prompter: createScriptedPrompter(), kinds: documentKindRegistry }))
  api.splice.mockReset().mockImplementation(async (request: AudioEditSpliceRequest) => {
    const current = commands.stored(request.projectId)!.content as { source: AudioEditSourceMetadata | null }
    const resultPath = `/recordings/${request.resultId ?? request.requestId}.wav`
    return { source: { ...source, sourcePath: resultPath, audioPath: resultPath, ownership: 'managed', durationFrames: (current.source?.durationFrames ?? 0) + 1000 - (request.endFrame - request.startFrame) }, insertedFrames: 1000, ...(request.matchRecordingLoudness ? { recordingGainDb: 18 } : {}) }
  })
})
afterEach(async () => { await resetAudioEditProjectInstancesForTests(); setAudioEditDocumentRegistryForTests(null) })

it('通用文件插入保存结果，暂停编辑后的下一段覆盖仍可分别撤销', async () => {
  const instance = await createAudioEditDraft(source)
  await insertAudioEditFile(instance.document.id, '/take.wav', 2000)
  expect(instance.document.source.durationFrames).toBe(5000)
  expect(instance.dirty).toBe(false)
  expect(instance.document.gainRegions).toEqual([])
  editAudioEditProject(instance.document.id, project => ({ ...project, cuts: [{ id: 'cut', startFrame: 0, endFrame: 500, enabled: true, reason: 'manual' }] }))
  await flushAudioEditProject(instance.document.id)
  const before = instance.document
  await insertAudioEditFile(instance.document.id, '/take2.wav', 1000, 3000)
  expect(instance.document.source.durationFrames).toBe(4000)
  undoAudioEditProject(instance.document.id)
  expect(instance.document.source).toEqual(before.source)
  expect(instance.document.cuts).toEqual(before.cuts)
})

it('拼接已提交但保存失败时恢复只保存，保存成功但清登记前重试也不重放', async () => {
  const instance = await createAudioEditDraft(null)
  const placement = await prepareAudioEditTake(instance.document.id, 0, 0)
  commands.failSaves = 1
  const file = { outputPath: '/take.wav', name: 'take', placement }
  await expect(restoreAudioEditTake(file)).rejects.toThrow('磁盘已满')
  expect(instance.document.source.durationFrames).toBe(1000)
  expect(instance.dirty).toBe(true)
  await restoreAudioEditTake(file)
  await restoreAudioEditTake(file)
  expect(api.splice).toHaveBeenCalledTimes(1)
  expect(instance.past).toHaveLength(1)
  expect(instance.document.gainRegions).toEqual([expect.objectContaining({ startFrame: 0, endFrame: 1000, gainDb: 18 })])
  expect(instance.dirty).toBe(false)
})

it('录后增益只覆盖新段，原增益在插入点分开；来源和增益一次撤销重做', async () => {
  const instance = await createAudioEditDraft(source)
  editAudioEditProject(instance.document.id, project => ({ ...project, gainRegions: [{ id: 'old-gain', startFrame: 0, endFrame: 4000, gainDb: -6, enabled: true, fadeInFrames: 0, fadeOutFrames: 0 }] }))
  const before = structuredClone(instance.document)
  const placement = await prepareAudioEditTake(instance.document.id, 2000, 2000)
  const history = instance.past.length
  await restoreAudioEditTake({ outputPath: '/take.wav', name: 'take', placement })
  const after = structuredClone(instance.document)
  expect(instance.past).toHaveLength(history + 1)
  expect(after.gainRegions?.map(region => [region.startFrame, region.endFrame, region.gainDb])).toEqual([[0, 2000, -6], [3000, 5000, -6], [2000, 3000, 18]])
  expect(commands.stored(instance.document.id)!.content).toMatchObject({ gainRegions: after.gainRegions })
  undoAudioEditProject(instance.document.id)
  expect(instance.document.source).toEqual(before.source)
  expect(instance.document.gainRegions).toEqual(before.gainRegions)
  undoAudioEditProject(instance.document.id, true)
  expect(instance.document.gainRegions).toEqual(after.gainRegions)
})

it('录后测量失败不提交来源或增益，恢复仍绑定原录音', async () => {
  const instance = await createAudioEditDraft(source)
  const placement = await prepareAudioEditTake(instance.document.id, 1000, 2000)
  const before = structuredClone(instance.document), history = instance.past.length
  api.splice.mockRejectedValueOnce(new Error('响度测量失败'))
  await expect(restoreAudioEditTake({ outputPath: '/take.wav', name: 'take', placement })).rejects.toThrow('响度测量失败')
  expect(instance.document).toEqual(before)
  expect(instance.past).toHaveLength(history)
  await restoreAudioEditTake({ outputPath: '/take.wav', name: 'take', placement })
  expect(instance.document.gainRegions?.map(region => [region.startFrame, region.endFrame])).toEqual([[1000, 2000]])
})

it('恢复绑定原作品位置；作品有后续编辑时拒绝，不覆盖当前内容', async () => {
  const instance = await createAudioEditDraft(source)
  const placement = await prepareAudioEditTake(instance.document.id, 1000, 2000)
  editAudioEditProject(instance.document.id, p => ({ ...p, referenceScript: '后续编辑' }))
  await flushAudioEditProject(instance.document.id)
  await expect(restoreAudioEditTake({ name: 'take', outputPath: '/take.wav', placement })).rejects.toThrow('后续编辑')
  expect(api.splice).not.toHaveBeenCalled()
  expect(instance.document.referenceScript).toBe('后续编辑')
})
