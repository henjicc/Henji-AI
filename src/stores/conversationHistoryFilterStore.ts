import { create } from 'zustand'

export type ConversationHistoryMediaType = 'all' | 'image' | 'video' | 'audio'
export type ConversationHistoryTimePreset = 'all' | '7d' | '30d' | '90d' | 'custom'

export interface ConversationHistoryFilterState {
  keyword: string
  providerId: string
  modelId: string
  mediaType: ConversationHistoryMediaType
  timePreset: ConversationHistoryTimePreset
  startDate: string
  endDate: string
  setKeyword: (keyword: string) => void
  setProviderId: (providerId: string) => void
  setModelId: (modelId: string) => void
  setMediaType: (mediaType: ConversationHistoryMediaType) => void
  setTimePreset: (timePreset: ConversationHistoryTimePreset) => void
  setStartDate: (startDate: string) => void
  setEndDate: (endDate: string) => void
  resetFilters: () => void
}

const DEFAULT_FILTER_STATE: Pick<
  ConversationHistoryFilterState,
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

export const useConversationHistoryFilterStore = create<ConversationHistoryFilterState>((set) => ({
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
