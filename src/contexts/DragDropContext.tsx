import React, { createContext, useContext, useState, ReactNode, useRef, useCallback } from 'react'

interface DragData {
    type: 'image' | 'video'
    imageUrl: string  // 图片或视频的预览URL
    filePath?: string  // 原始文件路径 (仅 Tauri 环境，用于直接读取本地文件)
    thumbnailPath?: string  // 缩略图临时文件路径 (用于原生拖放图标)
    sourceType: 'history' | 'upload'
}

interface DragContextValue {
    isDragging: boolean
    dragData: DragData | null
    startDrag: (data: DragData, previewUrl: string) => void
    endDrag: () => void
    dragPosition: { x: number; y: number }
    previewUrl: string | null
}

const DragContext = createContext<DragContextValue | null>(null)

export const useDragDrop = () => {
    const context = useContext(DragContext)
    if (!context) {
        throw new Error('useDragDrop must be used within DragDropProvider')
    }
    return context
}

interface DragDropProviderProps {
    children: ReactNode
}

// 边缘检测阈值 (px)
const EDGE_THRESHOLD = 30

export const DragDropProvider: React.FC<DragDropProviderProps> = ({ children }) => {
    const [isDragging, setIsDragging] = useState(false)
    const [dragData, setDragData] = useState<DragData | null>(null)
    const previewRef = useRef<HTMLDivElement>(null)
    const dragDataRef = useRef<DragData | null>(null)
    const nativeDragTriggeredRef = useRef(false)
    const isPositionedRef = useRef(false)  // 跟踪预览是否已定位
    // We keep dragPosition in state only for initial placement if needed, 
    // but we won't update it on every mouse move to prevent re-renders.
    const [dragPosition] = useState({ x: 0, y: 0 })
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)

    const startDrag = useCallback((data: DragData, preview: string) => {
        setIsDragging(true)
        setDragData(data)
        dragDataRef.current = data
        nativeDragTriggeredRef.current = false
        isPositionedRef.current = false  // 重置定位状态
        setPreviewUrl(preview)
    }, [])

    const endDrag = useCallback(() => {
        setIsDragging(false)
        setDragData(null)
        dragDataRef.current = null
        setPreviewUrl(null)
    }, [])

    // 触发原生拖放
    const triggerNativeDrag = useCallback(async () => {
        const data = dragDataRef.current
        if (!data?.filePath || nativeDragTriggeredRef.current) return

        nativeDragTriggeredRef.current = true

        try {
            const { startDrag: nativeStartDrag } = await import('@crabnebula/tauri-plugin-drag')

            // 使用缩略图作为图标，如果没有则使用原文件
            const iconPath = data.thumbnailPath || data.filePath

            // 结束自定义拖放（隐藏预览）
            setIsDragging(false)
            setPreviewUrl(null)

            // 启动原生拖放
            await nativeStartDrag({ item: [data.filePath], icon: iconPath })
        } catch (err) {
            console.log('[DragDrop] Native drag cancelled or failed:', err)
        } finally {
            // 无论成功与否，重置状态
            setDragData(null)
            dragDataRef.current = null
        }
    }, [])

    // Global mouse move handler with edge detection
    React.useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return

            // 更新预览位置
            if (previewRef.current) {
                previewRef.current.style.left = `${e.clientX - 32}px`
                previewRef.current.style.top = `${e.clientY - 32}px`
                // 首次定位后显示预览（避免闪烁到左上角）
                if (!isPositionedRef.current) {
                    isPositionedRef.current = true
                    previewRef.current.style.opacity = '0.8'
                }
            }

            // 边缘检测：当鼠标接近窗口边缘时，触发原生拖放
            const data = dragDataRef.current
            if (data?.filePath && !nativeDragTriggeredRef.current) {
                const nearLeft = e.clientX < EDGE_THRESHOLD
                const nearRight = e.clientX > window.innerWidth - EDGE_THRESHOLD
                const nearTop = e.clientY < EDGE_THRESHOLD
                const nearBottom = e.clientY > window.innerHeight - EDGE_THRESHOLD

                if (nearLeft || nearRight || nearTop || nearBottom) {
                    triggerNativeDrag()
                }
            }
        }

        const handleMouseUp = () => {
            if (isDragging) {
                endDrag()
            }
        }

        // 检测鼠标离开窗口（解决最大化时叠加窗口的场景）
        // 当 relatedTarget 为 null 时，表示鼠标离开了文档区域
        const handleMouseLeave = (e: MouseEvent) => {
            if (!isDragging) return

            const data = dragDataRef.current
            // relatedTarget === null 表示鼠标离开了窗口（而不是移动到其他元素）
            if (data?.filePath && !nativeDragTriggeredRef.current && e.relatedTarget === null) {
                triggerNativeDrag()
            }
        }

        // 检测窗口失焦（解决 Alt+Tab 切换窗口的场景）
        const handleWindowBlur = () => {
            if (!isDragging) return

            const data = dragDataRef.current
            if (data?.filePath && !nativeDragTriggeredRef.current) {
                triggerNativeDrag()
            }
        }

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
            document.addEventListener('mouseleave', handleMouseLeave)
            window.addEventListener('blur', handleWindowBlur)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.removeEventListener('mouseleave', handleMouseLeave)
            window.removeEventListener('blur', handleWindowBlur)
        }
    }, [isDragging, endDrag, triggerNativeDrag])

    return (
        <DragContext.Provider value={{ isDragging, dragData, startDrag, endDrag, dragPosition, previewUrl }}>
            {children}
            {/* Drag preview */}
            {isDragging && previewUrl && (
                <div
                    ref={previewRef}
                    style={{
                        position: 'fixed',
                        left: 0,
                        top: 0,
                        pointerEvents: 'none',
                        zIndex: 9999,
                        opacity: 0,  // 初始隐藏，等待第一次 mousemove 后显示
                    }}
                >
                    <img
                        src={previewUrl}
                        alt="Dragging"
                        className="max-w-16 max-h-16 object-contain rounded-lg shadow-2xl border-2 border-[#007eff] bg-zinc-900/80"
                    />
                </div>
            )}
        </DragContext.Provider>
    )
}
