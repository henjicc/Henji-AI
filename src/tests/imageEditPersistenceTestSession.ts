import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { ImageEditPersistenceV3Queue } from '@/features/imageEdit/v3/application/imageEditPersistenceQueue'
import { adoptImageEditDocumentInstanceForTestsV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
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
  const queue = new ImageEditPersistenceV3Queue({ repository,
    initialReference: { documentId: initial.document.id, revision: initial.document.revision, previewRef: null },
    initialHistory: initial.history })
  return adoptImageEditDocumentInstanceForTestsV3(sessionId, bus, { getQueue: () => queue })
}
