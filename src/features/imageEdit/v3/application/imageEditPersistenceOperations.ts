import type { ApplicationPlannedStep, ApplicationRef, ApplicationExecutionContext, ApplicationCollectionAvailability } from '@/core/application-control'
import type { ApplicationPersistenceParticipant } from '@/core/application-control/execution/persistence'
import { requireImageEditV3LiveSession } from './imageEditLiveSessionRegistry'
import { listImageEditV3LiveSessions } from './imageEditLiveSessionRegistry'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import type { ImageEditPersistenceQueuePortV3 } from './imageEditPersistenceOwner'

export function requireImageEditPersistenceOwnerV3(documentId: string) {
  const owner = requireImageEditV3LiveSession(documentId).persistenceOwner
  if (!owner) throw new Error('此图片编辑界面仅供预览；请从原图片或画布文档节点打开可保存的编辑器后再修改')
  return owner
}

export const IMAGE_EDIT_PREVIEW_ONLY_REASON = '此界面仅供预览，请从原图片或画布文档节点打开可保存的编辑器'

export function imageEditPersistenceAvailabilityV3(documentId: string, availability: ApplicationCollectionAvailability) {
  const owner = requireImageEditV3LiveSession(documentId).persistenceOwner
  if (owner) return { ...availability,
    revisions: { ...availability.revisions, ...owner.projection?.currentRevisions() },
    create: { ...availability.create, requiredPermissions: [...availability.create.requiredPermissions, ...(owner.projection?.requiredPermissions ?? [])] },
    remove: { ...availability.remove, requiredPermissions: [...availability.remove.requiredPermissions, ...(owner.projection?.requiredPermissions ?? [])] } }
  const block = { kind: 'structural' as const, requirementId: 'image_edit.persistence_owner',
    affectedEntityTypes: [availability.entityType], revisionScopes: ['image_edit'] }
  return { ...availability,
    create: { ...availability.create, available: false, reasons: [IMAGE_EDIT_PREVIEW_ONLY_REASON], blocks: [block] },
    remove: { ...availability.remove, available: false, reasons: [IMAGE_EDIT_PREVIEW_ONLY_REASON], blocks: [block] } }
}

export function imageEditPersistenceDocumentId(ref: ApplicationRef): string | null {
  if ((!ref.kind.startsWith('image_edit.') && ref.kind !== 'image_mark.annotation') || !ref.id.startsWith('v3:')) return null
  return decodeURIComponent(ref.id.slice(3).split(':')[0])
}

export function imageEditPersistenceRevisionsV3(ref: ApplicationRef): Record<string, number> {
  const id = imageEditPersistenceDocumentId(ref)
  return id ? requireImageEditV3LiveSession(id).persistenceOwner?.projection?.currentRevisions() ?? {} : {}
}

export function imageEditPersistencePermissionsV3(ref: ApplicationRef): readonly string[] {
  const id = imageEditPersistenceDocumentId(ref)
  return id ? requireImageEditV3LiveSession(id).persistenceOwner?.projection?.requiredPermissions ?? [] : []
}

/** 由 core 单入口调用；跨图层/组/蒙版/标注按同一 owner 去重。 */
export function resolveImageEditPersistenceParticipantsV3(
  steps: readonly ApplicationPlannedStep[],
  context: ApplicationExecutionContext,
): ApplicationPersistenceParticipant[] {
  const owners = new Map<string, ApplicationPersistenceParticipant>()
  for (const step of steps) {
    if (step.kind === 'operation') continue
    const id = imageEditPersistenceDocumentId(step.kind === 'mutation' ? step.target : step.parent)
    if (!id) continue
    const owner = requireImageEditPersistenceOwnerV3(id)
    if (owner.projection?.requiredPermissions.some((permission) => !context.permissions.has(permission))) {
      throw new Error('PERMISSION_DENIED:图片文档节点保存需要原画布项目写入权限')
    }
    owners.set(owner.key, owner)
  }
  return [...owners.values()]
}

/** 直接领域调用也有屏障；在正式整批事务中只执行内存步骤。 */
export async function runImageEditPersistedOperationV3<T>(
  documentId: string,
  context: ApplicationExecutionContext | undefined,
  execute: (context: ApplicationExecutionContext | undefined) => Promise<T>,
): Promise<T> {
  const owner = requireImageEditPersistenceOwnerV3(documentId)
  owner.assertCurrent()
  if (context?.persistenceScopes?.has(owner.key)) {
    try { return await execute(context) }
    finally { owner.acceptCurrent() }
  }
  const batch = owner.begin()
  const batchContext: ApplicationExecutionContext = {
    ...(context ?? { requestId: 'image-edit-direct', exposure: 'local_adapter',
      permissions: new Set<string>(), acceptedDataClasses: new Set(['C0', 'C1'] as const) }),
    persistenceScopes: new Set([owner.key]),
  }
  try {
    let result: T
    try { result = await execute(batchContext) }
    catch (error) { await batch.confirm(); throw error }
    await batch.confirm()
    return result
  } finally { batch.release() }
}

export function assertImageEditPersistenceCurrentV3(documentId: string): void {
  requireImageEditPersistenceOwnerV3(documentId).assertCurrent()
}

export async function retryImageEditDocumentSaveV3(documentId: string, expectedOwnerId?: string) {
  const owner = requireImageEditPersistenceOwnerV3(documentId)
  if (expectedOwnerId && owner.ownerId !== expectedOwnerId) throw new Error('RECOVERY_SESSION_LOST:原图片编辑保存宿主已被替换，请从原画布文档核对结果，不能借用其他宿主重试。')
  const reference = await owner.confirm(true)
  return { reference, receipt: owner.getConfirmationReceipt() }
}

/** 宿主原有 flushPending 与恢复入口共享同一 owner；初始化前仍可只保存其自有队列。 */
export function flushImageEditHostPersistenceV3(
  queue: ImageEditPersistenceQueuePortV3,
  snapshot: ImageEditPersistenceSnapshotV3,
  includeProjection = false,
) {
  const session = listImageEditV3LiveSessions().find((item) => item.documentId === snapshot.document.id)
  if (session?.persistenceOwner) {
    if (!session.persistenceOwner.ownsQueue(queue)) throw new Error('原图片编辑保存宿主已被替换，请回到原文档核对保存结果')
    return session.persistenceOwner.confirm(includeProjection)
  }
  queue.enqueue(snapshot)
  return queue.flush()
}
