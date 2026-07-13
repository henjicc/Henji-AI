import { useCallback, useState } from 'react'
import type { AssetMediaType, AssetRecord, AssetSource } from '@/platform/contracts/assetLibrary'
import { useAssetLibraryStore } from '../store/assetLibraryStore'
import { addMediaReferenceToLibrary } from '../services/assetCollectionService'

interface AddMediaInput { filePath: string; mediaType: AssetMediaType; source: AssetSource; displayName?: string }

export function useAddToAssetLibrary(): {
  addMedia: (input: AddMediaInput) => Promise<AssetRecord>
  collecting: boolean
} {
  const libraryId = useAssetLibraryStore((state) => state.libraryId)
  const [collecting, setCollecting] = useState(false)
  const addMedia = useCallback(async (input: AddMediaInput): Promise<AssetRecord> => {
    setCollecting(true)
    try {
      return await addMediaReferenceToLibrary({ ...input, libraryIds: libraryId ? [libraryId] : undefined })
    } finally {
      setCollecting(false)
    }
  }, [libraryId])
  return { addMedia, collecting }
}
