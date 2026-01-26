import { useCallback, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { CanvasState } from '../types'
import type { UseEditorHistoryReturn } from './useEditorHistory'

export interface UseEditorShortcutsParams {
    isEditingText: boolean
    isCropping: boolean
    selectedId: string | null
    editCanvas: CanvasState
    pushOperation: UseEditorHistoryReturn['pushOperation']
    setSelectedId: Dispatch<SetStateAction<string | null>>
    onCancel: () => void
    onCropCancel: () => void
    undo: UseEditorHistoryReturn['undo']
    redo: UseEditorHistoryReturn['redo']
}

export function useEditorShortcuts({
    isEditingText,
    isCropping,
    selectedId,
    editCanvas,
    pushOperation,
    setSelectedId,
    onCancel,
    onCropCancel,
    undo,
    redo,
}: UseEditorShortcutsParams): void {
    const handleDeleteSelected = useCallback(() => {
        if (!selectedId) return
        const newAnnotations = editCanvas.annotations.filter(a => a.id !== selectedId)
        const newCanvas: CanvasState = {
            ...editCanvas,
            annotations: newAnnotations,
        }
        pushOperation({ type: 'delete_annotation', data: { id: selectedId } }, newCanvas)
        setSelectedId(null)
    }, [selectedId, editCanvas, pushOperation, setSelectedId])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isEditingText) return

            if (e.key === 'Escape') {
                if (isCropping) {
                    onCropCancel()
                } else {
                    onCancel()
                }
                return
            }

            if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                e.preventDefault()
                undo()
                return
            }

            if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
                (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
                e.preventDefault()
                redo()
                return
            }

            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
                handleDeleteSelected()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isEditingText, isCropping, onCropCancel, onCancel, undo, redo, selectedId, handleDeleteSelected])
}
