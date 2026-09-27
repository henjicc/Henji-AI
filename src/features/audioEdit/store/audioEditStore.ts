import { create } from 'zustand'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, setAudioEditBlocks } from '@/core/audioEdit/edits'
import { attachAudioEditProject, editAudioEditProject, subscribeAudioEditInstances, undoAudioEditProject } from '../application/audioEditProjectInstances'

interface AudioEditState {
  project: AudioEditProjectDocument | null
  past: AudioEditProjectDocument[]
  future: AudioEditProjectDocument[]
  selectedBlockIds: string[]
  saveError: string | null
  busy: boolean
  setProject: (project: AudioEditProjectDocument | null) => void
  toggleBlock: (blockId: string) => void
  setBlocksIncluded: (blockIds: string[], included: boolean) => void
  setReferenceScript: (referenceScript: string) => void
  setVstEnabled: (vstEnabled: boolean) => void
  applySuggestion: (suggestionId: string) => void
  dismissSuggestion: (suggestionId: string) => void
  setSelectedBlockIds: (ids: string[]) => void
  undo: () => void
  redo: () => void
}

export const useAudioEditStore = create<AudioEditState>((set, get) => {
  const mutate = (update: (project: AudioEditProjectDocument) => AudioEditProjectDocument): void => {
    const project = get().project
    if (project) editAudioEditProject(project.id, update)
  }
  return {
    project: null, past: [], future: [], selectedBlockIds: [], saveError: null, busy: false,
    setProject: (project) => {
      const instance = project ? attachAudioEditProject(project) : null
      set({ project: instance?.document ?? null, past: instance?.past ?? [], future: instance?.future ?? [], selectedBlockIds: [], saveError: instance?.error ?? null, busy: Boolean(instance?.busy) })
    },
    toggleBlock: (id) => mutate((project) => setAudioEditBlocks(project, [id], !project.transcript.find((block) => block.id === id)?.included)),
    setBlocksIncluded: (ids, included) => mutate((project) => setAudioEditBlocks(project, ids, included)),
    setReferenceScript: (referenceScript) => mutate((project) => ({ ...project, referenceScript })),
    setVstEnabled: (vstEnabled) => mutate((project) => ({ ...project, vstEnabled })),
    applySuggestion: (id) => mutate((project) => applyAudioEditSuggestion(project, id)),
    dismissSuggestion: (id) => mutate((project) => ({ ...project, suggestions: project.suggestions.map((suggestion) => suggestion.id === id ? { ...suggestion, status: 'dismissed' } : suggestion) })),
    setSelectedBlockIds: (selectedBlockIds) => set({ selectedBlockIds }),
    undo: () => { const project = get().project; if (project) undoAudioEditProject(project.id) },
    redo: () => { const project = get().project; if (project) undoAudioEditProject(project.id, true) },
  }
})

subscribeAudioEditInstances((instance) => {
  if (useAudioEditStore.getState().project?.id !== instance.document.id) return
  useAudioEditStore.setState({ project: instance.document, past: instance.past, future: instance.future, saveError: instance.error, busy: Boolean(instance.busy) })
})
