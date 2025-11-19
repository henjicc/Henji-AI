import { useEffect, useState, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { readFile } from '@tauri-apps/plugin-fs'
import { inferMimeFromPath, isDesktop } from '../utils/save'

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

                // Note: event.payload.position are screen coordinates, while getBoundingClientRect is viewport relative.
                // Strict bounds check is difficult without knowing window position. 
                // For now, we accept the drop if it happens on the window.
                // If we need strict checking, we would need to subtract window.screenX/Y from payload position.

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
                            console.error('Failed to read dropped file:', p, e)
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
