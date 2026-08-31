import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'

import type {
  ImageEditSessionData,
  ImageEditSessionReferenceV3,
} from '@/core/imageEdit'

interface UseGenerationImageViewerOptions {
  imageEditStatesRef: MutableRefObject<Map<string, ImageEditSessionData>>
  setUploadedImagesRef: MutableRefObject<Dispatch<SetStateAction<string[]>> | null>
  setUploadedFilePathsRef: MutableRefObject<Dispatch<SetStateAction<string[]>> | null>
}

export function useGenerationImageViewer({
  imageEditStatesRef,
  setUploadedImagesRef,
  setUploadedFilePathsRef,
}: UseGenerationImageViewerOptions) {
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false)
  const [currentImage, setCurrentImage] = useState('')
  const [currentImageList, setCurrentImageList] = useState<string[]>([])
  const [currentFilePathList, setCurrentFilePathList] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isEditorMode, setIsEditorMode] = useState(false)
  const [isFromUploadArea, setIsFromUploadArea] = useState(false)

  const openImageViewer = useCallback((
    url: string,
    list: string[],
    filePaths?: string[],
    fromUpload = false,
  ): void => {
    setCurrentImage(url)
    setCurrentImageList(list)
    setCurrentImageIndex(Math.max(0, list.indexOf(url)))
    setCurrentFilePathList(filePaths ?? [])
    setIsFromUploadArea(fromUpload)
    setIsEditorMode(false)
    setIsImageViewerOpen(true)
  }, [])

  const closeImageViewer = useCallback((): void => {
    setIsImageViewerOpen(false)
    setIsEditorMode(false)
  }, [])

  const navigateImage = useCallback((direction: 'prev' | 'next'): void => {
    if (currentImageList.length === 0) return
    const nextIndex = direction === 'prev'
      ? (currentImageIndex > 0 ? currentImageIndex - 1 : currentImageList.length - 1)
      : (currentImageIndex < currentImageList.length - 1 ? currentImageIndex + 1 : 0)
    setCurrentImageIndex(nextIndex)
    setCurrentImage(currentImageList[nextIndex])
    setIsEditorMode(false)
  }, [currentImageIndex, currentImageList])

  const handleSaveImageEdit = useCallback((
    mediaUrl: string,
    session: ImageEditSessionData,
  ): void => {
    if (currentImage !== mediaUrl) imageEditStatesRef.current.delete(currentImage)
    imageEditStatesRef.current.set(mediaUrl, session)
    setCurrentImageList((current) => {
      const next = [...current]
      next[currentImageIndex] = mediaUrl
      return next
    })
    setCurrentFilePathList((current) => {
      if (!current.length) return current
      const next = [...current]
      next[currentImageIndex] = ''
      return next
    })
    setCurrentImage(mediaUrl)
    if (!isFromUploadArea) return
    setUploadedImagesRef.current?.((current) => {
      const next = [...current]
      if (currentImageIndex < next.length) next[currentImageIndex] = mediaUrl
      return next
    })
    setUploadedFilePathsRef.current?.((current) => {
      const next = [...current]
      while (next.length <= currentImageIndex) next.push('')
      next[currentImageIndex] = ''
      return next
    })
  }, [
    currentImage,
    currentImageIndex,
    imageEditStatesRef,
    isFromUploadArea,
    setUploadedFilePathsRef,
    setUploadedImagesRef,
  ])

  const handleImageEditSessionChange = useCallback((
    session: ImageEditSessionReferenceV3,
  ): void => {
    imageEditStatesRef.current.set(currentImage, session)
  }, [currentImage, imageEditStatesRef])

  return {
    isImageViewerOpen,
    currentImage,
    currentImageList,
    currentFilePathList,
    currentImageIndex,
    isEditorMode,
    isFromUploadArea,
    openImageViewer,
    closeImageViewer,
    navigateImage,
    enterImageEditor: () => setIsEditorMode(true),
    exitImageEditor: () => setIsEditorMode(false),
    handleSaveImageEdit,
    handleImageEditSessionChange,
  }
}
