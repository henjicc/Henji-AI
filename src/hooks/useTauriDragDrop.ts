import { useEffect, useState, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { readFile } from '@tauri-apps/plugin-fs'
import { inferMimeFromPath, isDesktop } from '../utils/save'
import { logError } from '../utils/errorLogger'

type DragPosition = { x: number; y: number }
type DragDropPayload = { paths: string[]; position: DragPosition }

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

        const unlisteners: Promise<() => void>[] = []

        const setupListeners = () => {
            unlisteners.push(listen('tauri://drag-enter', () => {
                setIsDragging(true)
            }))

            unlisteners.push(listen('tauri://drag-leave', () => {
                setIsDragging(false)
            }))

            unlisteners.push(listen<DragDropPayload>('tauri://drag-drop', async (event) => {
                setIsDragging(false)

                try {
                    // 获取当前窗口
                    const { getCurrentWindow } = await import('@tauri-apps/api/window')
                    const appWindow = getCurrentWindow()

                    // 获取窗口位置 (物理像素)
                    const windowPos = await appWindow.innerPosition()
                    const dropPos = event.payload.position

                    // 计算相对坐标 (物理像素 -> CSS 像素)
                    // dropPos 是屏幕绝对坐标，windowPos 是 WebView 左上角屏幕坐标
                    const scaleFactor = window.devicePixelRatio
                    const clientX = (dropPos.x - windowPos.x) / scaleFactor
                    const clientY = (dropPos.y - windowPos.y) / scaleFactor

                    // 命中测试
                    const targetEl = document.elementFromPoint(clientX, clientY)
                    const containerEl = elementRef.current

                    // 如果没有命中任何元素，或者命中的元素不在我们的容器内，忽略此次 Drop
                    if (!targetEl || !containerEl || !containerEl.contains(targetEl)) {
                        // 可选：记录日志用于调试
                        // console.log('[DragDrop] Drop ignored - outside target area', { clientX, clientY })
                        return
                    }
                } catch (err) {
                    console.error('[DragDrop] Hit test failed:', err)
                    // 如果命中测试出错（例如获取窗口位置失败），为了安全起见，我们选择忽略或者允许？
                    // 考虑到用户体验，如果出错可能就不处理了，或者默认行为。
                    // 这里选择忽略，避免误触发。
                    return
                }

                const paths = event.payload.paths
                if (paths && paths.length > 0) {
                    const files: File[] = []
                    for (const p of paths) {
                        try {
                            const bytes = await readFile(p)
                            const mime = inferMimeFromPath(p)
                            const name = p.split(/[\\/]/).pop() || 'unknown'
                            const file = new File([bytes], name, { type: mime })
                            files.push(file)
                        } catch (e) {
                            logError('Failed to read dropped file:', { data: [p, e] })
                        }
                    }
                    if (files.length > 0) {
                        onDropRef.current(files)
                    }
                }
            }))
        }

        setupListeners()

        return () => {
            unlisteners.forEach(p => p.then(unlisten => unlisten()))
        }
    }, [disabled])

    return { isDragging, elementRef }
}
