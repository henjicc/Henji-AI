import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AssistantDockMode = 'left' | 'right' | 'floating'

export interface AssistantPanelPosition {
  x: number
  y: number
}

export interface AssistantPanelSize {
  width: number
  height: number
}

interface AssistantUiState {
  open: boolean
  mode: AssistantDockMode
  floatingPosition: AssistantPanelPosition
  size: AssistantPanelSize
  threadId: string
  activeRunId: string | null
  currentGoal: string
  pendingGoal: string | null
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setMode: (mode: AssistantDockMode) => void
  setFloatingPosition: (position: AssistantPanelPosition) => void
  setSize: (size: AssistantPanelSize) => void
  setActiveRun: (runId: string | null, goal?: string) => void
  setPendingGoal: (goal: string | null) => void
}

const DEFAULT_THREAD_ID = 'assistant-default-thread'

export const useAssistantUiStore = create<AssistantUiState>()(
  persist(
    (set) => ({
      open: false,
      mode: 'right',
      floatingPosition: { x: 720, y: 72 },
      size: { width: 420, height: 680 },
      threadId: DEFAULT_THREAD_ID,
      activeRunId: null,
      currentGoal: '',
      pendingGoal: null,
      setOpen: (open) => set({ open }),
      toggleOpen: () => set((state) => ({ open: !state.open })),
      setMode: (mode) => set({ mode }),
      setFloatingPosition: (floatingPosition) => set({ floatingPosition }),
      setSize: (size) => set({ size }),
      setActiveRun: (activeRunId, goal) => set((state) => ({
        activeRunId,
        currentGoal: goal ?? state.currentGoal,
      })),
      setPendingGoal: (pendingGoal) => set(pendingGoal
        ? { pendingGoal, open: true }
        : { pendingGoal: null }),
    }),
    {
      name: 'henji-assistant-ui',
      version: 1,
      partialize: (state) => ({
        open: state.open,
        mode: state.mode,
        floatingPosition: state.floatingPosition,
        size: state.size,
        threadId: state.threadId,
        activeRunId: state.activeRunId,
        currentGoal: state.currentGoal,
      }),
    }
  )
)

export function openAssistant(goal?: string): void {
  const state = useAssistantUiStore.getState()
  state.setOpen(true)
  if (goal?.trim()) state.setPendingGoal(goal.trim())
}

export function closeAssistant(): void {
  useAssistantUiStore.getState().setOpen(false)
}

export function toggleAssistant(): void {
  useAssistantUiStore.getState().toggleOpen()
}
