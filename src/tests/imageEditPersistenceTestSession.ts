import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { ImageMarkV3PersistenceQueue } from '@/features/imageMark/standalone/imageMarkV3Persistence'
import { registerImageEditV3LiveSession } from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'
import type { ImageEditDocumentRepositoryV3 } from '@/core/imageEdit/v3/serviceContracts'

/** 叶子领域测试的存储端口；正式 L-B 使用 ImageEditorV3CommandRepository + native 存储边界。 */
export function registerPersistedImageEditTestSession(
  sessionId: string,
  bus: ImageEditCommandBusV3,
  repository: Pick<ImageEditDocumentRepositoryV3, 'save'> = {
    async save(document) { return { documentId: document.id, revision: document.revision, previewRef: null } },
  },
) {
  const initial = bus.getPersistenceSnapshot()
  const queue = new ImageMarkV3PersistenceQueue({ repository,
    initialReference: { documentId: initial.document.id, revision: initial.document.revision, previewRef: null },
    initialHistory: initial.history })
  return registerImageEditV3LiveSession(sessionId, bus, { getQueue: () => queue })
}
