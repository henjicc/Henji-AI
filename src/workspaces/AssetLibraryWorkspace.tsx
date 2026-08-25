import React from 'react'
import { AssetLibrarySurface } from '@/features/assets/AssetLibrarySurface'
import { closeAssetLibrary } from '@/stores/navigationStore'

const AssetLibraryWorkspace: React.FC = () => {
  return <AssetLibrarySurface mode="workspace" onClose={closeAssetLibrary} />
}
export default AssetLibraryWorkspace
