import { createLogger } from '@/core/logging'
import { useEffect, useState, useRef } from 'react'
import { getPlatform } from '@/platform/runtime'
import { isDesktop } from '../utils/save'

const logger = createLogger('hooks.useTauriDragDrop')

export function useTauriDragDrop(
    onDrop: (files: File[]) => void,
    disabled: boolean = false
) {
    const [isDragging, setIsDragging] = useState(false)
    const elementRef = useRef<HTMLDivElement>(null)
    const onDropRef = useRef(onDrop)

    // Update ref when onDrop changes
    useEffect(() => {
        onDropRef.current = onDrop
    }, [onDrop])

    useEffect(() => {
        if (!isDesktop() || disabled) return

        const platform = getPlatform().dragDrop
        const unlistenState = platform.onDragStateChange(setIsDragging)
        const unlistenDrop = platform.onFilesDropped((files) => {
            setIsDragging(false)
            const containerEl = elementRef.current
            if (!containerEl) {
                logger.warn('[DragDrop] Drop ignored - target container not mounted')
                return
            }
            onDropRef.current(files)
        })

        return () => {
            unlistenState()
            unlistenDrop()
        }
    }, [disabled])

    return { isDragging, elementRef }
}
