import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { EmbeddedAgentPrompt } from '@/core/assistant/embeddedAgent'

export type AssistantDockMode = 'left' | 'right' | 'floating'

export interface AssistantGoalOptions {
  autoSend?: boolean
  context?: string
}

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
  pendingGoal: string | null
  pendingGoalOptions: AssistantGoalOptions | null
  embeddedAccess: EmbeddedAgentPrompt['access']
  setEmbeddedAccess: (access: EmbeddedAgentPrompt['access']) => void
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setMode: (mode: AssistantDockMode) => void
  setFloatingPosition: (position: AssistantPanelPosition) => void
  setSize: (size: AssistantPanelSize) => void
  setPendingGoal: (goal: string | null, options?: AssistantGoalOptions) => void
}


export const useAssistantUiStore = create<AssistantUiState>()(
  persist(
    (set) => ({
      open: false,
      mode: 'right',
      floatingPosition: { x: 720, y: 72 },
      size: { width: 420, height: 680 },
      pendingGoal: null,
      pendingGoalOptions: null,
      embeddedAccess: 'full',
      setEmbeddedAccess: (embeddedAccess) => set({ embeddedAccess }),
      setOpen: (open) => set({ open }),
      toggleOpen: () => set((state) => ({ open: !state.open })),
      setMode: (mode) => set({ mode }),
      setFloatingPosition: (floatingPosition) => set({ floatingPosition }),
      setSize: (size) => set({ size }),
      setPendingGoal: (pendingGoal, options) => set(pendingGoal
        ? { pendingGoal, pendingGoalOptions: options ?? null, open: true }
        : { pendingGoal: null, pendingGoalOptions: null }),
    }),
    {
      name: 'henji-assistant-ui',
      version: 1,
      partialize: (state) => ({
        open: state.open,
        mode: state.mode,
        floatingPosition: state.floatingPosition,
        size: state.size,
        embeddedAccess: state.embeddedAccess,
      }),
    }
  )
)

export function openAssistant(goal?: string, options?: AssistantGoalOptions): void {
  const state = useAssistantUiStore.getState()
  state.setOpen(true)
  if (goal?.trim()) state.setPendingGoal(goal.trim(), options)
}

export function closeAssistant(): void {
  useAssistantUiStore.getState().setOpen(false)
}

export function toggleAssistant(): void {
  useAssistantUiStore.getState().toggleOpen()
}
