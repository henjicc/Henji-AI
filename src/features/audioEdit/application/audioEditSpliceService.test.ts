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
    return { source: { ...source, sourcePath: resultPath, audioPath: resultPath, ownership: 'managed', durationFrames: (current.source?.durationFrames ?? 0) + 1000 - (request.endFrame - request.startFrame) }, insertedFrames: 1000 }
  })
})
afterEach(async () => { await resetAudioEditProjectInstancesForTests(); setAudioEditDocumentRegistryForTests(null) })

it('通用文件插入保存结果，暂停编辑后的下一段覆盖仍可分别撤销', async () => {
  const instance = await createAudioEditDraft(source)
  await insertAudioEditFile(instance.document.id, '/take.wav', 2000)
  expect(instance.document.source.durationFrames).toBe(5000)
  expect(instance.dirty).toBe(false)
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
  expect(instance.dirty).toBe(false)
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
