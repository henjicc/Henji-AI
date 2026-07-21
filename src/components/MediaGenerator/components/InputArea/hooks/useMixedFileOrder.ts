import { useEffect, useMemo, useState } from 'react'
import type { FileOrderItem } from '../../InputArea'

interface UseMixedFileOrderParams {
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

export function useMixedFileOrder({
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

  const currentFileOrder = fileOrder || localFileOrder
  const setCurrentFileOrder = onFileOrderChange || setLocalFileOrder

  useEffect(() => {
    if (!needsVideoUpload) {
      if (currentFileOrder.length > 0) {
        setCurrentFileOrder([])
      }
      return
    }

    const newOrder: FileOrderItem[] = []
    const existingVideoIndices = new Set<number>()
    const existingImageIndices = new Set<number>()
    const existingAudioIndices = new Set<number>()

    currentFileOrder.forEach(item => {
      if (item.type === 'video' && item.index < uploadedVideos.length) {
        newOrder.push(item)
        existingVideoIndices.add(item.index)
      } else if (item.type === 'image' && item.index < uploadedImages.length) {
        newOrder.push(item)
        existingImageIndices.add(item.index)
      } else if (item.type === 'audio' && item.index < uploadedAudios.length) {
        newOrder.push(item)
        existingAudioIndices.add(item.index)
      }
    })

    for (let i = 0; i < uploadedVideos.length; i++) {
      if (!existingVideoIndices.has(i)) {
        newOrder.push({ type: 'video', index: i })
      }
    }

    for (let i = 0; i < uploadedImages.length; i++) {
      if (!existingImageIndices.has(i)) {
        newOrder.push({ type: 'image', index: i })
      }
    }

    for (let i = 0; i < uploadedAudios.length; i++) {
      if (!existingAudioIndices.has(i)) {
        newOrder.push({ type: 'audio', index: i })
      }
    }

    if (!isSameOrder(currentFileOrder, newOrder)) {
      setCurrentFileOrder(newOrder)
    }
  }, [needsVideoUpload, uploadedAudios.length, uploadedVideos.length, uploadedImages.length, currentFileOrder, setCurrentFileOrder])

  const handleMixedFileRemove = (index: number): void => {
    if (!needsVideoUpload || currentFileOrder.length === 0) {
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
    if (!needsVideoUpload || currentFileOrder.length === 0) {
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
    if (!needsVideoUpload || currentFileOrder.length === 0) {
      return
    }

    const item = currentFileOrder[index]
    if (!item) return

    if (item.type === 'video' && onVideoTrim) {
      onVideoTrim(item.index)
    }
  }

  const handleMixedFileReorder = (from: number, to: number): void => {
    if (!needsVideoUpload || currentFileOrder.length === 0) {
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

    if (!needsVideoUpload || currentFileOrder.length === 0) {
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
    if (needsVideoUpload && currentFileOrder.length > 0) {
      return currentFileOrder.map(item => {
        if (item.type === 'video') return uploadedVideos[item.index]
        if (item.type === 'audio') return uploadedAudios[item.index]
        return uploadedImages[item.index]
      })
    }

    if (needsVideoUpload) {
      return needsVideoOnly ? [...uploadedVideos, ...uploadedAudios] : [...uploadedVideos, ...uploadedImages, ...uploadedAudios]
    }

    return [...uploadedImages, ...uploadedAudios]
  }, [currentFileOrder, needsVideoOnly, needsVideoUpload, uploadedAudios, uploadedImages, uploadedVideos])

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
