import { create } from 'zustand'

import type { AudioEditProjectDocument } from '@/core/audioEdit/types'

interface EditableSnapshot {
  transcript: AudioEditProjectDocument['transcript']
  suggestions: AudioEditProjectDocument['suggestions']
  referenceScript: string
  vstEnabled: boolean
}

interface AudioEditState {
  project: AudioEditProjectDocument | null
  past: EditableSnapshot[]
  future: EditableSnapshot[]
  selectedBlockIds: string[]
  setProject: (project: AudioEditProjectDocument | null) => void
  acceptSavedRevision: (projectId: string, revision: number) => void
  toggleBlock: (blockId: string) => void
  setBlocksIncluded: (blockIds: string[], included: boolean) => void
  setReferenceScript: (referenceScript: string) => void
  setVstEnabled: (vstEnabled: boolean) => void
  applySuggestion: (suggestionId: string) => void
  dismissSuggestion: (suggestionId: string) => void
  setSelectedBlockIds: (blockIds: string[]) => void
  undo: () => void
  redo: () => void
}

function snapshot(project: AudioEditProjectDocument): EditableSnapshot {
  return {
    transcript: project.transcript,
    suggestions: project.suggestions,
    referenceScript: project.referenceScript,
    vstEnabled: project.vstEnabled,
  }
}

function restore(project: AudioEditProjectDocument, value: EditableSnapshot): AudioEditProjectDocument {
  return { ...project, ...value }
}

export const useAudioEditStore = create<AudioEditState>((set) => {
  const mutate = (update: (project: AudioEditProjectDocument) => AudioEditProjectDocument): void => {
    set((state) => {
      if (!state.project) return state
      return {
        project: update(state.project),
        past: [...state.past.slice(-49), snapshot(state.project)],
        future: [],
      }
    })
  }

  return {
    project: null,
    past: [],
    future: [],
    selectedBlockIds: [],
    setProject: (project) => set({ project, past: [], future: [], selectedBlockIds: [] }),
    acceptSavedRevision: (projectId, revision) => set((state) => state.project?.id === projectId
      ? { project: { ...state.project, revision } }
      : state),
    toggleBlock: (blockId) => mutate((project) => ({
      ...project,
      transcript: project.transcript.map((block) => block.id === blockId && !block.locked
        ? { ...block, included: !block.included }
        : block),
    })),
    setBlocksIncluded: (blockIds, included) => {
      const selected = new Set(blockIds)
      mutate((project) => ({
        ...project,
        transcript: project.transcript.map((block) => selected.has(block.id) && !block.locked
          ? { ...block, included }
          : block),
      }))
    },
    setReferenceScript: (referenceScript) => mutate((project) => ({ ...project, referenceScript })),
    setVstEnabled: (vstEnabled) => mutate((project) => ({ ...project, vstEnabled })),
    applySuggestion: (suggestionId) => mutate((project) => {
      const target = project.suggestions.find((suggestion) => suggestion.id === suggestionId)
      if (!target) return project
      const blockIds = new Set(target.blockIds)
      return {
        ...project,
        transcript: project.transcript.map((block) => blockIds.has(block.id) && !block.locked
          ? { ...block, included: false }
          : block),
        suggestions: project.suggestions.map((suggestion) => suggestion.id === suggestionId
          ? { ...suggestion, status: 'applied' }
          : suggestion),
      }
    }),
    dismissSuggestion: (suggestionId) => mutate((project) => ({
      ...project,
      suggestions: project.suggestions.map((suggestion) => suggestion.id === suggestionId
        ? { ...suggestion, status: 'dismissed' }
        : suggestion),
    })),
    setSelectedBlockIds: (selectedBlockIds) => set({ selectedBlockIds }),
    undo: () => set((state) => {
      if (!state.project || state.past.length === 0) return state
      const previous = state.past.at(-1)!
      return {
        project: restore(state.project, previous),
        past: state.past.slice(0, -1),
        future: [snapshot(state.project), ...state.future.slice(0, 49)],
      }
    }),
    redo: () => set((state) => {
      if (!state.project || state.future.length === 0) return state
      const next = state.future[0]
      return {
        project: restore(state.project, next),
        past: [...state.past.slice(-49), snapshot(state.project)],
        future: state.future.slice(1),
      }
    }),
  }
})
