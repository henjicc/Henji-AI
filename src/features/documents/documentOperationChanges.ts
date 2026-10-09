import { markDocumentOpened } from '@/commands/documents'

/** 会话与通用操作共享的轻量变化通知；不依赖任何会话或操作服务。 */
export function createDocumentOperationChanges() {
  let revision = 0
  const listeners = new Set<() => void>()
  return {
    revision: () => revision,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    changed(): void {
      revision += 1
      for (const listener of [...listeners]) listener()
    },
  }
}

export const defaultDocumentOperationChanges = createDocumentOperationChanges()

export async function markSessionDocumentOpened(docId: string): Promise<void> {
  await markDocumentOpened(docId)
  defaultDocumentOperationChanges.changed()
}
