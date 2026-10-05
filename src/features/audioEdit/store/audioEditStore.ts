import { create } from 'zustand'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { applyAudioEditSuggestion, dismissAudioEditSuggestion, setAudioEditBlocks } from '@/core/audioEdit/edits'
import { editAudioEditProject, getAudioEditProjectInstance, markAudioEditDocumentShown, subscribeAudioEditInstances, undoAudioEditProject } from '../application/audioEditProjectInstances'

interface AudioEditState {
  project: AudioEditProjectDocument | null
  past: AudioEditProjectDocument[]
  future: AudioEditProjectDocument[]
  selectedBlockIds: string[]
  saveError: string | null
  busy: boolean
  /** 显示一份已载入的口播（按文档 ID）；null 回到列表。 */
  setProject: (project: { id: string } | null) => void
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
    // 显示一份已载入的口播（实例由 loadAudioEditProject / createAudioEditDraft 打开）；null 回到列表
    setProject: (project) => {
      const instance = project ? getAudioEditProjectInstance(project.id) ?? null : null
      if (project && !instance) throw new Error('口播尚未载入。')
      markAudioEditDocumentShown(instance?.document.id ?? null)
      set({ project: instance?.document ?? null, past: instance?.past ?? [], future: instance?.future ?? [], selectedBlockIds: [], saveError: instance?.error ?? null, busy: Boolean(instance?.busy) })
    },
    toggleBlock: (id) => mutate((project) => setAudioEditBlocks(project, [id], !project.transcript.find((block) => block.id === id)?.included)),
    setBlocksIncluded: (ids, included) => mutate((project) => setAudioEditBlocks(project, ids, included)),
    setReferenceScript: (referenceScript) => mutate((project) => ({ ...project, referenceScript })),
    setVstEnabled: (vstEnabled) => mutate((project) => ({ ...project, vstEnabled })),
    applySuggestion: (id) => mutate((project) => applyAudioEditSuggestion(project, id)),
    dismissSuggestion: (id) => mutate((project) => dismissAudioEditSuggestion(project, id)),
    setSelectedBlockIds: (selectedBlockIds) => set({ selectedBlockIds }),
    undo: () => { const project = get().project; if (project) undoAudioEditProject(project.id) },
    redo: () => { const project = get().project; if (project) undoAudioEditProject(project.id, true) },
  }
})

subscribeAudioEditInstances((instance) => {
  if (useAudioEditStore.getState().project?.id !== instance.document.id) return
  // 会话结束（移到回收站、被别处关闭）：界面回到列表
  if (instance.session.isEnded) { markAudioEditDocumentShown(null); useAudioEditStore.setState({ project: null, past: [], future: [], selectedBlockIds: [], saveError: null, busy: false }); return }
  useAudioEditStore.setState({ project: instance.document, past: instance.past, future: instance.future, saveError: instance.error, busy: Boolean(instance.busy) })
})
