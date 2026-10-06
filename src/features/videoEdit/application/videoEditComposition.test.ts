// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentContainerRef, DocumentMeta } from '@/core/documents/types'
import type { VideoEditCreativeSource } from '@/core/videoEdit/creativeResult'
import { DocumentOperations } from '@/features/documents/documentOperations'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, fakeKindOf, FakeDocumentCommands } from '@/features/documents/documentSessionTestKit'
import { getEmbeddedHost, resetEmbeddedHostsForTests, returnFromEmbedded } from '@/features/documents/embeddedDocuments'
import {
  appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, editVideoProject, listVideoEditInstances,
  setVideoEditDocumentServicesForTests, undoVideoEdit, type VideoEditInstance,
} from './videoEditService'
import {
  bringDocumentIntoVideoEditProject, createDocumentInVideoEdit, listVideoEditReferencedDocuments, openVideoEditClipSource, relocateVideoEditClipSource,
} from './videoEditComposition'

/*
 * 4.1 在剪辑里组合文档：嵌入模式打开 / 返回、回到来源（定位部位、找不到时重新定位）、新建进项目、
 * 移进 / 复制进项目、标出来自其他位置的文档。用内存文档仓库替身，导航与生成记录读取替换掉。
 */

const navigation = vi.hoisted(() => ({ open: vi.fn(), reveal: vi.fn(), readGeneration: vi.fn() }))
vi.mock('@/features/navigation/application/surfaceNavigationService', () => ({ openApplicationSurface: navigation.open }))
vi.mock('@/workspaces/GenerationWorkspace/application/generationTaskNavigation', () => ({ revealGenerationTask: navigation.reveal }))
vi.mock('@/features/generation/application/generationResultSource', () => ({ readGenerationResultMedia: navigation.readGeneration }))

let commands: FakeDocumentCommands
let operations: DocumentOperations

beforeEach(() => {
  commands = new FakeDocumentCommands()
  const registry = new DocumentSessionRegistry({ commands, prompter: createScriptedPrompter(), kinds: { require: kind => fakeKindOf(kind as Parameters<typeof fakeKindOf>[0]) }, timing: { autosaveDelayMs: 10, idleCommitDelayMs: 5000, retryBaseDelayMs: 2000, retryMaxDelayMs: 8000 } })
  operations = new DocumentOperations({ commands, registry })
  setVideoEditDocumentServicesForTests({ registry, operations })
  for (const mock of Object.values(navigation)) mock.mockReset()
  resetEmbeddedHostsForTests()
})
afterEach(async () => {
  for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id).catch(() => undefined)
  setVideoEditDocumentServicesForTests(null)
})

function projectIdOf(instance: VideoEditInstance): string {
  const container = instance.session.documentMeta.container
  if (container.kind !== 'project') throw new Error('剪辑必须在项目里')
  return container.projectId
}

/** 剪辑里放一个图片片段并记上来源。 */
function placeClip(instance: VideoEditInstance, source: VideoEditCreativeSource): string {
  const id = instance.document.id
  const mediaId = crypto.randomUUID()
  appendVideoEditMedia(id, { id: mediaId, name: '结果', path: 'D:/作品/项目/结果.png', kind: 'image', durationSeconds: 0, width: 1920, height: 1080 })
  appendVideoEditClip(id, mediaId, { frame: 0, track: 1 })
  const clipId = instance.document.sequences[0].clips.at(-1)!.id
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => clip.id === clipId ? { ...clip, creativeSource: source } : clip) })) }))
  return clipId
}

describe('嵌入模式与回到来源', () => {
  it('回到来源以嵌入模式打开来源文档并定位部位；返回时走工具的离开流程再回到剪辑', async () => {
    const instance = await createVideoEditProject()
    const voice = commands.seed({ kind: 'audio_edit', name: '片头口播', content: {} })
    const opener = vi.fn()
    operations.registerOpener('audio_edit', opener)
    const clipId = placeClip(instance, { type: 'document', docRef: { docId: voice.id, path: voice.path }, part: 'p1' })

    expect(await openVideoEditClipSource(instance.document.id, clipId)).toEqual({ status: 'opened', kind: 'audio_edit' })
    expect(opener).toHaveBeenCalledWith(expect.objectContaining({ id: voice.id }), { part: 'p1' })
    const host = getEmbeddedHost(voice.id)!
    expect(host.label).toBe(commands.projects.get(projectIdOf(instance))!.name)

    // 离开被取消：留在原处，不回剪辑
    expect(await returnFromEmbedded(voice.id, async () => 'cancelled')).toBe(false)
    expect(navigation.open).not.toHaveBeenCalledWith('workspace.video_edit')
    expect(await returnFromEmbedded(voice.id, async () => 'closed')).toBe(true)
    expect(navigation.open).toHaveBeenCalledWith('workspace.video_edit')
    expect(getEmbeddedHost(voice.id)).toBeNull()
    // 从通用入口正常打开时不再是嵌入模式
    await operations.openDocument(await operations.findDocument(voice.id))
    expect(getEmbeddedHost(voice.id)).toBeNull()
  })

  it('来源文档找不到：给出重新定位所需的类型；重新定位后本剪辑里引用它的片段一起改指向，一次撤销恢复', async () => {
    const instance = await createVideoEditProject()
    const gone = { docId: 'gone-voice', path: 'D:/作品/口播/已删除.henji-audio' }
    const first = placeClip(instance, { type: 'document', docRef: gone })
    const second = placeClip(instance, { type: 'document', docRef: gone, revision: 2 })
    const outcome = await openVideoEditClipSource(instance.document.id, first)
    expect(outcome).toMatchObject({ status: 'missing', extension: '.henji-audio' })

    const found = commands.seed({ kind: 'audio_edit', name: '找回来的', content: {} })
    await expect(relocateVideoEditClipSource(instance.document.id, gone.docId, 'D:/别处/图.henjiimg')).rejects.toThrow('同一类型')
    expect(await relocateVideoEditClipSource(instance.document.id, gone.docId, found.path)).toBe(2)
    const sources = instance.document.sequences[0].clips.filter(clip => [first, second].includes(clip.id)).map(clip => clip.creativeSource)
    expect(sources).toEqual([
      { type: 'document', docRef: { docId: found.id, path: found.path } },
      { type: 'document', docRef: { docId: found.id, path: found.path }, revision: 2 },
    ])
    undoVideoEdit(instance.document.id)
    expect(instance.document.sequences[0].clips.find(clip => clip.id === first)?.creativeSource).toEqual({ type: 'document', docRef: gone })
  })

  it('生成记录来源打开生成页并定位记录；记录被删时如实报告，不能重新定位', async () => {
    const instance = await createVideoEditProject()
    const clipId = placeClip(instance, { type: 'generation', recordId: 'history-1', outputIndex: 0 })
    navigation.readGeneration.mockResolvedValueOnce({ mediaType: 'image', source: 'D:/a.png', name: 'a' })
    expect(await openVideoEditClipSource(instance.document.id, clipId)).toEqual({ status: 'opened', kind: 'generation' })
    expect(navigation.open).toHaveBeenCalledWith('workspace.generation'); expect(navigation.reveal).toHaveBeenCalledWith('history-1')
    navigation.readGeneration.mockResolvedValueOnce(null)
    expect(await openVideoEditClipSource(instance.document.id, clipId)).toMatchObject({ status: 'missing', extension: null })
  })
})

describe('在剪辑里新建、移进与复制进项目', () => {
  it('新建的文档建在剪辑所在项目里（按序列画面尺寸），以嵌入模式打开；取消时什么都不留', async () => {
    const instance = await createVideoEditProject()
    const container = { kind: 'project' as const, projectId: projectIdOf(instance) }
    const creator = vi.fn(async (target: DocumentContainerRef): Promise<DocumentMeta> => { if (target.kind !== 'project') throw new Error('应建在项目里'); return commands.seed({ kind: 'camera_stage', name: '新镜头', content: {}, projectId: target.projectId, folder: commands.projects.get(target.projectId)!.path }) })
    operations.registerCreator('camera_stage', creator)
    const created = await createDocumentInVideoEdit(instance.document.id, 'camera_stage')
    expect(creator).toHaveBeenCalledWith(container, { size: { width: 1920, height: 1080 } })
    expect(created?.container).toEqual(container)
    expect(getEmbeddedHost(created!.id)).not.toBeNull()
    operations.registerCreator('audio_edit', async () => null)
    expect(await createDocumentInVideoEdit(instance.document.id, 'audio_edit')).toBeNull()
    await expect(createDocumentInVideoEdit(instance.document.id, 'video_edit')).rejects.toThrow('不能新建')
  })

  it('别处的文档可移进或复制进本项目；片段引用的别处文档标为来自其他位置', async () => {
    const instance = await createVideoEditProject()
    const projectId = projectIdOf(instance)
    const moving = commands.seed({ kind: 'canvas', name: '要移的画布', content: { items: [] } })
    const copying = commands.seed({ kind: 'canvas', name: '要复制的画布', content: { items: [] } })
    placeClip(instance, { type: 'document', docRef: { docId: copying.id, path: copying.path }, part: 'n1' })
    placeClip(instance, { type: 'document', docRef: { docId: 'missing-doc', path: 'D:/没有了.henji-canvas' } })

    const before = await listVideoEditReferencedDocuments(instance.document.id)
    expect(before.map(entry => [entry.docRef.docId, entry.elsewhere, Boolean(entry.document)])).toEqual([[copying.id, true, true], ['missing-doc', false, false]])

    const moved = await bringDocumentIntoVideoEditProject(instance.document.id, await operations.findDocument(moving.id), 'move')
    expect(moved).toMatchObject({ id: moving.id, container: { kind: 'project', projectId } })
    const copied = await bringDocumentIntoVideoEditProject(instance.document.id, await operations.findDocument(copying.id), 'copy')
    expect(copied.id).not.toBe(copying.id)
    expect(copied.container).toEqual({ kind: 'project', projectId })
    expect(commands.stored(copying.id)!.meta.container).toEqual({ kind: 'user' })
  })
})
