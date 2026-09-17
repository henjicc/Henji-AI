import type { ImageEditDocumentInstanceV3 } from './imageEditDocumentInstances'
import type { ImageEditPersistenceHostV3 } from './imageEditPersistenceOwner'

export type ImageEditDocumentProjectionBindingV3 = Pick<ImageEditPersistenceHostV3, 'projection' | 'confirmProjection'>
type Resolver = (documentId: string) => Promise<ImageEditDocumentProjectionBindingV3 | undefined>
let resolveProjection: Resolver | undefined
const pending = new Map<string, Promise<void>>()

/** 根应用装配注入领域关系，图片文档不导入画布实现或 React。 */
export function configureImageEditDocumentProjectionResolverV3(resolver: Resolver): void { resolveProjection = resolver }

export async function ensureImageEditDocumentBindingV3(instance: ImageEditDocumentInstanceV3): Promise<void> {
  const owner = instance.persistenceOwner
  if (!resolveProjection || !owner || owner.projection) return
  const existing = pending.get(instance.documentId)
  if (existing) return existing
  const operation = (async () => {
    const binding = await resolveProjection!(instance.documentId)
    if (binding) owner.attachProjection({ getQueue: () => null, ...binding })
  })()
  pending.set(instance.documentId, operation)
  try { await operation }
  finally { if (pending.get(instance.documentId) === operation) pending.delete(instance.documentId) }
}
