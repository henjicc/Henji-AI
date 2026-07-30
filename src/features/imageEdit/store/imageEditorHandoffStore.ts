import { create } from 'zustand'

import {
  createEmptyImageEditDocument,
  type ImageEditDocument,
} from '@/core/imageEdit'

export interface ImageEditorHandoff {
  sessionRef: string
  sourceUrl: string
  sourceName: string
  document: ImageEditDocument
}

interface ImageEditorHandoffState {
  pending: ImageEditorHandoff | null
  offer: (handoff: Omit<ImageEditorHandoff, 'document'> & { document?: ImageEditDocument }) => void
  consume: (sessionRef: string) => void
}

export const useImageEditorHandoffStore = create<ImageEditorHandoffState>((set) => ({
  pending: null,
  offer: (handoff) => set({
    pending: {
      ...handoff,
      document: handoff.document ?? createEmptyImageEditDocument(),
    },
  }),
  consume: (sessionRef) => set((state) => (
    state.pending?.sessionRef === sessionRef ? { pending: null } : state
  )),
}))

export function offerImageEditorHandoff(
  handoff: Omit<ImageEditorHandoff, 'document'> & { document?: ImageEditDocument }
): void {
  useImageEditorHandoffStore.getState().offer(handoff)
}
