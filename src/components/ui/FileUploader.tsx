import React, { useRef, useState } from 'react'
import { useTauriDragDrop } from '../../hooks/useTauriDragDrop'
import { urlToFile } from '../../utils/imageConversion'
import { useDragDrop } from '../../contexts/DragDropContext'
import { readFile } from '@tauri-apps/plugin-fs'
import { isDesktop, inferMimeFromPath } from '../../utils/save'

type FileUploaderProps = {
    files: string[]
    onUpload: (files: File[]) => void
    onRemove: (index: number) => void
    onReplace?: (index: number, newFile: File) => void
    onReorder?: (from: number, to: number) => void
    accept?: string
    multiple?: boolean
    maxCount?: number
    disabled?: boolean
    className?: string
    removingIndices?: Set<string>
}

export default function FileUploader({
    files,
    onUpload,
    onRemove,
    onReplace,
    onReorder,
    accept = 'image/*',
    multiple = false,
    maxCount = 1,
    disabled = false,
    className = '',
    removingIndices = new Set()
}: FileUploaderProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [isHTML5Dragging, setIsHTML5Dragging] = useState(false)
    const dragCounter = useRef(0)
    const lastDropTime = useRef(0)
    const [reorderHoverIndex, setReorderHoverIndex] = useState<number | null>(null)
    const [isSorting, setIsSorting] = useState(false)
    const [sortFromIndex, setSortFromIndex] = useState<number | null>(null)
    const [sortOverIndex, setSortOverIndex] = useState<number | null>(null)

    // Custom drag and drop context
    const { isDragging: isCustomDragging, dragData, endDrag } = useDragDrop()

    // Handle Tauri native drag and drop
    const { isDragging: isTauriDragging, elementRef } = useTauriDragDrop((droppedFiles) => {
        handleFiles(droppedFiles)
    }, disabled)

    const isDragging = isHTML5Dragging || isTauriDragging || isCustomDragging

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
        console.log('[FileUploader] wrapper dragenter', { types: Array.from(e.dataTransfer.types || []) })
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
        console.log('[FileUploader] wrapper dragover', { types: Array.from(e.dataTransfer.types || []), hasReorderType })
        e.dataTransfer.dropEffect = hasReorderType ? 'move' : 'copy'
    }

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsHTML5Dragging(false)
        dragCounter.current = 0

        if (disabled) return

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            console.log('[FileUploader] wrapper drop files', { fileCount: e.dataTransfer.files.length })
            handleFiles(Array.from(e.dataTransfer.files))
            return
        }

        const fromIndexData = e.dataTransfer.getData('text/henji-reorder-index')
        console.log('[FileUploader] wrapper drop reorder', { fromIndexData })
        if (fromIndexData) {
            setReorderHoverIndex(null)
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
                        const filename = dragData.filePath.split(/[\\\/]/).pop() || `image-${Date.now()}.jpg`
                        file = new File([blob], filename, { type: mime })
                    } else {
                        // Fallback 到 URL 转换（开发环境或没有文件路径时）
                        file = await urlToFile(dragData.imageUrl, `image-${Date.now()}.jpg`)
                    }

                    handleFiles([file])
                } catch (error) {
                    console.error('Failed to convert dragged image:', error)
                }
            }
            endDrag()
        } else if (isSorting) {
            e.preventDefault()
            e.stopPropagation()
            if (typeof sortFromIndex === 'number' && typeof sortOverIndex === 'number' && onReorder && sortFromIndex !== sortOverIndex) {
                onReorder(sortFromIndex, sortOverIndex)
            }
            setIsSorting(false)
            setSortFromIndex(null)
            setSortOverIndex(null)
            setReorderHoverIndex(null)
        }
    }

    const beginSort = (index: number, e: React.MouseEvent) => {
        if (disabled || isCustomDragging) return
        if ((e as React.MouseEvent).button !== 0) return
        setIsSorting(true)
        setSortFromIndex(index)
        setReorderHoverIndex(index)
    }

    const enterSortTarget = (index: number) => {
        if (!isSorting) return
        setSortOverIndex(index)
        setReorderHoverIndex(index)
    }

    const endSort = () => {
        if (!isSorting) return
        if (typeof sortFromIndex === 'number' && typeof sortOverIndex === 'number' && onReorder && sortFromIndex !== sortOverIndex) {
            onReorder(sortFromIndex, sortOverIndex)
        }
        setIsSorting(false)
        setSortFromIndex(null)
        setSortOverIndex(null)
        setReorderHoverIndex(null)
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
            onMouseLeave={() => {
                if (isSorting) {
                    setIsSorting(false)
                    setSortFromIndex(null)
                    setSortOverIndex(null)
                    setReorderHoverIndex(null)
                }
            }}
        >
            {/* Previews */}
            {files.map((file, index) => {
                const handlePreviewDrop = async (e: React.DragEvent, targetIndex: number) => {
                    e.preventDefault()
                    e.stopPropagation()

                    if (disabled) return

                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        console.log('[FileUploader] drop replace', { targetIndex, fileCount: e.dataTransfer.files.length })
                        if (onReplace) {
                            const droppedFile = e.dataTransfer.files[0]
                            onReplace(targetIndex, droppedFile)
                        }
                        return
                    }

                    const fromIndexData = e.dataTransfer.getData('text/henji-reorder-index')
                    console.log('[FileUploader] drop reorder', { targetIndex, fromIndexData })
                    if (fromIndexData && onReorder) {
                        const from = parseInt(fromIndexData, 10)
                        if (!Number.isNaN(from) && from !== targetIndex) {
                            onReorder(from, targetIndex)
                        }
                    }
                    setReorderHoverIndex(null)
                }

                const handleCustomPreviewDrop = async (e: React.MouseEvent, targetIndex: number) => {
                    if (isCustomDragging && dragData && onReplace) {
                        e.preventDefault()
                        e.stopPropagation()

                        if (dragData.type === 'image') {
                            try {
                                let file: File

                                // 优先使用原始文件路径 (Tauri 环境)
                                if (dragData.filePath && isDesktop()) {
                                    const bytes = await readFile(dragData.filePath)
                                    const mime = inferMimeFromPath(dragData.filePath)
                                    const blob = new Blob([bytes], { type: mime })
                                    const filename = dragData.filePath.split(/[\\\/]/).pop() || `image-${Date.now()}.jpg`
                                    file = new File([blob], filename, { type: mime })
                                } else {
                                    // Fallback 到 URL 转换（开发环境或没有文件路径时）
                                    file = await urlToFile(dragData.imageUrl, `image-${Date.now()}.jpg`)
                                }

                                onReplace(targetIndex, file)
                            } catch (error) {
                                console.error('Failed to convert dragged image:', error)
                            }
                        }
                        endDrag()
                    }
                }

                return (
                    <div
                        key={`${file}-${index}`}
                        className="relative group flex-shrink-0"
                        style={{
                            animation: removingIndices.has(file)
                                ? 'imageSlideOut 0.25s ease-in forwards'
                                : 'imageSlideIn 0.25s ease-out forwards'
                        }}
                        onDrop={(e) => handlePreviewDrop(e, index)}
                        onMouseDown={(e) => beginSort(index, e)}
                        onMouseEnter={() => enterSortTarget(index)}
                        onMouseUp={(e) => {
                            if (isSorting) {
                                e.preventDefault()
                                e.stopPropagation()
                                endSort()
                            } else {
                                handleCustomPreviewDrop(e, index)
                            }
                        }}
                    >
                        <div className={`relative w-12 h-16 rounded-lg shadow-lg ${isCustomDragging ? 'ring-2 ring-[#007eff]' : ''} ${reorderHoverIndex === index ? 'ring-2 ring-amber-400' : ''}`}>
                            {accept.startsWith('image') ? (
                                <img
                                    src={file}
                                    alt={`Uploaded ${index + 1}`}
                                    className="w-full h-full object-cover rounded-lg border-2 border-white"
                                    draggable={false}
                                />
                            ) : (
                                <div className="w-full h-full bg-zinc-800 rounded-lg border-2 border-zinc-600 flex items-center justify-center">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </div>
                            )}

                            {/* Remove button - Enable pointer events */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onRemove(index)
                                }}
                                className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-lg z-20 pointer-events-auto"
                                type="button"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                )
            })}

            {/* Upload Button */}
            {canUploadMore && (
                <div
                    className={`w-12 h-16 bg-zinc-700/80 backdrop-blur-sm rounded-lg shadow-lg border-2 border-dashed ${isDragging ? 'border-[#007eff] bg-zinc-700/90' : 'border-zinc-700/50 hover:border-zinc-700/50'} flex items-center justify-center transition-all duration-200 cursor-pointer flex-shrink-0`}
                    onClick={() => !disabled && inputRef.current?.click()}
                    style={{
                        animation: 'imageSlideIn 0.25s ease-out forwards'
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${isDragging ? 'text-[#007eff]' : 'text-zinc-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                </div>
            )}

            <input
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
