import { ImageEditorV3CommandRepository, loadImageEditorV3Document } from '@/commands/imageEditorV3'
import type { ApplicationRef } from '@/core/application-control'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { ensureImageEditDocumentBindingV3 } from './imageEditDocumentBindings'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import {
  findImageEditDocumentInstanceV3, getOrCreateImageEditDocumentInstanceV3,
  getOrCreateImageEditPersistenceQueueV3, type ImageEditDocumentInstanceV3,
  assertImageEditDocumentAvailableV3, leaseImageEditDocumentInstanceV3,
  requireImageEditDocumentInstanceV3,
} from './imageEditDocumentInstances'

const loading = new Map<string, Promise<ImageEditDocumentInstanceV3>>()
export function hasLoadingImageEditDocumentsV3(): boolean { return loading.size > 0 }

/** 读取与执行共用同一个实例；并发调用只载入一次，单个等待者取消不取消共享载入。 */
export async function ensureImageEditDocumentInstanceV3(documentId: string): Promise<ImageEditDocumentInstanceV3> {
  assertApplicationWritesAllowed()
  assertImageEditDocumentAvailableV3(documentId)
  const existing = findImageEditDocumentInstanceV3(documentId)
  if (existing) { await ensureImageEditDocumentBindingV3(existing); return existing }
  const pending = loading.get(documentId)
  if (pending) return pending
  const load = (async () => {
    const snapshot = await loadImageEditorV3Document({
      requestId: `image-edit-load:${crypto.randomUUID()}`,
      documentRef: `image-edit-v3:${documentId}`,
    })
    if (!snapshot || snapshot.document.id !== documentId || snapshot.revision !== snapshot.document.revision) {
      throw new Error('NOT_FOUND：图片文档不存在或快照不一致。')
    }
    // IPC 等待期间 UI 可能已经附着；只接纳首次创建的业务实例。
    assertImageEditDocumentAvailableV3(documentId)
    const installed = findImageEditDocumentInstanceV3(documentId)
    if (installed) { await ensureImageEditDocumentBindingV3(installed); return installed }
    const history = new ImageEditCommandHistoryV3()
    if (snapshot.history) history.restore(snapshot.document, snapshot.history)
    else history.clear(snapshot.document)
    const queue = getOrCreateImageEditPersistenceQueueV3({
      repository: new ImageEditorV3CommandRepository(),
      initialReference: { documentId, revision: snapshot.revision, previewRef: snapshot.previewRef },
      initialHistory: history.createSnapshot(),
    })
    const instance = getOrCreateImageEditDocumentInstanceV3(snapshot.document, {
      historySnapshot: history.createSnapshot(),
      resourceByteSizes: Object.fromEntries(snapshot.resources.map((resource) => [resource.resourceRef, resource.byteLength])),
    }, { getQueue: () => queue })
    await ensureImageEditDocumentBindingV3(instance)
    return instance
  })()
  loading.set(documentId, load)
  try { return await load }
  finally { if (loading.get(documentId) === load) loading.delete(documentId) }
}

export async function withImageEditDocumentInstanceV3<T>(documentId: string, execute: (instance: ImageEditDocumentInstanceV3) => Promise<T>): Promise<T> {
  await ensureImageEditDocumentInstanceV3(documentId)
  const release = leaseImageEditDocumentInstanceV3(documentId)
  try { return await execute(requireImageEditDocumentInstanceV3(documentId)) }
  finally { release() }
}

export async function ensureImageEditRefInstanceV3(ref: ApplicationRef): Promise<void> {
  if ((!ref.kind.startsWith('image_edit.') && ref.kind !== 'image_mark.annotation') || !ref.id.startsWith('v3:')) {
    throw new Error('NOT_FOUND')
  }
  const id = decodeURIComponent(ref.id.slice(3).split(':')[0])
  if (!id) throw new Error('NOT_FOUND')
  await ensureImageEditDocumentInstanceV3(id)
}
