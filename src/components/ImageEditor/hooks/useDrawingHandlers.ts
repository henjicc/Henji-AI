import { useCallback, useRef, useState } from 'react'
import Konva from 'konva'

import type {
    Annotation,
    ArrowAnnotation,
    BrushAnnotation,
    CanvasState,
    CircleAnnotation,
    EditorTool,
    RectAnnotation,
    ToolSettings,
} from '../types'
import type { UseEditorHistoryReturn } from './useEditorHistory'
import { createAnnotationId, isAnnotationValid } from '../utils/annotationUtils'

export interface UseDrawingHandlersParams {
    currentTool: EditorTool
    toolSettings: ToolSettings
    isCropping: boolean
    stageRef: React.RefObject<Konva.Stage>
    contentGroupRef: React.RefObject<Konva.Group>
    editCanvas: CanvasState
    pushOperation: UseEditorHistoryReturn['pushOperation']
    onClearSelection: () => void
    onStartTextInput: (position: { x: number; y: number }) => void
}

export interface UseDrawingHandlersResult {
    drawingAnnotation: Annotation | null
    handleStageMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => void
    handleStageMouseMove: () => void
    handleStageMouseUp: () => void
}

export function useDrawingHandlers({
    currentTool,
    toolSettings,
    isCropping,
    stageRef,
    contentGroupRef,
    editCanvas,
    pushOperation,
    onClearSelection,
    onStartTextInput,
}: UseDrawingHandlersParams): UseDrawingHandlersResult {
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawingAnnotation, setDrawingAnnotation] = useState<Annotation | null>(null)
    const drawStartRef = useRef({ x: 0, y: 0 })

    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        if (isCropping) return

        const clickedOnEmpty = e.target === e.target.getStage() ||
            e.target.getClassName() === 'Image' ||
            e.target.name() === 'background'

        if (clickedOnEmpty) {
            onClearSelection()
        } else {
            return
        }

        const stage = stageRef.current
        if (!stage) return
        const stagePos = stage.getPointerPosition()
        if (!stagePos) return
        const imagePos = contentGroupRef.current?.getRelativePointerPosition() || stagePos

        if (currentTool === 'rect') {
            setIsDrawing(true)
            drawStartRef.current = { x: imagePos.x, y: imagePos.y }
            const newRect: RectAnnotation = {
                id: createAnnotationId(),
                type: 'rect',
                x: imagePos.x,
                y: imagePos.y,
                width: 0,
                height: 0,
                stroke: toolSettings.strokeColor,
                strokeWidth: toolSettings.strokeWidth,
            }
            setDrawingAnnotation(newRect)
            return
        }

        if (currentTool === 'circle') {
            setIsDrawing(true)
            drawStartRef.current = { x: imagePos.x, y: imagePos.y }
            const newCircle: CircleAnnotation = {
                id: createAnnotationId(),
                type: 'circle',
                x: imagePos.x,
                y: imagePos.y,
                radiusX: 0,
                radiusY: 0,
                stroke: toolSettings.strokeColor,
                strokeWidth: toolSettings.strokeWidth,
            }
            setDrawingAnnotation(newCircle)
            return
        }

        if (currentTool === 'arrow') {
            setIsDrawing(true)
            drawStartRef.current = { x: imagePos.x, y: imagePos.y }
            const newArrow: ArrowAnnotation = {
                id: createAnnotationId(),
                type: 'arrow',
                x: 0,
                y: 0,
                points: [imagePos.x, imagePos.y, imagePos.x, imagePos.y],
                stroke: toolSettings.strokeColor,
                strokeWidth: toolSettings.strokeWidth,
                pointerLength: 15,
                pointerWidth: 15,
            }
            setDrawingAnnotation(newArrow)
            return
        }

        if (currentTool === 'brush') {
            setIsDrawing(true)
            const newBrush: BrushAnnotation = {
                id: createAnnotationId(),
                type: 'brush',
                x: 0,
                y: 0,
                points: [imagePos.x, imagePos.y],
                stroke: toolSettings.strokeColor,
                strokeWidth: toolSettings.strokeWidth,
                tension: 0.5,
                lineCap: 'round',
                lineJoin: 'round',
            }
            setDrawingAnnotation(newBrush)
            return
        }

        if (currentTool === 'text') {
            onStartTextInput({ x: stagePos.x, y: stagePos.y })
        }
    }, [
        isCropping,
        stageRef,
        contentGroupRef,
        currentTool,
        toolSettings,
        onClearSelection,
        onStartTextInput,
    ])

    const handleStageMouseMove = useCallback(() => {
        if (!isDrawing || !drawingAnnotation) return

        const stage = stageRef.current
        if (!stage) return

        const pos = contentGroupRef.current?.getRelativePointerPosition() || stage.getPointerPosition()
        if (!pos) return

        const startX = drawStartRef.current.x
        const startY = drawStartRef.current.y

        if (drawingAnnotation.type === 'rect') {
            setDrawingAnnotation({
                ...drawingAnnotation,
                x: Math.min(startX, pos.x),
                y: Math.min(startY, pos.y),
                width: Math.abs(pos.x - startX),
                height: Math.abs(pos.y - startY),
            } as RectAnnotation)
            return
        }

        if (drawingAnnotation.type === 'circle') {
            const centerX = (startX + pos.x) / 2
            const centerY = (startY + pos.y) / 2
            setDrawingAnnotation({
                ...drawingAnnotation,
                x: centerX,
                y: centerY,
                radiusX: Math.abs(pos.x - startX) / 2,
                radiusY: Math.abs(pos.y - startY) / 2,
            } as CircleAnnotation)
            return
        }

        if (drawingAnnotation.type === 'arrow') {
            setDrawingAnnotation({
                ...drawingAnnotation,
                points: [startX, startY, pos.x, pos.y],
            } as ArrowAnnotation)
            return
        }

        if (drawingAnnotation.type === 'brush') {
            const brush = drawingAnnotation as BrushAnnotation
            setDrawingAnnotation({
                ...brush,
                points: [...brush.points, pos.x, pos.y],
            } as BrushAnnotation)
        }
    }, [isDrawing, drawingAnnotation, stageRef, contentGroupRef])

    const handleStageMouseUp = useCallback(() => {
        if (!isDrawing || !drawingAnnotation) return

        if (isAnnotationValid(drawingAnnotation)) {
            const newAnnotations = [...editCanvas.annotations, drawingAnnotation]
            const newCanvas: CanvasState = {
                ...editCanvas,
                annotations: newAnnotations,
            }
            pushOperation({ type: 'add_annotation', data: { annotation: drawingAnnotation } }, newCanvas)
        }

        setIsDrawing(false)
        setDrawingAnnotation(null)
    }, [isDrawing, drawingAnnotation, editCanvas, pushOperation])

    return {
        drawingAnnotation,
        handleStageMouseDown,
        handleStageMouseMove,
        handleStageMouseUp,
    }
}
