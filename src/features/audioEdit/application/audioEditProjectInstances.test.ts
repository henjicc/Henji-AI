// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { documentKindRegistry } from '@/core/documents/kinds'
import { audioEditProjectToDocumentContent } from '@/core/audioEdit/documentContent'
import type { AudioEditProjectDocument, AudioEditSourceMetadata } from '@/core/audioEdit/types'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands, type ScriptedPrompter } from '@/features/documents/documentSessionTestKit'
import {
  assignAudioEditSource, createAudioEditDraft, editAudioEditProject, flushAudioEditProject, getAudioEditProjectInstance,
  leaveAudioEditProject, loadAudioEditProject, markAudioEditDocumentShown, releaseAudioEditProject, resetAudioEditProjectInstancesForTests,
  setAudioEditDocumentRegistryForTests, undoAudioEditProject, withAudioEditProjectOperation,
} from './audioEditProjectInstances'

/*
 * 口播文档实例（3.3）：同一份文档全局一个实例，保存全部交给通用文档会话（失败保留修改、处理前先写完），
 * 名称就是文件名，导入即建草稿、离开时空草稿直接删除、有内容的草稿询问。
 * 用内存文档仓库替身 + 正式会话登记表，不跑主进程。
 */

const source: AudioEditSourceMetadata = { mediaType: 'audio', sourcePath: 'D:/外部/录音.wav', audioPath: 'D:/外部/录音.wav', sampleRate: 1000, channels: 1, durationFrames: 4000 }
const fixture = (): AudioEditProjectDocument => ({ id: 'instance-test', name: '录音', source, transcript: [{ id: 'word', text: '你好', startFrame: 1000, endFrame: 2000, included: true, locked: true, granularity: 'word' }], referenceScript: '', suggestions: [], vstEnabled: false, revision: 1, createdAt: 1, updatedAt: 1 })

let commands: FakeDocumentCommands
let prompter: ScriptedPrompter

beforeEach(() => {
  commands = new FakeDocumentCommands()
  prompter = createScriptedPrompter()
  setAudioEditDocumentRegistryForTests(new DocumentSessionRegistry({ commands, prompter, kinds: documentKindRegistry }))
  commands.seed({ kind: 'audio_edit', id: 'instance-test', name: '录音', content: audioEditProjectToDocumentContent(fixture()) })
})
afterEach(async () => { await resetAudioEditProjectInstancesForTests(); setAudioEditDocumentRegistryForTests(null) })

function stored(id = 'instance-test'): Record<string, unknown> {
  return commands.stored(id)!.content as Record<string, unknown>
}

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
    expect(meta.name).toBe('未命名口播 1')
    expect((stored(meta.id).source as AudioEditSourceMetadata).sourcePath).toBe(source.sourcePath)
    expect(await leaveAudioEditProject(meta.id)).toBe('discarded')
    expect(commands.calls).toContain('deleteEmptyDraft')
    expect(getAudioEditProjectInstance(meta.id)).toBeUndefined()
    expect(prompter.log).toEqual([])
  })

  it('有内容的草稿离开时询问：取消留下，保存起名后转正', async () => {
    const instance = await createAudioEditDraft(source)
    const id = instance.document.id
    editAudioEditProject(id, (document) => ({ ...document, referenceScript: '参考稿' }))
    prompter.leaveChoices.push('cancel')
    expect(await leaveAudioEditProject(id)).toBe('cancelled')
    expect(getAudioEditProjectInstance(id)).toBe(instance)
    prompter.leaveChoices.push('save')
    prompter.saveName = async (info) => { await info.submit('第一期口播', null); return true }
    expect(await leaveAudioEditProject(id)).toBe('saved')
    expect(commands.stored(id)!.meta).toMatchObject({ name: '第一期口播', draft: false })
    expect(stored(id).referenceScript).toBe('参考稿')
    expect(getAudioEditProjectInstance(id)).toBeUndefined()
  })

  it('没有素材的空文档：打开时报素材缺失，导入后接成实例并写进文件', async () => {
    commands.seed({ kind: 'audio_edit', id: 'empty', name: '助手新建', content: documentKindRegistry.require('audio_edit').createEmptyContent() })
    await expect(loadAudioEditProject('empty')).rejects.toMatchObject({ name: 'AudioEditSourceMissingError' })
    const instance = await assignAudioEditSource('empty', source)
    expect(instance.document.source.sourcePath).toBe(source.sourcePath)
    expect((stored('empty').source as AudioEditSourceMetadata).sourcePath).toBe(source.sourcePath)
  })

  it('后台持有的实例可释放；界面正在显示或正在处理时拒绝', async () => {
    const instance = await loadAudioEditProject('instance-test')
    markAudioEditDocumentShown('instance-test')
    expect(await releaseAudioEditProject('instance-test')).toBe(false)
    markAudioEditDocumentShown(null)
    instance.busy += 1
    expect(await releaseAudioEditProject('instance-test')).toBe(false)
    instance.busy -= 1
    editAudioEditProject('instance-test', (document) => ({ ...document, referenceScript: '释放前写完' }))
    expect(await releaseAudioEditProject('instance-test')).toBe(true)
    expect(stored().referenceScript).toBe('释放前写完')
    expect(instance.session.isEnded).toBe(true)
    expect(getAudioEditProjectInstance('instance-test')).toBeUndefined()
  })
})
