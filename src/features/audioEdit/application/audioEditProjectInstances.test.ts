// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { audioEditProjectSchema } from '@/core/audioEdit/schema'
import { renderHook } from '@testing-library/react'
import { useAudioEditGestures } from '../workspace/useAudioEditGestures'
import { documentKindRegistry } from '@/core/documents/kinds'
import { audioEditProjectToDocumentContent } from '@/core/audioEdit/documentContent'
import type { AudioEditProjectDocument, AudioEditSourceMetadata } from '@/core/audioEdit/types'
import type { ApplicationPlannedStep, ApplicationPropertyMutation } from '@/core/application-control'
import { AudioEditMutationExecutor } from './audioEditMutationExecutor'
import { AUDIO_EDIT_ENTITY_TYPES } from './audioEditFields'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands, type ScriptedPrompter } from '@/features/documents/documentSessionTestKit'
import {
  acceptAudioEditNativeResult, beginAudioEditGesture, lockAudioEditRecording, assignAudioEditSource, createAudioEditDraft, editAudioEditProject, flushAudioEditProject, getAudioEditProjectInstance,
  leaveAudioEditProject, loadAudioEditProject, releaseAudioEditProject, resetAudioEditProjectInstancesForTests,
  setAudioEditDocumentRegistryForTests, undoAudioEditProject, withAudioEditProjectOperation,
} from './audioEditProjectInstances'
import { DocumentOperations } from '@/features/documents/documentOperations'
import { registerCurrentDocumentProvider } from '@/features/documents/currentDocumentContext'
import { useNavigationStore } from '@/stores/navigationStore'
import { useAudioEditStore } from '../store/audioEditStore'
import { audioEditCurrentDocument } from './applicationDomain'

/*
 * 口播文档实例（3.3）：同一份文档全局一个实例，保存全部交给通用文档会话（失败保留修改、处理前先写完），
 * 名称就是文件名，导入即建草稿、离开时空草稿直接删除、有内容的草稿询问。
 * 用内存文档仓库替身 + 正式会话登记表，不跑主进程。
 */

const source: AudioEditSourceMetadata = { mediaType: 'audio', sourcePath: 'D:/外部/录音.wav', audioPath: 'D:/外部/录音.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }
const fixture = (): AudioEditProjectDocument => ({ id: 'instance-test', name: '录音', source, transcript: [{ id: 'word', text: '你好', startFrame: 1000, endFrame: 2000, included: true, locked: true, granularity: 'word' }], referenceScript: '', suggestions: [], revision: 1, createdAt: 1, updatedAt: 1 })

let commands: FakeDocumentCommands
let prompter: ScriptedPrompter
let registry: DocumentSessionRegistry

beforeEach(() => {
  commands = new FakeDocumentCommands()
  prompter = createScriptedPrompter()
  registry = new DocumentSessionRegistry({ commands, prompter, kinds: documentKindRegistry })
  setAudioEditDocumentRegistryForTests(registry)
  commands.seed({ kind: 'audio_edit', id: 'instance-test', name: '录音', content: audioEditProjectToDocumentContent(fixture()) })
})
afterEach(async () => { await resetAudioEditProjectInstancesForTests(); setAudioEditDocumentRegistryForTests(null) })

function stored(id = 'instance-test'): Record<string, unknown> {
  return commands.stored(id)!.content as Record<string, unknown>
}

function mutationStep(entityType: typeof AUDIO_EDIT_ENTITY_TYPES.project | typeof AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, mutations: ApplicationPropertyMutation[]): Extract<ApplicationPlannedStep, { kind: 'mutation' }> {
  return { kind: 'mutation', entityType, target: { kind: entityType, id: entityType === AUDIO_EDIT_ENTITY_TYPES.project ? 'instance-test' : 'instance-test:word' }, expectedRevisions: {}, mutations }
}

it('助手撤销回执最多保留 50 项，仍保留最新回执且释放文档清除全部快照', async () => {
  const executor = new AudioEditMutationExecutor(AUDIO_EDIT_ENTITY_TYPES.project)
  const tokens: string[] = []
  for (let index = 0; index < 51; index++) {
    const result = await executor.apply(mutationStep(AUDIO_EDIT_ENTITY_TYPES.project, [{ propertyId: 'audio_edit.document.reference_script', operation: 'set', value: `${index}` }]))
    tokens.push(result.undoToken!)
  }
  await expect(executor.undo(tokens[0])).rejects.toThrow('AUDIO_EDIT_UNDO_NOT_FOUND')
  await executor.undo(tokens[50])
  expect(getAudioEditProjectInstance('instance-test')!.document.referenceScript).toBe('49')
  await releaseAudioEditProject('instance-test')
  await expect(executor.undo(tokens[49])).rejects.toThrow('AUDIO_EDIT_UNDO_NOT_FOUND')
})

it.each(['undo', 'compensate'] as const)('助手同一步删除再锁定后 %s 恢复内容和锁，普通编辑仍受锁保护', async (mode) => {
  const instance = await loadAudioEditProject('instance-test')
  editAudioEditProject('instance-test', document => ({ ...document, transcript: document.transcript.map(block => ({ ...block, locked: false })) }))
  const executor = new AudioEditMutationExecutor(AUDIO_EDIT_ENTITY_TYPES.transcriptBlock)
  const step = mutationStep(AUDIO_EDIT_ENTITY_TYPES.transcriptBlock, [
    { propertyId: 'audio_edit.transcript_block.included', operation: 'set', value: false },
    { propertyId: 'audio_edit.transcript_block.locked', operation: 'set', value: true },
  ])
  const result = await executor.apply(step)
  expect(instance.document.transcript[0]).toMatchObject({ included: false, locked: true })
  expect(() => editAudioEditProject('instance-test', document => ({ ...document, transcript: document.transcript.map(block => ({ ...block, included: true })) }))).toThrow('锁定')
  if (mode === 'undo') await executor.undo(result.undoToken!)
  else await executor.compensate(step, result)
  expect(instance.document.transcript[0]).toMatchObject({ included: true, locked: false })
  expect((stored().transcript as AudioEditProjectDocument['transcript'])[0]).toMatchObject({ included: true, locked: false })
})

it.each(['release', 'leave'] as const)('%s 清除拒绝撤销后残留的回执，关闭一份文档不影响另一份', async mode => {
  commands.seed({ kind: 'audio_edit', id: 'other', name: '另一份', content: audioEditProjectToDocumentContent({ ...fixture(), id: 'other' }) })
  const executor = new AudioEditMutationExecutor(AUDIO_EDIT_ENTITY_TYPES.project)
  const step = mutationStep(AUDIO_EDIT_ENTITY_TYPES.project, [{ propertyId: 'audio_edit.document.reference_script', operation: 'set', value: '助手修改' }])
  const result = await executor.apply(step)
  const other = await executor.apply({ ...step, target: { ...step.target, id: 'other' } })
  editAudioEditProject('instance-test', document => ({ ...document, referenceScript: '后续修改' }))
  await expect(executor.undo(result.undoToken!)).rejects.toThrow('后续修改')
  if (mode === 'release') await releaseAudioEditProject('instance-test')
  else await leaveAudioEditProject('instance-test')
  await expect(executor.undo(result.undoToken!)).rejects.toThrow('AUDIO_EDIT_UNDO_NOT_FOUND')
  await executor.undo(other.undoToken!)
  expect(getAudioEditProjectInstance('other')!.document.referenceScript).toBe('')
})

describe('口播文档实例', () => {
  it('保存失败保留修改与撤销；处理前先写完，处理期间拒绝修改', async () => {
    const instance = await loadAudioEditProject('instance-test')
    commands.failSaves = 1
    editAudioEditProject('instance-test', (document) => ({ ...document, referenceScript: '已修改' }))
    await expect(flushAudioEditProject('instance-test')).rejects.toThrow('磁盘已满')
    expect(instance.dirty).toBe(true)
    expect(instance.error).toBeTruthy()
    expect(instance.past).toHaveLength(1)
    await withAudioEditProjectOperation('instance-test', async () => {
      expect(stored().referenceScript).toBe('已修改')
      expect(() => editAudioEditProject('instance-test', (value) => ({ ...value, referenceScript: '迟到修改' }))).toThrow('等待')
    })
    expect(instance.dirty).toBe(false)
    expect(instance.error).toBeNull()
    undoAudioEditProject('instance-test')
    expect(instance.document.referenceScript).toBe('')
  })

  it('同一份文档只有一个实例；锁定的声音不能被文字或区间修改；素材不能经编辑修改', async () => {
    const [instance, again] = await Promise.all([loadAudioEditProject('instance-test'), loadAudioEditProject('instance-test')])
    expect(again).toBe(instance)
    expect(commands.calls.filter((call) => call === 'readDocument')).toHaveLength(1)
    editAudioEditProject(instance.document.id, (document) => ({ ...document, referenceScript: '真实修改' }))
    expect(() => editAudioEditProject(instance.document.id, (document) => ({ ...document, transcript: [] }))).toThrow('锁定')
    expect(() => editAudioEditProject(instance.document.id, (document) => ({ ...document, cuts: [{ id: 'manual', startFrame: 500, endFrame: 1500, enabled: true, reason: 'manual' }] }))).toThrow('锁定')
    expect(() => editAudioEditProject(instance.document.id, (document) => ({ ...document, source: { ...document.source, sourcePath: 'D:/别的.wav' } }))).toThrow('IMMUTABLE_SOURCE')
    editAudioEditProject(instance.document.id, (document) => ({ ...document, cuts: [{ id: 'manual', startFrame: 2500, endFrame: 3500, enabled: true, reason: 'manual' }] }))
    undoAudioEditProject(instance.document.id)
    expect(instance.document.cuts).toBeUndefined()
    expect(instance.document.referenceScript).toBe('真实修改')
  })

  it('显示偏好不占撤销步骤、不清重做，并写进文档文件', async () => {
    const instance = await loadAudioEditProject('instance-test')
    const id = instance.document.id
    editAudioEditProject(id, (document) => ({ ...document, cuts: [{ id: 'mute', startFrame: 2500, endFrame: 3500, mode: 'mute', enabled: true, reason: 'manual' }] }))
    editAudioEditProject(id, (document) => ({ ...document, viewSettings: { textSize: 28, sidePadding: 80, timelineCaptions: true } }))
    expect(instance.past).toHaveLength(1)
    undoAudioEditProject(id)
    expect(instance.document.cuts).toBeUndefined()
    expect(instance.document.viewSettings?.textSize).toBe(28)
    editAudioEditProject(id, (document) => ({ ...document, viewSettings: { ...document.viewSettings!, textSize: 32 } }))
    undoAudioEditProject(id, true)
    expect(instance.document.cuts?.[0].mode).toBe('mute')
    await flushAudioEditProject(id)
    const content = stored()
    expect((content.viewSettings as { textSize: number }).textSize).toBe(32)
    // 外壳字段不进内容：ID、名称、版本由文档外壳表达
    expect(content).not.toHaveProperty('id')
    expect(content).not.toHaveProperty('name')
    expect(content).not.toHaveProperty('revision')
  })

  it('名称就是文件名：编辑里改名不生效；文件改名后同步进实例且不进撤销', async () => {
    const instance = await loadAudioEditProject('instance-test')
    editAudioEditProject('instance-test', (document) => ({ ...document, name: '偷偷改名', referenceScript: '稿子' }))
    expect(instance.document.name).toBe('录音')
    await commands.renameDocument({ target: { id: 'instance-test' }, name: '新名字' })
    await instance.session.relocate()
    expect(instance.document.name).toBe('新名字')
    expect(instance.past).toHaveLength(1)
    undoAudioEditProject('instance-test')
    expect(instance.document.name).toBe('新名字')
  })

  it('保留本版本不认识的字段', async () => {
    commands.seed({ kind: 'audio_edit', id: 'future', name: '新版本', content: { ...audioEditProjectToDocumentContent(fixture()), futureField: { keep: true } } })
    await loadAudioEditProject('future')
    editAudioEditProject('future', (document) => ({ ...document, referenceScript: '改' }))
    await flushAudioEditProject('future')
    expect(stored('future').futureField).toEqual({ keep: true })
  })
})

describe('口播草稿', () => {
  it('导入即建草稿（在“口播”文件夹）；只导入没编辑的草稿离开时直接删除', async () => {
    const instance = await createAudioEditDraft(source)
    const meta = instance.session.documentMeta
    expect(meta.draft).toBe(true)
    expect(meta.name).toBe('未命名音频 1')
    expect((stored(meta.id).source as AudioEditSourceMetadata).sourcePath).toBe(source.sourcePath)
    expect(await leaveAudioEditProject(meta.id)).toBe('discarded')
    expect(commands.calls).toContain('deleteEmptyDraft')
    expect(getAudioEditProjectInstance(meta.id)).toBeUndefined()
    expect(prompter.log).toEqual([])
  })

  it('有内容的草稿离开时静默保存并保留草稿', async () => {
    const instance = await createAudioEditDraft(source)
    const id = instance.document.id
    editAudioEditProject(id, (document) => ({ ...document, referenceScript: '参考稿' }))
    expect(await leaveAudioEditProject(id)).toBe('saved')
    expect(prompter.log).toEqual([])
    expect(commands.stored(id)!.meta).toMatchObject({ name: '未命名音频 1', draft: true })
    expect(stored(id).referenceScript).toBe('参考稿')
    expect(getAudioEditProjectInstance(id)).toBeUndefined()
  })

  it('没有素材的空文档：进入待录音实例，导入后写进同一文档', async () => {
    commands.seed({ kind: 'audio_edit', id: 'empty', name: '助手新建', content: documentKindRegistry.require('audio_edit').createEmptyContent() })
    expect((await loadAudioEditProject('empty')).document.source.durationFrames).toBe(0)
    const instance = await assignAudioEditSource('empty', source)
    expect(instance.document.source.sourcePath).toBe(source.sourcePath)
    expect((stored('empty').source as AudioEditSourceMetadata).sourcePath).toBe(source.sourcePath)
  })

  it('后台持有的实例可释放；正在处理时拒绝', async () => {
    const instance = await loadAudioEditProject('instance-test')
    instance.busy += 1
    expect(await releaseAudioEditProject('instance-test')).toBe(false)
    instance.busy -= 1
    editAudioEditProject('instance-test', (document) => ({ ...document, referenceScript: '释放前写完' }))
    expect(await releaseAudioEditProject('instance-test')).toBe(true)
    expect(stored().referenceScript).toBe('释放前写完')
    expect(instance.session.isEnded).toBe(true)
    expect(getAudioEditProjectInstance('instance-test')).toBeUndefined()
  })

  // 编辑器切到工具首页后，口播状态里仍记着这份文档：页面已关、没有任何入口能再关它，删除必须直接成功
  it('编辑器已切走、只剩后台持有时移到回收站：先写完并释放实例再删，编辑器回到列表；前台编辑时拒绝', async () => {
    const operations = new DocumentOperations({ commands, registry, kinds: documentKindRegistry })
    operations.registerReleaser('audio_edit', releaseAudioEditProject)
    const unregister = registerCurrentDocumentProvider('audioEdit', audioEditCurrentDocument)
    try {
      const instance = await loadAudioEditProject('instance-test')
      useAudioEditStore.getState().setProject({ id: 'instance-test' })
      editAudioEditProject('instance-test', (document) => ({ ...document, referenceScript: '删除前写完' }))
      useNavigationStore.setState({ activeWorkspace: 'tools', activeToolId: 'audioEdit' })
      await expect(operations.trashDocument({ id: 'instance-test' })).rejects.toMatchObject({ name: 'DocumentInUseError' })
      expect(instance.session.isEnded).toBe(false)

      useNavigationStore.setState({ activeToolId: null })
      const writes = commands.writes
      await operations.trashDocument({ id: 'instance-test' })
      expect(commands.writes).toBe(writes + 1)
      expect(commands.trashed).toEqual(['instance-test'])
      expect(instance.session.isEnded).toBe(true)
      expect(getAudioEditProjectInstance('instance-test')).toBeUndefined()
      expect(useAudioEditStore.getState().project).toBeNull()
    } finally {
      unregister()
      useAudioEditStore.setState({ project: null })
    }
  })
})


it('空草稿首段录音立即持久化、暂停编辑、后续录音一步撤销还原来源和编辑', async () => {
  const instance = await createAudioEditDraft(null)
  const id = instance.document.id
  expect(stored(id).source).toBeNull()
  const unlock = lockAudioEditRecording(id)
  expect(() => editAudioEditProject(id, p => ({ ...p, referenceScript: '录音时修改' }))).toThrow('等待')
  undoAudioEditProject(id)
  const first = { ...instance.document, source: { ...source, ownership: 'managed' as const } }
  acceptAudioEditNativeResult(id, first, instance.version)
  await flushAudioEditProject(id)
  unlock()
  expect(stored(id).source).toMatchObject({ ownership: 'managed' })
  editAudioEditProject(id, p => ({ ...p, cuts: [{ id: 'cut', startFrame: 0, endFrame: 500, enabled: true, reason: 'manual' }] }))
  const before = instance.document
  const release = lockAudioEditRecording(id)
  acceptAudioEditNativeResult(id, { ...before, source: { ...source, sourcePath: 'D:/第二段.wav', audioPath: 'D:/第二段.wav', durationFrames: 6000, ownership: 'managed' } }, instance.version)
  await flushAudioEditProject(id); release()
  undoAudioEditProject(id)
  expect(instance.document.source).toEqual(before.source)
  expect(instance.document.cuts).toEqual(before.cuts)
  await flushAudioEditProject(id)
  expect(stored(id).source).toEqual(before.source)
  undoAudioEditProject(id); undoAudioEditProject(id)
  await flushAudioEditProject(id)
  expect(stored(id).source).toBeNull()
})

it('拖动滑杆的中间更新不整份序列化、不整份校验；松手时整份校验一次并合成一步撤销', async () => {
  const instance = await loadAudioEditProject('instance-test')
  const transcript = instance.document.transcript
  const parse = vi.spyOn(audioEditProjectSchema, 'parse')
  const stringify = vi.spyOn(JSON, 'stringify')
  try {
    const gesture = beginAudioEditGesture('instance-test')
    for (let step = 1; step <= 5; step++) editAudioEditProject('instance-test', document => ({ ...document, output: { volumeDb: step } }))
    expect(parse).not.toHaveBeenCalled()
    // 拖动中的中间状态不落盘
    await flushAudioEditProject('instance-test')
    expect(stored().output).toBeUndefined()
    expect(stringify.mock.calls.some(([value]) => value === transcript || (value as AudioEditProjectDocument | undefined)?.transcript === transcript)).toBe(false)
    // 中间状态仍校验改到的字段
    expect(() => editAudioEditProject('instance-test', document => ({ ...document, output: { volumeDb: 99 } }))).toThrow()
    gesture.finish()
    expect(parse).toHaveBeenCalledTimes(1)
  } finally { parse.mockRestore(); stringify.mockRestore() }
  expect(instance.document.output).toEqual({ volumeDb: 5 })
  await flushAudioEditProject('instance-test')
  expect(stored().output).toEqual({ volumeDb: 5 })
  expect(instance.past).toHaveLength(1)
  undoAudioEditProject('instance-test')
  expect(instance.document.output).toBeUndefined()
})

it('松手时整份校验不通过：回到拖动前、不抛错，之后的拖动仍合成一步撤销', async () => {
  const instance = await loadAudioEditProject('instance-test')
  const failing = beginAudioEditGesture('instance-test')
  // 音量区域超出音频时长只有整份校验能发现
  editAudioEditProject('instance-test', document => ({ ...document, gainRegions: [{ id: 'g', startFrame: 0, endFrame: 9000, gainDb: -3, fadeInFrames: 0, fadeOutFrames: 0, enabled: true }] }))
  expect(() => failing.finish()).not.toThrow()
  expect(instance.document.gainRegions).toBeUndefined()
  expect(instance.batchDepth).toBe(0)
  expect(instance.past).toHaveLength(0)
  const next = beginAudioEditGesture('instance-test')
  editAudioEditProject('instance-test', document => ({ ...document, output: { volumeDb: 2 } }))
  next.finish()
  expect(instance.past).toHaveLength(1)
})

it('拖动中组件卸载时取消拖动，之后的编辑恢复整份校验并照常保存', async () => {
  const instance = await loadAudioEditProject('instance-test')
  const { result, unmount } = renderHook(() => useAudioEditGestures('instance-test'))
  result.current()
  editAudioEditProject('instance-test', document => ({ ...document, output: { volumeDb: 3 } }))
  unmount()
  expect(instance.batchDepth).toBe(0)
  expect(instance.document.output).toBeUndefined()
  const parse = vi.spyOn(audioEditProjectSchema, 'parse')
  try {
    editAudioEditProject('instance-test', document => ({ ...document, output: { volumeDb: 4 } }))
    expect(parse).toHaveBeenCalledTimes(1)
  } finally { parse.mockRestore() }
  await flushAudioEditProject('instance-test')
  expect(stored().output).toEqual({ volumeDb: 4 })
})
