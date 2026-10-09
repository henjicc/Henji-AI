import type { ToolboxToolEntry } from '../../toolboxRuntime'

export default {
  loadComponent: () => import('@/features/audioEdit/AudioEditApp'),
  openRecentFile: async (id) => {
    const { openAudioEditDocument } = await import('@/features/audioEdit/application/audioEditDocumentService')
    await openAudioEditDocument({ id })
  },
} satisfies ToolboxToolEntry
