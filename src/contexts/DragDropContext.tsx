import React, { createContext, useContext, useState, ReactNode } from 'react'

interface DragData {
    type: 'image'
    imageUrl: string
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

export const DragDropProvider: React.FC<DragDropProviderProps> = ({ children }) => {
    const [isDragging, setIsDragging] = useState(false)
    const [dragData, setDragData] = useState<DragData | null>(null)
    const previewRef = React.useRef<HTMLDivElement>(null)
    // We keep dragPosition in state only for initial placement if needed, 
    // but we won't update it on every mouse move to prevent re-renders.
    const [dragPosition] = useState({ x: 0, y: 0 })
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)

    const startDrag = (data: DragData, preview: string) => {
        setIsDragging(true)
        setDragData(data)
        setPreviewUrl(preview)
    }

    const endDrag = () => {
        setIsDragging(false)
        setDragData(null)
        setPreviewUrl(null)
    }

    // Global mouse move handler
    React.useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                // Directly update DOM to avoid re-renders
                if (previewRef.current) {
                    previewRef.current.style.left = `${e.clientX - 32}px`
                    previewRef.current.style.top = `${e.clientY - 32}px`
                }
            }
        }

        const handleMouseUp = () => {
            if (isDragging) {
                endDrag()
            }
        }

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging])

    return (
        <DragContext.Provider value={{ isDragging, dragData, startDrag, endDrag, dragPosition, previewUrl }}>
            {children}
            {/* Drag preview */}
            {isDragging && previewUrl && (
                <div
                    ref={previewRef}
                    style={{
                        position: 'fixed',
                        left: 0, // Initial position, will be updated by JS immediately
                        top: 0,
                        pointerEvents: 'none',
                        zIndex: 9999,
                        opacity: 0.8,
                        // Hide initially until first move to avoid jumping from 0,0? 
                        // Or we can rely on the fact that mousemove fires quickly.
                        // Better: use a ref to store the last mouse position if available?
                        // For now, let's just let it update on first move.
                    }}
                >
                    <img
                        src={previewUrl}
                        alt="Dragging"
                        className="w-16 h-16 object-cover rounded-lg shadow-2xl border-2 border-[#007eff]"
                    />
                </div>
            )}
        </DragContext.Provider>
    )
}
