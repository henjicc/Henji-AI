// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocumentOperations } from '@/features/documents/documentOperations'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, fakeKindOf, FakeDocumentCommands, type ScriptedPrompter } from '@/features/documents/documentSessionTestKit'
import {
  appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, collectVideoEditMedia, createVideoEditProject, leaveVideoEditProject,
  listVideoEditInstances, openVideoEditProject, releaseVideoEditDocument, saveVideoEdit, setVideoEditDocumentServicesForTests, undoVideoEdit,
} from './videoEditService'

/*
 * 3.1 剪辑接入：项目 = 文件夹 + 主剪辑，打开 / 自动保存 / 离开全部走通用文档会话。
 * 用内存文档仓库替身与按脚本回答的提示，不跑主进程。
 */

let commands: FakeDocumentCommands
let prompter: ScriptedPrompter
let operations: DocumentOperations

beforeEach(() => {
  commands = new FakeDocumentCommands()
  prompter = createScriptedPrompter()
  const registry = new DocumentSessionRegistry({ commands, prompter, kinds: { require: kind => fakeKindOf(kind as Parameters<typeof fakeKindOf>[0]) }, timing: { autosaveDelayMs: 10, idleCommitDelayMs: 5000, retryBaseDelayMs: 2000, retryMaxDelayMs: 8000 } })
  operations = new DocumentOperations({ commands, registry })
  setVideoEditDocumentServicesForTests({ registry, operations })
})
afterEach(async () => {
  for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id).catch(() => undefined)
  setVideoEditDocumentServicesForTests(null)
})

const project = (id: string) => commands.projects.get(id)!
function containerOf(id: string): string {
  const stored = commands.stored(id)!
  if (stored.meta.container.kind !== 'project') throw new Error('剪辑必须在项目里')
  return stored.meta.container.projectId
}

describe('新建项目与离开', () => {
  it('新建 = 草稿项目 + 同名主剪辑（登记为主剪辑）；什么都没做就离开时整个项目移到回收站，不询问', async () => {
    const instance = await createVideoEditProject()
    const projectId = containerOf(instance.document.id)
    expect(project(projectId)).toMatchObject({ draft: true, name: '未命名项目 1', mainVideoEditId: instance.document.id })
    expect(commands.stored(instance.document.id)!.meta).toMatchObject({ name: '未命名项目 1', draft: false, kind: 'video_edit' })
    expect(await leaveVideoEditProject(instance.document.id)).toBe('discarded')
    expect(prompter.log).toEqual([]); expect(commands.trashed).toContain(projectId); expect(listVideoEditInstances()).toEqual([])
  })

  it('有内容时询问：取消留在剪辑里；保存时起名，主剪辑随项目改名；保存过的项目再离开不询问', async () => {
    const instance = await createVideoEditProject(); const id = instance.document.id; const projectId = containerOf(id)
    appendVideoEditClip(id)
    prompter.leaveChoices.push('cancel')
    expect(await leaveVideoEditProject(id)).toBe('cancelled')
    expect(listVideoEditInstances()).toEqual([instance])
    prompter.leaveChoices.push('save')
    prompter.saveName = async (info) => { await info.submit('旅行短片', null); return true }
    expect(await leaveVideoEditProject(id)).toBe('saved')
    expect(project(projectId)).toMatchObject({ draft: false, name: '旅行短片' })
    expect(commands.stored(id)!.meta.name).toBe('旅行短片')
    expect(commands.stored(id)!.content).toMatchObject({ sequences: [{ clips: [{ kind: 'text' }] }] })
    const reopened = await openVideoEditProject(project(projectId))
    expect(reopened.document).toMatchObject({ id, name: '旅行短片' })
    prompter.log.length = 0
    expect(await leaveVideoEditProject(id)).toBe('closed'); expect(prompter.log).toEqual([])
  })

  it('不保存：整个项目文件夹移到回收站', async () => {
    const instance = await createVideoEditProject(); const projectId = containerOf(instance.document.id)
    appendVideoEditClip(instance.document.id)
    prompter.leaveChoices.push('discard')
    expect(await leaveVideoEditProject(instance.document.id)).toBe('discarded')
    expect(commands.trashed).toContain(projectId); expect(commands.stored(instance.document.id)).toBeUndefined()
  })

  it('编辑静默自动保存进剪辑文件，撤销同样写回', async () => {
    const instance = await createVideoEditProject(); const id = instance.document.id
    appendVideoEditClip(id)
    await saveVideoEdit(id)
    expect((commands.stored(id)!.content as { sequences: Array<{ clips: unknown[] }> }).sequences[0].clips).toHaveLength(1)
    undoVideoEdit(id)
    await saveVideoEdit(id)
    expect((commands.stored(id)!.content as { sequences: Array<{ clips: unknown[] }> }).sequences[0].clips).toHaveLength(0)
  })
})

describe('打开项目', () => {
  it('打开项目 = 打开主剪辑；没有主剪辑时建同名剪辑并登记；登记的主剪辑不在本项目里（拷贝出来的项目）时改认本项目里的', async () => {
    const empty = commands.seedProject({ name: '空项目' })
    const opened = await openVideoEditProject(empty)
    expect(opened.document.name).toBe('空项目'); expect(project(empty.id).mainVideoEditId).toBe(opened.document.id)
    await closeVideoEditProject(opened.document.id)

    const original = commands.seedProject({ name: '原项目' })
    const originalEdit = commands.seed({ kind: 'video_edit', name: '原项目', content: fakeKindOf('video_edit').createEmptyContent(), projectId: original.id, folder: original.path })
    const copy = commands.seedProject({ name: '拷贝' })
    const copyEdit = commands.seed({ kind: 'video_edit', name: '原项目', content: fakeKindOf('video_edit').createEmptyContent(), projectId: copy.id, folder: copy.path })
    commands.projects.set(copy.id, { ...project(copy.id), mainVideoEditId: originalEdit.id })
    const fromCopy = await openVideoEditProject(project(copy.id))
    expect(fromCopy.document.id).toBe(copyEdit.id); expect(project(copy.id).mainVideoEditId).toBe(copyEdit.id)
  })

  it('打开别处的项目文件夹：登记为外部位置后打开主剪辑', async () => {
    const { openVideoEditProjectFolder } = await import('./videoEditService')
    const opened = await openVideoEditProjectFolder('E:/别处/外部项目')
    const registered = [...commands.projects.values()].find(item => item.path === 'E:/别处/外部项目')!
    expect(registered.external).toBe(true); expect(registered.mainVideoEditId).toBe(opened.document.id)
  })

  it('找不到文件夹的项目给出可理解的拒绝', async () => {
    const missing = { ...commands.seedProject({ name: '不在了' }), missing: true }
    await expect(openVideoEditProject(missing)).rejects.toThrow('找不到这个项目的文件夹')
  })
})

describe('收集素材与后台释放', () => {
  it('收集素材后剪辑引用项目里的副本，撤销历史不跨版本', async () => {
    const instance = await createVideoEditProject(); const id = instance.document.id; const projectId = containerOf(id)
    appendVideoEditMedia(id, { id: 'outside', name: '外部.mp4', path: 'E:/外部/外部.mp4', kind: 'video', durationSeconds: 3, width: 1920, height: 1080 })
    const copied = `${project(projectId).path}/素材/外部.mp4`
    commands.collectMapping.set('E:/外部/外部.mp4', copied)
    expect(await collectVideoEditMedia(id)).toEqual({ copiedFiles: 1, missing: 0 })
    expect(instance.document.media[0].path).toBe(copied); expect(instance.past).toHaveLength(0)
    expect(await collectVideoEditMedia(id)).toEqual({ copiedFiles: 0, missing: 0 })
  })

  it('项目文件夹里的素材只按位置引用：打开时去掉素材库关联并写回，外部素材的关联保留', async () => {
    const project = commands.seedProject({ name: '拷来的项目' })
    const content = fakeKindOf('video_edit').createEmptyContent() as { media: unknown[] }
    const linked = { assetId: 'asset-1', assetContent: { sizeBytes: 1, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64) } }
    content.media = [
      { id: 'inside', name: '结果.png', path: `${project.path}/生成结果/结果.png`, kind: 'image', durationSeconds: 0, width: 64, height: 64, ...linked },
      { id: 'outside', name: '外部.png', path: 'E:/外部/外部.png', kind: 'image', durationSeconds: 0, width: 64, height: 64, ...linked, assetId: 'asset-2' },
    ]
    const edit = commands.seed({ kind: 'video_edit', name: '拷来的项目', content, projectId: project.id, folder: project.path })
    const { openVideoEditDocument } = await import('./videoEditService')
    const opened = await openVideoEditDocument({ id: edit.id })
    expect(opened.document.media[0]).not.toHaveProperty('assetContent'); expect(opened.document.media[0]).not.toHaveProperty('assetId')
    expect(opened.document.media[1]).toMatchObject({ assetId: 'asset-2' })
    await saveVideoEdit(edit.id)
    expect((commands.stored(edit.id)!.content as { media: Array<Record<string, unknown>> }).media[0]).not.toHaveProperty('assetContent')
  })

  it('界面正在显示的剪辑不能被后台释放；没在显示的写完关闭', async () => {
    const shown = await createVideoEditProject()
    expect(await releaseVideoEditDocument(shown.document.id)).toBe(false)
    const other = commands.seedProject({ name: '后台' })
    const { openVideoEditDocument } = await import('./videoEditService')
    const background = await openVideoEditDocument({ id: (await operations.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: other.id }, name: '后台' })).id }, { focus: false })
    expect(await releaseVideoEditDocument(background.document.id)).toBe(true)
    expect(listVideoEditInstances()).toEqual([shown])
  })
})
