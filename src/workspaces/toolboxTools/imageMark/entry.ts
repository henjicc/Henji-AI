import { getImageDocumentWorkspace } from '@/features/imageEdit/documents/imageDocumentWorkspace'
import { findOpenImageDocument } from '@/features/imageEdit/documents/imageDocumentRuntime'
import type { ToolboxToolEntry } from '../../toolboxRuntime'

export default {
  loadComponent: () => import('@/features/imageMark/standalone/ImageMarkTool'),
  openRecentFile: async (id) => {
    const { requestImageDocumentInEditor } = await import('@/features/imageEdit/documents/imageDocumentWorkspace')
    requestImageDocumentInEditor({ id })
  },
  currentDocumentName: () => {
    const current = getImageDocumentWorkspace().current
    const editing = current ? findOpenImageDocument(current) : undefined
    return editing && !editing.session.isEnded ? editing.session.documentMeta.name : undefined
  },
} satisfies ToolboxToolEntry
