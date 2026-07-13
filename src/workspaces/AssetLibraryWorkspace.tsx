import React from 'react'
import { AssetLibrarySurface } from '@/features/assets/AssetLibrarySurface'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'

const AssetLibraryWorkspace: React.FC = () => {
  const setView = useAssetLibraryStore((s) => s.setView)
  return <AssetLibrarySurface mode="workspace" onBack={() => setView('closed')} />
}
export default AssetLibraryWorkspace
