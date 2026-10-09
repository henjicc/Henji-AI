import { create } from 'zustand'

import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'

export interface ImageEditorHandoff {
  sessionRef: string
  sourceUrl: string
  sourceName: string
  document?: ImageEditDocumentV3
}

interface ImageEditorHandoffState {
  pending: ImageEditorHandoff | null
  offer: (handoff: Omit<ImageEditorHandoff, 'document'> & { document?: ImageEditDocumentV3 }) => void
  consume: (sessionRef: string) => void
}

export const useImageEditorHandoffStore = create<ImageEditorHandoffState>((set) => ({
  pending: null,
  offer: (handoff) => set({
    pending: {
      ...handoff,
      document: handoff.document,
    },
  }),
  consume: (sessionRef) => set((state) => (
    state.pending?.sessionRef === sessionRef ? { pending: null } : state
  )),
}))

export function offerImageEditorHandoff(
  handoff: Omit<ImageEditorHandoff, 'document'> & { document?: ImageEditDocumentV3 }
): void {
  useImageEditorHandoffStore.getState().offer(handoff)
}
