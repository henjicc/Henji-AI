import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { touchAsset } from '@/commands/assetLibrary'
import { AudioViewerModal } from '@/components/mediaViewer/AudioViewerModal'
import { ImageViewerModal } from '@/components/mediaViewer/ImageViewerModal'
import { VideoViewerModal } from '@/components/mediaViewer/VideoViewerModal'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'

interface Props { asset: AssetRecord | null; onClose: () => void }

/** 将资产记录适配到项目统一维护的三类媒体查看器。 */
export const AssetPreviewOverlay: React.FC<Props> = ({ asset, onClose }) => {
  const [lastAsset, setLastAsset] = useState<AssetRecord | null>(asset)
  useEffect(() => {
    if (asset) {
      setLastAsset(asset)
      void touchAsset(asset.id)
    }
  }, [asset])
  const media = asset ?? lastAsset

  return createPortal(
    <div className="contents" data-asset-preview={asset ? 'open' : 'closed'}>
      <ImageViewerModal
        open={asset?.mediaType === 'image'}
        imageUrl={media?.displayUrl ?? ''}
        imageList={media?.mediaType === 'image' ? [media.displayUrl] : []}
        filePaths={media?.mediaType === 'image' ? [media.filePath] : []}
        infoSource={media?.filePath}
        currentIndex={0}
        onClose={onClose}
        onNavigate={() => undefined}
      />
      <VideoViewerModal
        open={asset?.mediaType === 'video'}
        videoUrl={media?.displayUrl ?? ''}
        filePath={media?.mediaType === 'video' ? media.filePath : undefined}
        onClose={onClose}
      />
      <AudioViewerModal
        open={asset?.mediaType === 'audio'}
        audioUrl={media?.displayUrl ?? ''}
        filePath={media?.mediaType === 'audio' ? media.filePath : undefined}
        autoPlay
        onClose={onClose}
      />
    </div>,
    document.body,
  )
}
