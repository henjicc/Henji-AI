import { create } from 'zustand'

import type { AudioEditPreviewMode } from '@/core/audioEdit/types'

interface AudioEditPlaybackState {
  mode: AudioEditPreviewMode
  playing: boolean
  preparing: boolean
  ready: boolean
  error: string | null
  sourceFrame: number
  outputFrame: number
  activeBlockId: string | null
  setMode: (mode: AudioEditPreviewMode) => void
  setPlaying: (playing: boolean) => void
  setPreparing: (preparing: boolean) => void
  setReady: (ready: boolean) => void
  setError: (error: string | null) => void
  updatePosition: (sourceFrame: number, outputFrame: number, activeBlockId: string | null) => void
}

export const useAudioEditPlaybackStore = create<AudioEditPlaybackState>((set) => ({
  mode: 'edited',
  playing: false,
  preparing: false,
  ready: false,
  error: null,
  sourceFrame: 0,
  outputFrame: 0,
  activeBlockId: null,
  setMode: (mode) => set({ mode }),
  setPlaying: (playing) => set({ playing }),
  setPreparing: (preparing) => set({ preparing }),
  setReady: (ready) => set({ ready }),
  setError: (error) => set({ error }),
  updatePosition: (sourceFrame, outputFrame, activeBlockId) => set({ sourceFrame, outputFrame, activeBlockId }),
}))
