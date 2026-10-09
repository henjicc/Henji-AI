import { ImageEditorV3CommandRepository, loadImageEditorV3Document } from '@/commands/imageEditorV3'
import type { ApplicationRef } from '@/core/application-control'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { ensureImageEditDocumentBindingV3 } from './imageEditDocumentBindings'
import { ensureImageDocumentOpenInBackground } from '@/features/imageEdit/documents/imageDocumentRuntime'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import { isImageEditPreviewDocument } from '../../application/imageEditSessionRegistry'
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
    const read = () => loadImageEditorV3Document({
      requestId: `image-edit-load:${crypto.randomUUID()}`,
      documentRef: `image-edit-v3:${documentId}`,
    })
    let snapshot = await read()
    // 图片文档（.henjiimg，3.5）在这台电脑上还没有工作副本：先打开它的文档会话（解包），再读。
    if (!snapshot) {
      await ensureImageDocumentOpenInBackground(documentId)
      snapshot = await read()
    }
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
    // 不可变预览可通过同一反射读取，但不安装保存 owner；既有写屏障会拒绝原地修改。
    if (isImageEditPreviewDocument(documentId)) {
      return getOrCreateImageEditDocumentInstanceV3(snapshot.document, {
        historySnapshot: history.createSnapshot(),
        resourceByteSizes: Object.fromEntries(snapshot.resources.map((resource) => [resource.resourceRef, resource.byteLength])),
      })
    }
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
    // 图片文档要有文档会话，助手的修改才会在空闲时写回 .henjiimg；不是图片文档时什么也不做。
    void ensureImageDocumentOpenInBackground(documentId).catch(() => undefined)
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
