/**
 * useEditorHistory - 编辑历史管理 Hook
 * 支持撤销/重做，最多 50 步
 */
import { useState, useCallback, useRef } from 'react'
import type { ImageEditState, EditorOperation, CanvasState } from '../types'

const MAX_HISTORY = 50

export interface UseEditorHistoryReturn {
    state: ImageEditState
    pushOperation: (op: Omit<EditorOperation, 'timestamp'>, newCanvasState: CanvasState) => void
    undo: () => void
    redo: () => void
    canUndo: boolean
    canRedo: boolean
    reset: () => void
    updateCanvas: (canvas: Partial<CanvasState>) => void
}

export function useEditorHistory(initialState: ImageEditState): UseEditorHistoryReturn {
    const [state, setState] = useState<ImageEditState>(initialState)

    // 保持初始状态的引用，用于 reset
    const initialStateRef = useRef(initialState)

    // 添加操作到历史
    const pushOperation = useCallback((
        op: Omit<EditorOperation, 'timestamp'>,
        newCanvasState: CanvasState
    ) => {
        setState(prev => {
            // 保存当前 canvas 状态作为操作前的快照
            const operation: EditorOperation = {
                ...op,
                timestamp: Date.now(),
                prevState: { ...prev.canvas },
            }

            // 如果当前不在最新位置（之前有撤销），清除后面的操作
            let newOperations = prev.operations.slice(0, prev.currentIndex + 1)
            newOperations.push(operation)

            // 超过限制时移除最早的
            if (newOperations.length > MAX_HISTORY) {
                newOperations = newOperations.slice(1)
            }

            return {
                ...prev,
                operations: newOperations,
                currentIndex: newOperations.length - 1,
                canvas: newCanvasState,
            }
        })
    }, [])

    // 撤销
    const undo = useCallback(() => {
        setState(prev => {
            if (prev.currentIndex < 0) return prev

            const currentOp = prev.operations[prev.currentIndex]
            const prevCanvasState = currentOp.prevState as CanvasState

            return {
                ...prev,
                currentIndex: prev.currentIndex - 1,
                canvas: prevCanvasState || prev.canvas,
            }
        })
    }, [])

    // 重做
    const redo = useCallback(() => {
        setState(prev => {
            if (prev.currentIndex >= prev.operations.length - 1) return prev

            const nextIndex = prev.currentIndex + 1

            // 重建 canvas 状态
            // 这里需要重新应用操作，简化处理：存储完整状态
            // 实际实现中，我们在 pushOperation 时存储了 newCanvasState
            // 但在撤销时，我们只存储了 prevState
            // 所以重做需要重新计算状态

            // 简化实现：从初始状态开始，重放所有操作到 nextIndex
            let canvas = { ...initialStateRef.current.canvas }
            for (let i = 0; i <= nextIndex; i++) {
                const op = prev.operations[i]
                canvas = applyOperation(canvas, op)
            }

            return {
                ...prev,
                currentIndex: nextIndex,
                canvas,
            }
        })
    }, [])

    // 重置
    const reset = useCallback(() => {
        setState(initialStateRef.current)
    }, [])

    // 直接更新 canvas 状态（不记录到历史）
    const updateCanvas = useCallback((updates: Partial<CanvasState>) => {
        setState(prev => ({
            ...prev,
            canvas: {
                ...prev.canvas,
                ...updates,
            },
        }))
    }, [])

    return {
        state,
        pushOperation,
        undo,
        redo,
        canUndo: state.currentIndex >= 0,
        canRedo: state.currentIndex < state.operations.length - 1,
        reset,
        updateCanvas,
    }
}

// 应用单个操作到 canvas 状态
function applyOperation(canvas: CanvasState, op: EditorOperation): CanvasState {
    switch (op.type) {
        case 'flip_h':
            return { ...canvas, flipH: !canvas.flipH }

        case 'flip_v':
            return { ...canvas, flipV: !canvas.flipV }

        case 'rotate':
            return { ...canvas, rotation: ((canvas.rotation || 0) + 90) % 360 }

        case 'crop':
            return { ...canvas, cropRect: op.data.cropRect }

        case 'add_annotation':
            return {
                ...canvas,
                annotations: [...canvas.annotations, op.data.annotation],
            }

        case 'modify_annotation':
            return {
                ...canvas,
                annotations: canvas.annotations.map(a =>
                    a.id === op.data.id ? { ...a, ...op.data.changes } : a
                ),
            }

        case 'delete_annotation':
            return {
                ...canvas,
                annotations: canvas.annotations.filter(a => a.id !== op.data.id),
            }

        default:
            return canvas
    }
}

export default useEditorHistory
