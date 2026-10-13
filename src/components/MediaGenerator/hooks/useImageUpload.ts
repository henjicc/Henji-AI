import { createLogger } from '@/core/logging'
import { useRef, useState } from 'react'
import { dataUrlToFile, extractImagesFromClipboard } from '@/utils/imageConversion'
import { importLocalMedia, readClipboardImageSources, type LocalMediaImportInput } from '@/services/localMediaImport'
import { toDisplaySrc } from '@/platform/desktopApi'
import { isDesktopRuntime } from '@/platform/runtime'

const logger = createLogger('components.MediaGenerator.hooks.useImageUpload')

interface ImageUploadHandlers {
  isDraggingImage: boolean
  setIsDraggingImage: React.Dispatch<React.SetStateAction<boolean>>
  handleImageFileUpload: (files: LocalMediaImportInput[], maxImageCount: number) => Promise<void>
  handleImageReplace: (index: number, newFile: File) => Promise<void>
  handlePaste: (event: ClipboardEvent, maxImageCount: number) => Promise<void>
  removeImage: (index: number) => void
  handleImageReorder: (from: number, to: number) => void
  handleImageFileDrop: (files: File[], maxImageCount: number) => Promise<void>
}

/**
 * 图片上传处理逻辑
 * 包含上传、粘贴、拖拽、替换、删除、重排序等功能
 *
 * 文件与剪贴板路径都经唯一媒体导入入口，预览与生成使用的原文件路径同时回填。
 */
export const useImageUpload = (
  uploadedImages: string[],
  setUploadedImages: React.Dispatch<React.SetStateAction<string[]>>,
  uploadedFilePaths: string[],
  setUploadedFilePaths: React.Dispatch<React.SetStateAction<string[]>>
): ImageUploadHandlers => {
  const [isDraggingImage, setIsDraggingImage] = useState(false)
  const imagesRef = useRef(uploadedImages)
  const pathsRef = useRef(uploadedFilePaths)
  imagesRef.current = uploadedImages
  pathsRef.current = uploadedFilePaths
  const pendingCount = useRef(0)

  const handleImageFileUpload = async (files: LocalMediaImportInput[], maxImageCount: number): Promise<void> => {
    for (const file of files) {
      if (imagesRef.current.length + pendingCount.current >= maxImageCount) break
      pendingCount.current++
      try {
        const imported = await importLocalMedia(file, 'image')
        if (imported.kind !== 'image') throw new Error('导入的文件不是图片')
        imagesRef.current = [...imagesRef.current, toDisplaySrc(imported.previewPath)]
        pathsRef.current = [...imagesRef.current.slice(0, -1).map((_, index) => pathsRef.current[index] || ''), imported.fullPath]
        setUploadedImages(imagesRef.current)
        setUploadedFilePaths(pathsRef.current)
      } finally {
        pendingCount.current--
      }
    }
  }

  // 替换时保留预览与原文件路径的一一对应。
  const handleImageReplace = async (index: number, newFile: File) => {
    const imported = await importLocalMedia(newFile, 'image')
    if (imported.kind !== 'image') throw new Error('导入的文件不是图片')
    setUploadedImages(prev => {
      const updated = [...prev]
      updated[index] = toDisplaySrc(imported.previewPath)
      return updated
    })
    setUploadedFilePaths(prev => {
      const updated = imagesRef.current.map((_, i) => prev[i] || '')
      updated[index] = imported.fullPath
      return updated
    })
  }

  // 桌面复制文件优先按路径导入；截图继续走位图，浏览器走事件 File。
  const handlePaste = async (event: ClipboardEvent, maxImageCount: number): Promise<void> => {
    try {
      const containsMedia = Array.from(event.clipboardData?.items ?? [])
        .some((item) => item.type.startsWith('image/') || item.kind === 'file')
        || (event.clipboardData?.files.length ?? 0) > 0
      if (containsMedia) event.preventDefault()
      if (uploadedImages.length >= maxImageCount) return
      if (isDesktopRuntime()) {
        const sources = await readClipboardImageSources()
        if (sources.length) {
          event.preventDefault()
          const files: LocalMediaImportInput[] = []
          for (const source of sources.slice(0, maxImageCount - imagesRef.current.length)) {
            files.push('path' in source ? source : await dataUrlToFile(source.dataUrl, source.name || 'pasted-image.png'))
          }
          await handleImageFileUpload(files, maxImageCount)
          return
        }
      }
      const pastedFiles = await extractImagesFromClipboard(event)
      if (pastedFiles.length === 0) return

      if (uploadedImages.length >= maxImageCount) return

      const availableSlots = maxImageCount - uploadedImages.length
      const filesToAdd = pastedFiles.slice(0, availableSlots)

      await handleImageFileUpload(filesToAdd, maxImageCount)
    } catch (error) {
      logger.error('[useImageUpload] 粘贴图片失败', error)
      throw error
    }
  }

  // 删除图片
  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
    setUploadedFilePaths(prev => prev.filter((_, i) => i !== index))
  }

  // 重排序图片
  const handleImageReorder = (from: number, to: number) => {
    if (from === to) return
    setUploadedImages(prev => {
      const arr = [...prev]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return arr
    })
    setUploadedFilePaths(prev => {
      const arr = [...prev]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return arr
    })
  }

  // 拖拽与选择文件共用导入入口。
  const handleImageFileDrop = async (files: File[], maxImageCount: number) => {
    await handleImageFileUpload(files.filter(file => file.type.startsWith('image/')), maxImageCount)
  }

  return {
    isDraggingImage,
    setIsDraggingImage,
    handleImageFileUpload,
    handleImageReplace,
    handlePaste,
    removeImage,
    handleImageReorder,
    handleImageFileDrop
  }
}

