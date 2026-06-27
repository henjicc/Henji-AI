import { useEffect } from 'react'
import { resolveInputLimits } from '@/core/inputs/inputLimits'

interface UseGlobalPasteImageParams {
  selectedModel: string
  modelParams: DynamicValueMap
  uploadedImagesCount: number
  uploadedVideosCount: number
  handleImageFileUpload: (files: File[], maxImageCount: number) => Promise<void>
}

function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  try {
    const arr = dataUrl.split(',')
    const mimeMatch = arr[0].match(/:(.*?);/)
    if (!mimeMatch) return null
    const mime = mimeMatch[1]
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new File([u8arr], fileName, { type: mime })
  } catch {
    return null
  }
}

export function useGlobalPasteImage(params: UseGlobalPasteImageParams): void {
  const {
    selectedModel,
    modelParams,
    uploadedImagesCount,
    uploadedVideosCount,
    handleImageFileUpload
  } = params

  useEffect(() => {
    const getMaxCount = (): number => resolveInputLimits(
      selectedModel,
      modelParams,
      { imagesCount: uploadedImagesCount, videosCount: uploadedVideosCount }
    ).images.max

    const handleGlobalPasteImage = async (e: Event) => {
      const customEvent = e as CustomEvent<{
        files?: File[]
        clipboardFiles?: Array<{ data: string; mimeType: string; name: string }>
        imageBlob?: Blob
        imageType?: string
      }>
      const detail = customEvent.detail

      if (detail?.clipboardFiles && detail.clipboardFiles.length > 0) {
        const files: File[] = []
        for (const clipFile of detail.clipboardFiles) {
          const file = dataUrlToFile(clipFile.data, clipFile.name)
          if (file) files.push(file)
        }
        if (files.length > 0) {
          await handleImageFileUpload(files, getMaxCount())
        }
      } else if (detail?.files && detail.files.length > 0) {
        await handleImageFileUpload(detail.files, getMaxCount())
      } else if (detail?.imageBlob) {
        const file = new File([detail.imageBlob], 'pasted-image.png', {
          type: detail.imageType || 'image/png'
        })
        await handleImageFileUpload([file], getMaxCount())
      }
    }

    window.addEventListener('globalPasteImage', handleGlobalPasteImage)
    return () => window.removeEventListener('globalPasteImage', handleGlobalPasteImage)
  }, [handleImageFileUpload, modelParams, selectedModel, uploadedImagesCount, uploadedVideosCount])
}
