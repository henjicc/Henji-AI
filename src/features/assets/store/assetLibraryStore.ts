import { create } from 'zustand'
import type { AssetMediaType, AssetRecord } from '@/platform/contracts/assetLibrary'

export type AssetLibraryView = 'closed' | 'floating' | 'workspace'
export type AssetSort = 'created' | 'recent'

interface AssetLibraryState {
  view: AssetLibraryView
  sourceWorkspace: Exclude<import('@/core/types/workspace').WorkspaceId, 'assets'>
  libraryId: string | null
  keyword: string
  mediaType: AssetMediaType | null
  sort: AssetSort
  selectedAsset: AssetRecord | null
  setView: (view: AssetLibraryView) => void
  openFloating: () => void
  close: () => void
  setSourceWorkspace: (workspace: Exclude<import('@/core/types/workspace').WorkspaceId, 'assets'>) => void
  setLibraryId: (libraryId: string | null) => void
  setKeyword: (keyword: string) => void
  setMediaType: (mediaType: AssetMediaType | null) => void
  setSort: (sort: AssetSort) => void
  setSelectedAsset: (asset: AssetRecord | null) => void
}

export const useAssetLibraryStore = create<AssetLibraryState>((set) => ({
  view: 'closed',
  sourceWorkspace: 'generation',
  libraryId: null,
  keyword: '',
  mediaType: null,
  sort: 'created',
  selectedAsset: null,
  setView: (view) => set({ view }),
  openFloating: () => set({ view: 'floating' }),
  close: () => set({ view: 'closed' }),
  setSourceWorkspace: (sourceWorkspace) => set({ sourceWorkspace }),
  setLibraryId: (libraryId) => set({ libraryId }),
  setKeyword: (keyword) => set({ keyword }),
  setMediaType: (mediaType) => set({ mediaType }),
  setSort: (sort) => set({ sort }),
  setSelectedAsset: (selectedAsset) => set({ selectedAsset }),
}))
