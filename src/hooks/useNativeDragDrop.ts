import { createLogger } from '@/core/logging'
import { useEffect, useState, useRef } from 'react'
import { getPlatform } from '@/platform/runtime'
import { isDesktop } from '../utils/save'

const logger = createLogger('hooks.useNativeDragDrop')

export function useNativeDragDrop(
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
        const unlistenDrop = platform.onFilesDropped((files, target) => {
            setIsDragging(false)
            const containerEl = elementRef.current
            if (!containerEl) {
                logger.warn('[DragDrop] Drop ignored - target container not mounted')
                return
            }
            // 文档级监听会收到窗口里任何位置的松手：只收落在自己范围内的，否则每个挂着的上传器都会导入同一批文件
            if (!(target instanceof Node) || !containerEl.contains(target)) return
            onDropRef.current(files)
        })

        return () => {
            unlistenState()
            unlistenDrop()
        }
    }, [disabled])

    return { isDragging, elementRef }
}
