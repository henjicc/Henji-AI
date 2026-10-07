import { createVideoEditSequence, type VideoEditDocument } from '@/core/videoEdit/document'
import { harnessDocumentStore } from '@/tests/harnessNativeStorage'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { closeVideoEditProject, createVideoEditProject, listVideoEditInstances, openVideoEditDocument, videoEditDocumentContent, type VideoEditInstance } from './videoEditService'

/*
 * 仅供测试（3.1）：剪辑存成项目里的文档文件后，单测经测试夹具的内存文档仓库（harnessNativeStorage 的
 * henjiNative.documents）读写。这里把“磁盘上的剪辑”还原成剪辑形状，并提供造数据与重新打开。
 */

/** 磁盘（内存仓库）里这份剪辑的内容，按剪辑形状返回（名称取文件名）。 */
export function savedVideoEdit(owner: VideoEditInstance | string): VideoEditDocument {
  const id = typeof owner === 'string' ? owner : owner.document.id
  const stored = harnessDocumentStore().stored(id)
  if (!stored) throw new Error(`剪辑 ${id} 不在测试文档仓库里`)
  return { format: 'henji-video-project', version: 2, id, name: stored.meta.name, revision: 0, ...(stored.content as object) } as VideoEditDocument
}

/** 把一份剪辑写进测试文档仓库（建同名项目并放进去），保留原 ID，返回文档 ID。 */
export function seedVideoEditDocument(document: VideoEditDocument, options: { projectName?: string } = {}): string {
  const store = harnessDocumentStore()
  const project = store.seedProject({ name: options.projectName ?? document.name })
  const meta = store.seed({ kind: 'video_edit', id: document.id, name: document.name, content: structuredClone(videoEditDocumentContent(document)), projectId: project.id, folder: project.path })
  store.projects.set(project.id, { ...project, mainVideoEditId: meta.id, documentCount: 1 })
  return meta.id
}

/** 写完并关闭后按 ID 重新打开（等同重启后从项目列表打开）。 */
export async function reopenVideoEdit(id: string): Promise<VideoEditInstance> {
  if (listVideoEditInstances().some(instance => instance.document.id === id)) await closeVideoEditProject(id)
  return await openVideoEditDocument({ id })
}

/** 让之后的保存全部失败（模拟磁盘错误），false 恢复。 */
export function failVideoEditSaves(failing: boolean): void {
  harnessDocumentStore().failSaves = failing ? Number.POSITIVE_INFINITY : 0
}

/** 真正写进文件的次数（内容没变的保存不计）。 */
export function videoEditWrites(): number {
  return harnessDocumentStore().writes
}

/** 关闭本用例打开的全部剪辑（afterEach 用；草稿项目保留草稿标记，不询问）。 */
export async function closeAllVideoEdits(): Promise<void> {
  failVideoEditSaves(false)
  for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id).catch(() => undefined)
}

/** 模拟别处改了磁盘上的剪辑文件（内容整份替换，版本加一）。传字符串时按原样写入（模拟损坏的内容）。 */
export function replaceSavedVideoEdit(id: string, document: VideoEditDocument | unknown): void {
  const stored = harnessDocumentStore().stored(id)
  if (!stored) throw new Error(`剪辑 ${id} 不在测试文档仓库里`)
  const value = document as Partial<VideoEditDocument>
  stored.content = value && typeof value === 'object' && value.format === 'henji-video-project' ? structuredClone(videoEditDocumentContent(value as VideoEditDocument)) : structuredClone(document)
  stored.meta = { ...stored.meta, revision: stored.meta.revision + 1 }
}

/** 造一份剪辑并打开（等同在剪辑页打开它所在的项目）。 */
export async function openSeededVideoEdit(document: VideoEditDocument): Promise<VideoEditInstance> {
  return await openVideoEditDocument({ id: seedVideoEditDocument(document) })
}

/**
 * 新建剪辑项目，并把主序列补齐旧版默认的八条轨道（A1 + V1–V7）后重新打开：新序列默认只有 V1/A1（剪辑对齐 PR 2.4），
 * 需要多条视频轨的用例用它，打开后没有编辑历史、磁盘内容即八条轨道。
 */
export async function createLegacyTrackVideoEditProject(): Promise<VideoEditInstance> {
  const created = await createVideoEditTestProject()
  const document = structuredClone(created.document)
  addLegacyVideoEditTracks(document.sequences[0])
  replaceSavedVideoEdit(document.id, document)
  return await reopenVideoEdit(document.id)
}

/** 编辑测试显式建时间线；先存入夹具仓库再重开，初始无编辑历史。 */
export async function createVideoEditTestProject(): Promise<VideoEditInstance> {
  const created = await createVideoEditProject()
  const document = structuredClone(created.document)
  document.sequences.push(createVideoEditSequence())
  replaceSavedVideoEdit(created.document.id, document)
  return reopenVideoEdit(created.document.id)
}
