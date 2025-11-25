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
    onDragStateChange?: (isDragging: boolean) => void
    accept?: string
    multiple?: boolean
    maxCount?: number
    disabled?: boolean
    className?: string
}

export default function FileUploader({
    files,
    onUpload,
    onRemove,
    onReplace,
    onReorder,
    onDragStateChange,
    accept = 'image/*',
    multiple = false,
    maxCount = 1,
    disabled = false,
    className = ''
}: FileUploaderProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [isHTML5Dragging, setIsHTML5Dragging] = useState(false)
    const dragCounter = useRef(0)
    const lastDropTime = useRef(0)
    const [dragState, setDragState] = useState<{
        isDragging: boolean
        isDropping: boolean
        fromIndex: number | null
        toIndex: number | null
        startX: number
        startY: number
        currentX: number
        currentY: number
    }>({
        isDragging: false,
        isDropping: false,
        fromIndex: null,
        toIndex: null,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0
    })
    const dragStateRef = useRef(dragState)
    dragStateRef.current = dragState

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
        }
    }

    const itemRefs = useRef<(HTMLDivElement | null)[]>([])

    const handleMouseDown = (index: number, e: React.MouseEvent) => {
        // 防止在删除按钮上触发拖拽
        const target = e.target as HTMLElement;
        // 检查点击的元素或其父元素是否为删除按钮
        if (target.tagName === 'BUTTON' || target.closest('button')) {
            e.preventDefault(); // 防止默认行为
            return;
        }

        if (disabled || isCustomDragging || e.button !== 0) return
        e.preventDefault()
        console.log('[Drag] Start', { index, x: e.clientX, y: e.clientY })
        setDragState({
            isDragging: false, // 初始状态不拖拽，等待鼠标移动确认
            isDropping: false,
            fromIndex: index,
            toIndex: index,
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY
        })
    }

    React.useEffect(() => {
        if (!dragState.isDragging) return

        const handleMouseMove = (e: MouseEvent) => {
            const from = dragStateRef.current.fromIndex!
            const oldTo = dragStateRef.current.toIndex!

            let newToIndex = from
            let minDist = Infinity

            // 获取当前拖拽元素的位置
            const draggingEl = itemRefs.current[from]
            if (!draggingEl) return

            const draggingRect = draggingEl.getBoundingClientRect()
            const draggingCenterX = draggingRect.left + draggingRect.width / 2

            // 找到最近的目标位置
            for (let i = 0; i < itemRefs.current.length; i++) {
                if (i === from) continue

                const el = itemRefs.current[i]
                if (!el) continue
                const rect = el.getBoundingClientRect()
                const targetCenterX = rect.left + rect.width / 2

                const dist = Math.abs(draggingCenterX - targetCenterX)
                if (dist < minDist) {
                    minDist = dist
                    newToIndex = i
                }
            }

            // 更灵敏的阈值
            const threshold = 28

            if (minDist < threshold && newToIndex !== oldTo) {
                setDragState({
                    ...dragStateRef.current,
                    currentX: e.clientX,
                    currentY: e.clientY,
                    toIndex: newToIndex
                })
            } else {
                setDragState({
                    ...dragStateRef.current,
                    currentX: e.clientX,
                    currentY: e.clientY
                })
            }
        }

        const handleMouseUp = () => {
            const { fromIndex, toIndex } = dragStateRef.current

            // 如果发生了位置变化，进入 dropping 状态
            if (fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
                // 设置 dropping 状态，触发归位动画
                setDragState(prev => ({
                    ...prev,
                    isDragging: false,
                    isDropping: true
                }))

                // 动画结束后执行实际的 reorder 和状态重置
                setTimeout(() => {
                    if (onReorder) {
                        onReorder(fromIndex, toIndex)
                    }
                    setDragState({
                        isDragging: false,
                        isDropping: false,
                        fromIndex: null,
                        toIndex: null,
                        startX: 0,
                        startY: 0,
                        currentX: 0,
                        currentY: 0
                    })
                }, 150) // 动画时长，与 CSS transition 匹配
            } else {
                // 如果没有位置变化，直接重置
                setDragState({
                    isDragging: false,
                    isDropping: false,
                    fromIndex: null,
                    toIndex: null,
                    startX: 0,
                    startY: 0,
                    currentX: 0,
                    currentY: 0
                })
            }
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [dragState.isDragging, onReorder])

    // 通知父组件拖动状态变化 (包括 dropping 状态)
    React.useEffect(() => {
        const isActive = dragState.isDragging || dragState.isDropping
        onDragStateChange?.(isActive)
    }, [dragState.isDragging, dragState.isDropping, onDragStateChange])

    // 添加拖拽确认逻辑
    React.useEffect(() => {
        if (dragState.fromIndex === null || dragState.isDragging || dragState.isDropping) return

        let moved = false
        const startX = dragState.startX
        const startY = dragState.startY

        const handleMouseMove = (e: MouseEvent) => {
            const deltaX = Math.abs(e.clientX - startX)
            const deltaY = Math.abs(e.clientY - startY)

            if (deltaX > 5 || deltaY > 5) {
                setDragState(prev => ({
                    ...prev,
                    isDragging: true
                }))
                moved = true
            }
        }

        const handleMouseUp = () => {
            if (!moved) {
                setDragState({
                    isDragging: false,
                    isDropping: false,
                    fromIndex: null,
                    toIndex: null,
                    startX: 0,
                    startY: 0,
                    currentX: 0,
                    currentY: 0
                })
            }
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [dragState.fromIndex, dragState.isDragging, dragState.isDropping, dragState.startX, dragState.startY])

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
            {/* Previews */}
            {dragState.isDragging && console.log('[Render]', { fromIndex: dragState.fromIndex, toIndex: dragState.toIndex }) as any}
            {files.map((file, index) => {
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
                                console.error('Failed to convert dragged image:', error)
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
                        <div className={`relative w-12 h-16 rounded-lg shadow-lg ${isDraggingThis ? 'ring-2 ring-[#007eff] shadow-2xl' : ''} ${isCustomDragging ? 'ring-2 ring-[#007eff]' : ''}`}>
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

                            <button
                                onClick={(e) => {
                                    e.stopPropagation()  // 阻止事件冒泡
                                    e.preventDefault()    // 防止默认行为
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
