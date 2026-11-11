import { create } from 'zustand'

export type GenerationHistoryMediaType = 'all' | 'image' | 'video' | 'audio'
export type GenerationHistoryTimePreset = 'all' | '7d' | '30d' | '90d' | 'custom'

export interface GenerationHistoryFilterState {
  keyword: string
  providerId: string
  modelId: string
  mediaType: GenerationHistoryMediaType
  timePreset: GenerationHistoryTimePreset
  startDate: string
  endDate: string
  setKeyword: (keyword: string) => void
  setProviderId: (providerId: string) => void
  setModelId: (modelId: string) => void
  setMediaType: (mediaType: GenerationHistoryMediaType) => void
  setTimePreset: (timePreset: GenerationHistoryTimePreset) => void
  setStartDate: (startDate: string) => void
  setEndDate: (endDate: string) => void
  resetFilters: () => void
}

const DEFAULT_FILTER_STATE: Pick<
  GenerationHistoryFilterState,
  'keyword' | 'providerId' | 'modelId' | 'mediaType' | 'timePreset' | 'startDate' | 'endDate'
> = {
  keyword: '',
  providerId: 'all',
  modelId: 'all',
  mediaType: 'all',
  timePreset: 'all',
  startDate: '',
  endDate: '',
}

export const useGenerationHistoryFilterStore = create<GenerationHistoryFilterState>((set) => ({
  ...DEFAULT_FILTER_STATE,
  setKeyword: (keyword) => set({ keyword }),
  setProviderId: (providerId) => set({ providerId }),
  setModelId: (modelId) => set({ modelId }),
  setMediaType: (mediaType) => set({ mediaType }),
  setTimePreset: (timePreset) => set({ timePreset }),
  setStartDate: (startDate) => set({ startDate }),
  setEndDate: (endDate) => set({ endDate }),
  resetFilters: () => set(DEFAULT_FILTER_STATE),
}))
