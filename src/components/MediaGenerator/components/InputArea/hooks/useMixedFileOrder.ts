import { useEffect, useMemo, useState } from 'react'
import type { FileOrderItem } from '../../InputArea'

interface UseMixedFileOrderParams {
  /** 素材条里会出现不止一种媒体（可传视频或音频）：此时按 fileOrder 记录每张卡片的类型与类型内序号 */
  mixedKinds: boolean
  needsVideoUpload: boolean
  needsVideoOnly: boolean
  uploadedImages: string[]
  uploadedVideos: string[]
  uploadedAudios: string[]
  maxImageCount: number
  maxVideoCount: number
  maxAudioCount: number
  fileOrder?: FileOrderItem[]
  onFileOrderChange?: (order: FileOrderItem[]) => void
  onImageRemove: (index: number) => void
  onImageReplace: (index: number, file: File) => void
  onImageReorder: (from: number, to: number) => void
  onImageClick?: (imageUrl: string, imageList: string[]) => void
  onVideoRemove?: (index: number) => void
  onVideoReplace?: (index: number, file: File) => void
  onVideoTrim?: (index: number) => void
  onVideoClick?: (videoUrl: string) => void
  onAudioRemove?: (index: number) => void
  onAudioReplace?: (index: number, file: File) => void
  onAudioClick?: (audioUrl: string) => void
}

interface UseMixedFileOrderReturn {
  currentFileOrder: FileOrderItem[]
  mixedFiles: string[]
  mixedMaxCount: number
  shouldHideUploadButton: boolean
  handleMixedFileRemove: (index: number) => void
  handleMixedFileReplace: (index: number, file: File) => void
  handleMixedFileTrim: (index: number) => void
  handleMixedFileReorder: (from: number, to: number) => void
  handleMixedFileClick: (fileUrl: string, fileList: string[]) => void
}

function isSameOrder(a: FileOrderItem[], b: FileOrderItem[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type || a[i].index !== b[i].index) return false
  }
  return true
}

/** 保留仍然存在的素材的排列，新上传的按视频、图片、音频依次接在后面 */
function reconcileFileOrder(order: FileOrderItem[], videoCount: number, imageCount: number, audioCount: number): FileOrderItem[] {
  const counts: Record<FileOrderItem['type'], number> = { video: videoCount, image: imageCount, audio: audioCount }
  const kept = order.filter(item => item.index < counts[item.type])
  const seen = new Set(kept.map(item => `${item.type}:${item.index}`))
  const appended: FileOrderItem[] = []
  for (const type of ['video', 'image', 'audio'] as const) {
    for (let index = 0; index < counts[type]; index++) {
      if (!seen.has(`${type}:${index}`)) appended.push({ type, index })
    }
  }
  return appended.length === 0 && kept.length === order.length ? order : [...kept, ...appended]
}

export function useMixedFileOrder({
  mixedKinds,
  needsVideoUpload,
  needsVideoOnly,
  uploadedImages,
  uploadedVideos,
  uploadedAudios,
  maxImageCount,
  maxVideoCount,
  maxAudioCount,
  fileOrder,
  onFileOrderChange,
  onImageRemove,
  onImageReplace,
  onImageReorder,
  onImageClick,
  onVideoRemove,
  onVideoReplace,
  onVideoTrim,
  onVideoClick,
  onAudioRemove,
  onAudioReplace,
  onAudioClick
}: UseMixedFileOrderParams): UseMixedFileOrderReturn {
  const [localFileOrder, setLocalFileOrder] = useState<FileOrderItem[]>([])

  const storedFileOrder = fileOrder || localFileOrder
  const setCurrentFileOrder = onFileOrderChange || setLocalFileOrder

  // 渲染时就按已上传的素材对齐顺序，不等副作用写回：否则新素材进来的那一帧没有类型，音频会被当成图片画出来
  const currentFileOrder = useMemo(
    () => (mixedKinds ? reconcileFileOrder(storedFileOrder, uploadedVideos.length, uploadedImages.length, uploadedAudios.length) : []),
    [mixedKinds, storedFileOrder, uploadedAudios.length, uploadedImages.length, uploadedVideos.length]
  )

  useEffect(() => {
    if (!isSameOrder(storedFileOrder, currentFileOrder)) {
      setCurrentFileOrder(currentFileOrder)
    }
  }, [currentFileOrder, setCurrentFileOrder, storedFileOrder])

  const handleMixedFileRemove = (index: number): void => {
    if (!mixedKinds || currentFileOrder.length === 0) {
      onImageRemove(index)
      return
    }

    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoRemove) {
      onVideoRemove(item.index)
      return
    }

    if (item.type === 'image') {
      onImageRemove(item.index)
      return
    }

    if (item.type === 'audio' && onAudioRemove) {
      onAudioRemove(item.index)
    }
  }

  const handleMixedFileReplace = (index: number, file: File): void => {
    if (!mixedKinds || currentFileOrder.length === 0) {
      onImageReplace(index, file)
      return
    }

    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoReplace) {
      onVideoReplace(item.index, file)
      return
    }

    if (item.type === 'image') {
      onImageReplace(item.index, file)
      return
    }

    if (item.type === 'audio' && onAudioReplace) {
      onAudioReplace(item.index, file)
    }
  }

  const handleMixedFileTrim = (index: number): void => {
    if (!mixedKinds || currentFileOrder.length === 0) {
      return
    }

    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoTrim) {
      onVideoTrim(item.index)
    }
  }

  const handleMixedFileReorder = (from: number, to: number): void => {
    if (!mixedKinds || currentFileOrder.length === 0) {
      onImageReorder(from, to)
      return
    }

    if (from === to) return
    const newOrder = [...currentFileOrder]
    const [item] = newOrder.splice(from, 1)
    newOrder.splice(to, 0, item)
    setCurrentFileOrder(newOrder)
  }

  const handleMixedFileClick = (fileUrl: string, fileList: string[]): void => {
    const index = fileList.indexOf(fileUrl)
    if (index === -1) return

    if (!mixedKinds || currentFileOrder.length === 0) {
      onImageClick?.(fileUrl, fileList)
      return
    }

    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video') {
      onVideoClick?.(fileUrl)
      return
    }

    if (item.type === 'audio') {
      onAudioClick?.(fileUrl)
      return
    }

    if (item.type === 'image') {
      const allImages = currentFileOrder
        .filter(f => f.type === 'image')
        .map(f => uploadedImages[f.index])
      onImageClick?.(fileUrl, allImages)
    }
  }

  const mixedFiles = useMemo(() => {
    if (!mixedKinds) return uploadedImages
    return currentFileOrder.map(item => {
      if (item.type === 'video') return uploadedVideos[item.index]
      if (item.type === 'audio') return uploadedAudios[item.index]
      return uploadedImages[item.index]
    })
  }, [currentFileOrder, mixedKinds, uploadedAudios, uploadedImages, uploadedVideos])

  const mixedMaxCount = needsVideoUpload
    ? (needsVideoOnly ? maxVideoCount + maxAudioCount : maxVideoCount + maxImageCount + maxAudioCount)
    : maxImageCount + maxAudioCount

  const shouldHideUploadButton = useMemo(() => {
    if (needsVideoUpload && !needsVideoOnly) {
      const currentVideoCount = uploadedVideos.length
      const currentImageCount = uploadedImages.length
      const currentAudioCount = uploadedAudios.length
      return currentVideoCount >= maxVideoCount && currentImageCount >= maxImageCount && currentAudioCount >= maxAudioCount
    }

    if (needsVideoOnly && uploadedVideos.length >= maxVideoCount && uploadedAudios.length >= maxAudioCount) {
      return true
    }

    if (!needsVideoUpload && uploadedImages.length >= maxImageCount && uploadedAudios.length >= maxAudioCount) {
      return true
    }

    return false
  }, [
    maxImageCount,
    maxAudioCount,
    maxVideoCount,
    needsVideoOnly,
    needsVideoUpload,
    uploadedAudios.length,
    uploadedImages.length,
    uploadedVideos.length
  ])

  return {
    currentFileOrder,
    mixedFiles,
    mixedMaxCount,
    shouldHideUploadButton,
    handleMixedFileRemove,
    handleMixedFileReplace,
    handleMixedFileTrim,
    handleMixedFileReorder,
    handleMixedFileClick
  }
}
