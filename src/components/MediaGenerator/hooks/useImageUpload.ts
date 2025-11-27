import { useState } from 'react'
import { saveUploadImage } from '@/utils/save'
import { extractImagesFromClipboard } from '@/utils/imageConversion'

/**
 * 图片上传处理逻辑
 * 包含上传、粘贴、拖拽、替换、删除、重排序等功能
 *
 * 注意：上传时只保存到内存（memory 模式），点击生成时才保存到 uploads 目录
 */
export const useImageUpload = (
  uploadedImages: string[],
  setUploadedImages: React.Dispatch<React.SetStateAction<string[]>>,
  _uploadedFilePaths: string[],
  setUploadedFilePaths: React.Dispatch<React.SetStateAction<string[]>>
) => {
  const [isDraggingImage, setIsDraggingImage] = useState(false)

  // 文件上传 - 只保存到内存
  const handleImageFileUpload = async (files: File[], maxImageCount: number) => {
    if (files.length > 0) {
      for (const file of files) {
        if (file) {
          const saved = await saveUploadImage(file, 'memory')
          setUploadedImages(prev => {
            if (prev.length >= maxImageCount) return prev
            return [...prev, saved.dataUrl]
          })
          // 不设置 filePath，因为还没有保存到 uploads 目录
        }
      }
    }
  }

  // 替换图片 - 只保存到内存
  const handleImageReplace = async (index: number, newFile: File) => {
    const saved = await saveUploadImage(newFile, 'memory')
    setUploadedImages(prev => {
      const updated = [...prev]
      updated[index] = saved.dataUrl
      return updated
    })
    // 清除旧的 filePath
    setUploadedFilePaths(prev => {
      const updated = [...prev]
      updated[index] = ''
      return updated
    })
  }

  // 粘贴图片 - 只保存到内存
  const handlePaste = async (e: React.ClipboardEvent, maxImageCount: number) => {
    try {
      const pastedFiles = await extractImagesFromClipboard(e.nativeEvent)
      if (pastedFiles.length === 0) return

      if (uploadedImages.length >= maxImageCount) return

      const availableSlots = maxImageCount - uploadedImages.length
      const filesToAdd = pastedFiles.slice(0, availableSlots)

      for (const file of filesToAdd) {
        const saved = await saveUploadImage(file, 'memory')
        setUploadedImages(prev => {
          if (prev.length >= maxImageCount) return prev
          return [...prev, saved.dataUrl]
        })
        // 不设置 filePath，因为还没有保存到 uploads 目录
      }
    } catch (error) {
      console.error('[useImageUpload] 粘贴图片失败', error)
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

  // 拖拽图片 - 只保存到内存
  const handleImageFileDrop = async (files: File[], maxImageCount: number) => {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const saved = await saveUploadImage(file, 'memory')
        setUploadedImages(prev => {
          if (prev.length >= maxImageCount) return prev
          return [...prev, saved.dataUrl]
        })
        // 不设置 filePath，因为还没有保存到 uploads 目录
      }
    }
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
