import { createLogger } from '@/core/logging'
import React, { useRef, useState } from 'react'
import { useTauriDragDrop } from '../../hooks/useTauriDragDrop'
import { urlToFile } from '../../utils/imageConversion'
import { useDragDrop } from '../../contexts/DragDropContext'
import { readFile } from '@/platform/desktopApi'
import { isDesktop, inferMimeFromPath } from '../../utils/save'
import { useReorderDrag } from './fileUploader/useReorderDrag'
import { UiButton, UiIconButton, UiInput } from './primitives'

const logger = createLogger('components.ui.FileUploader')

export interface FileUploaderProps {
    files: string[]
    onUpload: (files: File[]) => Promise<void> | void
    onRemove: (index: number) => void
    onReplace?: (index: number, newFile: File) => Promise<void> | void
    onReorder?: (from: number, to: number) => void
    onDragStateChange?: (isDragging: boolean) => void
    onImageClick?: (imageUrl: string, imageList: string[]) => void
    accept?: string
    multiple?: boolean
    maxCount?: number
    disabled?: boolean
    className?: string
    hideUploadButton?: boolean
    videoCount?: number  // 混合模式下，前 N 个文件是视频（已废弃，使用 fileTypes）
    fileTypes?: Array<'video' | 'image'>  // 每个文件的类型（用于混合模式）
}

export default function FileUploader({
    files,
    onUpload,
    onRemove,
    onReplace,
    onReorder,
    onDragStateChange,
    onImageClick,
    accept = 'image/*',
    multiple = false,
    maxCount = 1,
    disabled = false,
    className = '',
    hideUploadButton = false,
    videoCount = 0,
    fileTypes
}: FileUploaderProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [isHTML5Dragging, setIsHTML5Dragging] = useState(false)
    const dragCounter = useRef(0)
    const lastDropTime = useRef(0)

    // Custom drag and drop context
    const { isDragging: isCustomDragging, dragData, endDrag } = useDragDrop()

    // Handle Tauri native drag and drop
    const { isDragging: isTauriDragging, elementRef } = useTauriDragDrop((droppedFiles) => {
        handleFiles(droppedFiles)
    }, disabled)

    const isDragging = isHTML5Dragging || isTauriDragging || isCustomDragging
    const {
        dragState,
        itemRefs,
        handleMouseDown
    } = useReorderDrag({
        disabled,
        isCustomDragging,
        files,
        onReorder,
        onDragStateChange,
        onImageClick
    })

    const handleFiles = (newFiles: File[]) => {
        const now = Date.now()
        if (now - lastDropTime.current < 500) {
            return
        }
        lastDropTime.current = now

        // Filter by accept type if needed (simple check)
        const acceptedFiles = newFiles.filter(file => {
            if (accept === '*') return true
            if (accept === 'image/*') return file.type.startsWith('image/')
            if (accept === 'video/*') return file.type.startsWith('video/')
            if (accept === 'audio/*') return file.type.startsWith('audio/')
            // Complex mime type checking can be added if needed
            return true
        })

        if (acceptedFiles.length > 0) {
            onUpload(acceptedFiles)
        }
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFiles(Array.from(e.target.files))
            // Reset input value to allow selecting the same file again
            const target = e.target as HTMLInputElement
            target.value = ''
        }
    }

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current += 1
        setIsHTML5Dragging(true)
        logger.info('[FileUploader] wrapper dragenter', { types: Array.from(e.dataTransfer.types || []) })
        const hasReorderType = Array.from(e.dataTransfer.types || []).includes('text/henji-reorder-index')
        if (hasReorderType) {
            e.dataTransfer.dropEffect = 'move'
        }
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current -= 1
        if (dragCounter.current === 0) {
            setIsHTML5Dragging(false)
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const hasReorderType = Array.from(e.dataTransfer.types || []).includes('text/henji-reorder-index')
        logger.info('[FileUploader] wrapper dragover', { types: Array.from(e.dataTransfer.types || []), hasReorderType })
        e.dataTransfer.dropEffect = hasReorderType ? 'move' : 'copy'
    }

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsHTML5Dragging(false)
        dragCounter.current = 0

        if (disabled) return

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            logger.info('[FileUploader] wrapper drop files', { fileCount: e.dataTransfer.files.length })
            handleFiles(Array.from(e.dataTransfer.files))
            return
        }

        const fromIndexData = e.dataTransfer.getData('text/henji-reorder-index')
        logger.info('[FileUploader] wrapper drop reorder', { fromIndexData })
        if (fromIndexData) {

        }
    }

    // Handle custom drag drop
    const handleCustomDrop = async (e: React.MouseEvent) => {
        if (isCustomDragging && dragData) {
            e.preventDefault()
            e.stopPropagation()

            // Drop detected!
            if (dragData.type === 'image') {
                try {
                    let file: File

                    // 优先使用原始文件路径 (Tauri 环境)
                    if (dragData.filePath && isDesktop()) {
                        const bytes = await readFile(dragData.filePath)
                        const mime = inferMimeFromPath(dragData.filePath)
                        const blob = new Blob([bytes], { type: mime })
                        const filename = dragData.filePath.split(/[\\/]/).pop() || `image-${Date.now()}.jpg`
                        file = new File([blob], filename, { type: mime })
                    } else {
                        // Fallback 到 URL 转换（开发环境或没有文件路径时）
                        file = await urlToFile(dragData.imageUrl, `image-${Date.now()}.jpg`)
                    }

                    handleFiles([file])
                } catch (error) {
                    logger.error('Failed to convert dragged image:', error)
                }
            } else if (dragData.type === 'video') {
                try {
                    let file: File

                    // 视频只能通过文件路径读取
                    if (dragData.filePath && isDesktop()) {
                        const bytes = await readFile(dragData.filePath)
                        const mime = inferVideoMimeFromPath(dragData.filePath)
                        const blob = new Blob([bytes], { type: mime })
                        const filename = dragData.filePath.split(/[\\/]/).pop() || `video-${Date.now()}.mp4`
                        file = new File([blob], filename, { type: mime })
                        handleFiles([file])
                    } else {
                        logger.error('Video drag requires a file path', {})
                    }
                } catch (error) {
                    logger.error('Failed to convert dragged video:', error)
                }
            }
            endDrag()
        }
    }

    // 推断视频 MIME 类型
    const inferVideoMimeFromPath = (path: string): string => {
        const lower = path.toLowerCase()
        if (lower.endsWith('.mp4')) return 'video/mp4'
        if (lower.endsWith('.webm')) return 'video/webm'
        if (lower.endsWith('.mov')) return 'video/quicktime'
        if (lower.endsWith('.avi')) return 'video/x-msvideo'
        if (lower.endsWith('.mkv')) return 'video/x-matroska'
        return 'video/mp4'
    }

    const canUploadMore = !maxCount || files.length < maxCount

    return (
        <div
            ref={elementRef}
            className={`flex items-center gap-2 transition-all duration-200 rounded-lg ${className}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onMouseUp={handleCustomDrop}
        >
            {/* Previews - 过滤掉 undefined 的文件项，避免状态更新时的闪烁 */}
            {files.filter(file => file !== undefined && file !== null).map((file, index) => {
                const isDraggingThis = dragState.isDragging && dragState.fromIndex === index
                const isDroppingThis = dragState.isDropping && dragState.fromIndex === index
                const shouldShift = (dragState.isDragging || dragState.isDropping) && dragState.fromIndex !== null && dragState.toIndex !== null

                let translateX = 0
                let scale = 1

                if (shouldShift && !isDraggingThis && !isDroppingThis) {
                    const from = dragState.fromIndex!
                    const to = dragState.toIndex!
                    // 使用准确的位移量，图片宽度为48px + 8px gap = 56px
                    if (from < to && index > from && index <= to) {
                        translateX = -56
                    } else if (from > to && index < from && index >= to) {
                        translateX = 56
                    }
                }

                // 如果是目标位置，添加轻微的缩放效果
                if (dragState.toIndex === index && !isDraggingThis && !isDroppingThis) {
                    scale = 0.95
                }

                // 计算 dropping 时的目标位置
                let dropTransform = ''
                if (isDroppingThis) {
                    const from = dragState.fromIndex!
                    const to = dragState.toIndex!
                    const moveX = (to - from) * 56 // 56px per item
                    dropTransform = `translateX(${moveX}px)`
                }

                const handleCustomPreviewDrop = async (e: React.MouseEvent, targetIndex: number) => {
                    if (isCustomDragging && dragData && onReplace) {
                        e.preventDefault()
                        e.stopPropagation()

                        if (dragData.type === 'image') {
                            try {
                                let file: File
                                if (dragData.filePath && isDesktop()) {
                                    const bytes = await readFile(dragData.filePath)
                                    const mime = inferMimeFromPath(dragData.filePath)
                                    const blob = new Blob([bytes], { type: mime })
                                    const filename = dragData.filePath.split(/[\\\/]/).pop() || `image-${Date.now()}.jpg`
                                    file = new File([blob], filename, { type: mime })
                                } else {
                                    file = await urlToFile(dragData.imageUrl, `image-${Date.now()}.jpg`)
                                }
                                onReplace(targetIndex, file)
                            } catch (error) {
                                logger.error('Failed to convert dragged image:', error)
                            }
                        }
                        endDrag()
                    }
                }

                return (
                    <div
                        key={`${file}-${index}`}
                        ref={el => itemRefs.current[index] = el}
                        className="relative group flex-shrink-0"
                        style={{
                            transform: isDraggingThis
                                ? `translate(${dragState.currentX - dragState.startX}px, ${dragState.currentY - dragState.startY}px) scale(1.15)`
                                : isDroppingThis
                                    ? dropTransform
                                    : `translateX(${translateX}px) scale(${scale})`,
                            transition: isDraggingThis ? 'none' : 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                            pointerEvents: isDraggingThis || isDroppingThis ? 'none' : 'auto',
                            opacity: isDraggingThis ? 0.8 : 1,
                            visibility: 'visible',
                            position: isDraggingThis ? 'relative' : 'static',
                            zIndex: isDraggingThis || isDroppingThis ? 10000 : 'auto'
                        }}
                        onMouseDown={(e) => handleMouseDown(index, e)}
                        onMouseUp={(e) => !dragState.isDragging && handleCustomPreviewDrop(e, index)}
                    >
                        <div className={`relative w-12 h-16 rounded-lg shadow-lg ${isDraggingThis ? 'ring-2 ring-accent shadow-2xl' : ''} ${isCustomDragging ? 'ring-2 ring-accent' : ''}`}>
                            {(() => {
                                // 判断当前文件是视频还是图片
                                // 优先使用 fileTypes 数组（精确），回退到 videoCount（位置判断）
                                const isVideo = fileTypes
                                    ? fileTypes[index] === 'video'
                                    : (videoCount > 0 && index < videoCount)

                                if (isVideo) {
                                    // 视频：显示缩略图 + 播放按钮
                                    return (
                                        <div className="relative w-full h-full">
                                            <img
                                                src={file}
                                                alt={`Video thumbnail ${index + 1}`}
                                                className="w-full h-full object-cover rounded-lg border-2 border-white"
                                                draggable={false}
                                            />
                                            {/* 播放图标覆盖层 */}
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg pointer-events-none">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white opacity-90" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </div>
                                        </div>
                                    )
                                } else {
                                    // 图片：直接显示
                                    return (
                                        <img
                                            src={file}
                                            alt={`Uploaded ${index + 1}`}
                                            className="w-full h-full object-cover rounded-lg border-2 border-white"
                                            draggable={false}
                                        />
                                    )
                                }
                            })()}

                            <UiIconButton
                                onClick={(e) => {
                                    e.stopPropagation()  // 阻止事件冒泡
                                    e.preventDefault()    // 防止默认行为
                                    onRemove(index)
                                }}
                                className="absolute -top-2 -right-2 h-5 w-5 border-0 bg-red-500 p-1 text-white opacity-0 shadow-lg transition-opacity duration-200 hover:bg-red-600 group-hover:opacity-100 z-20 pointer-events-auto"
                                type="button"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </UiIconButton>
                        </div>
                    </div>
                )
            })}


            {/* Upload Button */}
            {canUploadMore && !hideUploadButton && (
                <UiButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`h-16 w-12 rounded-lg border-2 border-dashed p-0 shadow-lg ${isDragging ? 'border-accent bg-zinc-700/90' : 'border-zinc-700/50 bg-zinc-700/80 backdrop-blur-sm hover:border-zinc-700/50'} flex-shrink-0`}
                    onClick={() => !disabled && inputRef.current?.click()}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${isDragging ? 'text-accent' : 'text-zinc-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                </UiButton>
            )}

            <UiInput
                type="file"
                ref={inputRef}
                onChange={handleFileChange}
                accept={accept}
                multiple={multiple}
                className="hidden"
                disabled={disabled}
            />
        </div>
    )
}


