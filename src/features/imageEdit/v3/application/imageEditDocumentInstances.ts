import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditCommandBusOptionsV3 } from './imageEditCommandBus'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { ImageEditPersistenceOwnerV3, type ImageEditPersistenceHostV3 } from './imageEditPersistenceOwner'
import { ImageEditPersistenceV3Queue, type ImageEditPersistenceV3Options } from './imageEditPersistenceQueue'
import { createLogger } from '@/core/logging'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'

const logger = createLogger('features.imageEdit.v3.document_instances')

export interface ImageEditDocumentInstanceV3 {
  readonly documentId: string
  readonly bus: ImageEditCommandBusV3
  persistenceOwner?: ImageEditPersistenceOwnerV3
  views: number
  leases: number
  dirty: boolean
  closing: boolean
  revision: number
}

interface OwnedInstance extends ImageEditDocumentInstanceV3 {
  timer: ReturnType<typeof setTimeout> | null
  unsubscribe: () => void
}

const instances = new Map<string, OwnedInstance>()
const queues = new Map<string, ImageEditPersistenceV3Queue>()
const deleting = new Set<string>()
const deleted = new Set<string>()
const listeners = new Set<() => void>()
let revision = 0

function emit(): void {
  revision += 1
  for (const listener of listeners) listener()
}

export function getOrCreateImageEditPersistenceQueueV3(
  options: Omit<ImageEditPersistenceV3Options, 'onStatusChange'>,
): ImageEditPersistenceV3Queue {
  const id = options.initialReference.documentId
  assertImageEditDocumentAvailableV3(id)
  const existing = queues.get(id)
  if (existing) return existing
  const queue = new ImageEditPersistenceV3Queue(options)
  queues.set(id, queue)
  return queue
}

export function findImageEditDocumentInstanceV3(documentId: string): ImageEditDocumentInstanceV3 | undefined {
  return instances.get(documentId)
}

export function readImageEditDocumentInstanceV3(documentId: string) {
  assertImageEditDocumentAvailableV3(documentId)
  const instance = instances.get(documentId)
  if (!instance?.persistenceOwner) return undefined
  const persistence = instance.bus.getPersistenceSnapshot()
  const resourceByteSizes = instance.bus.getResourceByteSizes()
  const resourceDescriptors: ImageEditorV3ResourceDescriptor[] = Object.entries(resourceByteSizes).map(([resourceRef, byteLength]) => ({
    resourceRef: resourceRef as ImageEditorV3ResourceDescriptor['resourceRef'], byteLength, mediaType: null,
  }))
  return { persistence, document: persistence.document, history: persistence.history,
    reference: instance.persistenceOwner.getReference(), resourceByteSizes, resourceDescriptors }
}

export function requireImageEditDocumentInstanceV3(documentId: string): ImageEditDocumentInstanceV3 {
  assertImageEditDocumentAvailableV3(documentId)
  const instance = instances.get(documentId)
  if (!instance) throw new Error('NOT_FOUND：图片文档尚未加载。')
  return instance
}

export function listImageEditDocumentInstancesV3(): ImageEditDocumentInstanceV3[] { return [...instances.values()] }
export function getImageEditDocumentCatalogRevisionV3(): number { return revision }
export function subscribeImageEditDocumentInstancesV3(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function installOwner(instance: OwnedInstance, host?: ImageEditPersistenceHostV3): void {
  const queue = host?.getQueue()
  if (!queue) return
  if (instance.persistenceOwner) {
    if (!instance.persistenceOwner.ownsQueue(queue)) throw new Error('图片文档已持有另一条保存队列')
    if (host) instance.persistenceOwner.attachProjection(host)
    return
  }
  instance.persistenceOwner = new ImageEditPersistenceOwnerV3(
    instance.documentId, queue, () => instance.bus.getPersistenceSnapshot(), host?.confirmProjection, host?.projection,
    () => !instance.closing,
  )
}

function adopt(bus: ImageEditCommandBusV3, host?: ImageEditPersistenceHostV3): OwnedInstance {
  const documentId = bus.getSnapshot().document.id
  const existing = instances.get(documentId)
  if (existing) {
    if (existing.bus !== bus) throw new Error('图片文档已经拥有命令总线')
    installOwner(existing, host)
    return existing
  }
  const instance: OwnedInstance = {
    documentId, bus, views: 0, leases: 0, dirty: false, closing: false, revision: 0,
    timer: null, unsubscribe: () => undefined,
  }
  installOwner(instance, host)
  bus.setMutationGuard(() => assertImageEditDocumentAvailableV3(documentId))
  instance.unsubscribe = bus.subscribePersistence(() => {
    instance.dirty = true
    instance.revision += 1
    if (instance.timer) clearTimeout(instance.timer)
    if (instance.persistenceOwner) instance.timer = setTimeout(() => {
      instance.timer = null
      void saveImageEditDocumentInstanceV3(documentId).catch((error: unknown) => {
        logger.error('图片文档自动保存失败，保留当前修改', error, {
          event: 'image_edit.v3.document.autosave.failed', context: { documentId },
        })
      })
    }, 500)
    emit()
  })
  instances.set(documentId, instance)
  emit()
  return instance
}

export function getOrCreateImageEditDocumentInstanceV3(
  document: ImageEditDocumentV3,
  options: Pick<ImageEditCommandBusOptionsV3, 'historySnapshot' | 'resourceByteSizes'> = {},
  host?: ImageEditPersistenceHostV3,
): ImageEditDocumentInstanceV3 {
  assertImageEditDocumentAvailableV3(document.id)
  const existing = instances.get(document.id)
  if (existing) {
    if (existing.closing) throw new Error('图片文档正在关闭')
    installOwner(existing, host)
    return existing
  }
  return adopt(new ImageEditCommandBusV3(document, options), host)
}

export function attachImageEditDocumentInstanceV3(documentId: string): () => void {
  const instance = requireImageEditDocumentInstanceV3(documentId)
  if (instance.closing) throw new Error('图片文档正在关闭')
  instance.views += 1
  let released = false
  return () => {
    if (released) return
    released = true
    instance.views -= 1
  }
}

export async function saveImageEditDocumentInstanceV3(documentId: string, includeProjection = false) {
  assertImageEditDocumentAvailableV3(documentId)
  const instance = instances.get(documentId)
  if (!instance?.persistenceOwner) throw new Error('图片文档没有保存目标')
  if (instance.timer) clearTimeout(instance.timer)
  instance.timer = null
  instance.leases += 1
  const version = instance.revision
  try {
    const reference = await instance.persistenceOwner.confirm(includeProjection)
    if (instance.revision === version) instance.dirty = false
    return reference
  } finally { instance.leases -= 1 }
}

export function releaseImageEditDocumentInstanceV3(documentId: string): boolean {
  const instance = instances.get(documentId)
  if (!instance) return true
  if (instance.views || instance.leases || instance.dirty || instance.closing
    || instance.persistenceOwner?.isBusy() || queues.get(documentId)?.isBusy() || queues.get(documentId)?.isDirty()) return false
  dispose(instance)
  return true
}

export function assertImageEditDocumentAvailableV3(documentId: string): void {
  if (deleted.has(documentId)) throw new Error('DOCUMENT_DELETED：图片文档已删除')
  if (deleting.has(documentId)) throw new Error('DOCUMENT_CLOSING：图片文档正在关闭')
}

export function leaseImageEditDocumentInstanceV3(documentId: string): () => void {
  const instance = requireImageEditDocumentInstanceV3(documentId)
  instance.leases += 1
  let released = false
  return () => { if (!released) { released = true; instance.leases -= 1 } }
}

/** 候选回收不抢占编辑者或任务。删除期间禁止新的载入、附着与写入，失败保留原实例。 */
export async function deleteIdleImageEditDocumentV3(documentId: string, revision: number, remove: () => Promise<boolean>): Promise<boolean> {
  if (deleted.has(documentId)) return true
  if (deleting.has(documentId)) return false
  const instance = instances.get(documentId)
  const queue = queues.get(documentId)
  if (instance && (instance.views || instance.leases || instance.dirty || instance.persistenceOwner?.isBusy()
    || instance.bus.getSnapshot().document.revision !== revision)) return false
  if (queue?.isBusy() || queue?.isDirty()) return false
  deleting.add(documentId)
  if (instance) instance.closing = true
  try {
    if (!await remove()) return false
    if (instance) dispose(instance)
    queues.delete(documentId)
    deleted.add(documentId)
    return true
  } finally {
    deleting.delete(documentId)
    if (instance) instance.closing = false
  }
}

function dispose(instance: OwnedInstance): void {
  if (instance.timer) clearTimeout(instance.timer)
  instance.unsubscribe()
  instance.persistenceOwner?.dispose()
  instance.bus.dispose()
  instances.delete(instance.documentId)
  queues.delete(instance.documentId)
  emit()
}

/** 测试夹具注入正式总线与受控持久化边界，不提供生产环境替换入口。 */
export function adoptImageEditDocumentInstanceForTestsV3(
  _sessionId: string, bus: ImageEditCommandBusV3, host?: ImageEditPersistenceHostV3,
): () => void {
  const instance = adopt(bus, host)
  return () => { if (instances.get(instance.documentId) === instance) dispose(instance) }
}

export function resetImageEditDocumentInstancesForTestsV3(): void {
  for (const instance of instances.values()) dispose(instance)
  queues.clear()
  deleting.clear()
  deleted.clear()
}
