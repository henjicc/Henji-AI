import { useState, useCallback } from 'react'

/**
 * 拖拽上传处理
 * 职责：处理文件拖拽上传逻辑
 */
export const useDragAndDrop = (
  onImageDrop: (files: File[]) => void,
  onDragStateChange: (isDragging: boolean) => void
) => {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    onDragStateChange(true)
  }, [onDragStateChange])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    onDragStateChange(false)
  }, [onDragStateChange])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    onDragStateChange(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      onImageDrop(files)
    }
  }, [onImageDrop, onDragStateChange])

  return {
    isDragging,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop
  }
}
