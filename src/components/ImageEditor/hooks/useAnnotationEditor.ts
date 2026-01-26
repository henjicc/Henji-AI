import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import Konva from 'konva'

import type { Annotation, CanvasState, EditorTool, TextAnnotation, ToolSettings } from '../types'
import type { UseEditorHistoryReturn } from './useEditorHistory'
import {
    createAnnotationId,
    updateAnnotationPosition,
    updateAnnotationTransform,
    updateAnnotationWithSettings,
} from '../utils/annotationUtils'
import { useDrawingHandlers } from './useDrawingHandlers'
import { measureTextWidth, TEXT_LINE_HEIGHT } from '../utils/textMetrics'

export interface UseAnnotationEditorParams {
    currentTool: EditorTool
    toolSettings: ToolSettings
    setToolSettings: Dispatch<SetStateAction<ToolSettings>>
    isCropping: boolean
    editCanvas: CanvasState
    pushOperation: UseEditorHistoryReturn['pushOperation']
    stageRef: React.RefObject<Konva.Stage>
    contentGroupRef: React.RefObject<Konva.Group>
}

export interface UseAnnotationEditorResult {
    selectedId: string | null
    setSelectedId: Dispatch<SetStateAction<string | null>>
    drawingAnnotation: Annotation | null
    textPreview: TextAnnotation | null
    textCaret: { x: number; y: number; height: number; color: string; visible: boolean } | null
    isEditingText: boolean
    textInputPos: { x: number; y: number }
    textInputValue: string
    textEditingId: string | null
    textInputRef: React.RefObject<HTMLTextAreaElement>
    setTextInputValue: Dispatch<SetStateAction<string>>
    handleStageMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => void
    handleStageMouseMove: () => void
    handleStageMouseUp: () => void
    handleAnnotationDragEnd: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void
    handleAnnotationTransformEnd: (annotation: Annotation, node: Konva.Node) => void
    handleSettingsChange: (settings: Partial<ToolSettings>) => void
    handleTextConfirm: () => void
    handleTextCancel: () => void
    startTextEditing: (annotation: TextAnnotation, absPos: { x: number; y: number }) => void
}

export function useAnnotationEditor({
    currentTool,
    toolSettings,
    setToolSettings,
    isCropping,
    editCanvas,
    pushOperation,
    stageRef,
    contentGroupRef,
}: UseAnnotationEditorParams): UseAnnotationEditorResult {
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [textInputPos, setTextInputPos] = useState({ x: 0, y: 0 })
    const [textInputValue, setTextInputValue] = useState('')
    const [isEditingText, setIsEditingText] = useState(false)
    const [textEditingId, setTextEditingId] = useState<string | null>(null)
    const textInputRef = useRef<HTMLTextAreaElement>(null)
    const textStyleOverrideRef = useRef(false)
    const [isCaretVisible, setIsCaretVisible] = useState(false)

    useEffect(() => {
        if (!isEditingText) {
            setIsCaretVisible(false)
            return
        }
        setIsCaretVisible(true)
        const timer = window.setInterval(() => {
            setIsCaretVisible(prev => !prev)
        }, 500)
        return () => window.clearInterval(timer)
    }, [isEditingText])
    const focusTextInput = useCallback(() => {
        setTimeout(() => textInputRef.current?.focus(), 50)
    }, [])
    const startTextInputAtPosition = useCallback((position: { x: number; y: number }) => {
        setTextInputPos(position)
        setTextInputValue('')
        setTextEditingId(null)
        setIsEditingText(true)
        focusTextInput()
    }, [focusTextInput, setSelectedId])

    const {
        drawingAnnotation,
        handleStageMouseDown,
        handleStageMouseMove,
        handleStageMouseUp,
    } = useDrawingHandlers({
        currentTool,
        toolSettings,
        isCropping,
        stageRef,
        contentGroupRef,
        editCanvas,
        pushOperation,
        onClearSelection: () => setSelectedId(null),
        onStartTextInput: startTextInputAtPosition,
    })

    useEffect(() => {
        if (!selectedId) return
        const annotation = editCanvas.annotations.find(ann => ann.id === selectedId)
        if (!annotation) return

        if (annotation.type === 'text') {
            setToolSettings(prev => ({
                ...prev,
                strokeColor: annotation.fill,
                fontSize: annotation.fontSize,
                fontFamily: annotation.fontFamily,
            }))
            return
        }

        if (
            annotation.type === 'rect' ||
            annotation.type === 'circle' ||
            annotation.type === 'arrow' ||
            annotation.type === 'brush'
        ) {
            setToolSettings(prev => ({
                ...prev,
                strokeColor: annotation.stroke,
                strokeWidth: annotation.strokeWidth,
            }))
        }
    }, [selectedId, editCanvas.annotations, setToolSettings])

    const textPreview = useMemo(() => {
        if (!isEditingText) return null

        const existing = textEditingId
            ? editCanvas.annotations.find(a => a.id === textEditingId && a.type === 'text') as TextAnnotation | undefined
            : undefined

        let x = existing?.x
        let y = existing?.y

        let fontSize = toolSettings.fontSize
        let fontFamily = toolSettings.fontFamily
        let fill = toolSettings.strokeColor

        if (existing && !textStyleOverrideRef.current) {
            fontSize = existing.fontSize
            fontFamily = existing.fontFamily
            fill = existing.fill
        }

        if (x === undefined || y === undefined) {
            let imageX = textInputPos.x
            let imageY = textInputPos.y

            if (contentGroupRef.current) {
                const transform = contentGroupRef.current.getAbsoluteTransform().copy()
                transform.invert()
                const imagePoint = transform.point(textInputPos)
                imageX = imagePoint.x
                imageY = imagePoint.y
            }
            const lineHeight = fontSize * TEXT_LINE_HEIGHT
            x = imageX
            y = imageY - lineHeight / 2
        }

        return {
            id: 'text_preview',
            type: 'text',
            x,
            y,
            text: textInputValue,
            fontSize,
            fontFamily,
            fill,
        }
    }, [
        isEditingText,
        textInputValue,
        textEditingId,
        editCanvas.annotations,
        textInputPos,
        toolSettings,
        contentGroupRef,
    ])

    const textCaret = useMemo(() => {
        if (!textPreview) return null

        const lines = textPreview.text.split('\n')
        const lastLine = lines[lines.length - 1] || ''
        const lineIndex = Math.max(lines.length - 1, 0)
        const lineHeight = textPreview.fontSize * TEXT_LINE_HEIGHT
        const width = measureTextWidth(lastLine, textPreview.fontSize, textPreview.fontFamily)
        const caretHeight = textPreview.fontSize

        return {
            x: textPreview.x + width,
            y: textPreview.y + lineIndex * lineHeight + (lineHeight - caretHeight) / 2,
            height: caretHeight,
            color: textPreview.fill,
            visible: isCaretVisible,
        }
    }, [textPreview, isCaretVisible])

    const handleTextConfirm = useCallback(() => {
        if (textInputValue.trim()) {
            if (textEditingId) {
                const newAnnotations = editCanvas.annotations.map(a => {
                    if (a.id === textEditingId && a.type === 'text') {
                        return {
                            ...a,
                            text: textInputValue,
                            fontSize: toolSettings.fontSize,
                            fontFamily: toolSettings.fontFamily,
                            fill: toolSettings.strokeColor,
                        }
                    }
                    return a
                })
                const newCanvas: CanvasState = {
                    ...editCanvas,
                    annotations: newAnnotations,
                }
                pushOperation({ type: 'modify_annotation', data: { id: textEditingId } }, newCanvas)
            } else {
                let imageX = textInputPos.x
                let imageY = textInputPos.y

                if (contentGroupRef.current) {
                    const transform = contentGroupRef.current.getAbsoluteTransform().copy()
                    transform.invert()
                    const imagePoint = transform.point(textInputPos)
                    imageX = imagePoint.x
                    imageY = imagePoint.y
                }
                const lineHeight = toolSettings.fontSize * TEXT_LINE_HEIGHT

                const newText: TextAnnotation = {
                    id: createAnnotationId(),
                    type: 'text',
                    x: imageX,
                    y: imageY - lineHeight / 2,
                    text: textInputValue,
                    fontSize: toolSettings.fontSize,
                    fontFamily: toolSettings.fontFamily,
                    fill: toolSettings.strokeColor,
                }
                const newAnnotations = [...editCanvas.annotations, newText]
                const newCanvas: CanvasState = {
                    ...editCanvas,
                    annotations: newAnnotations,
                }
                pushOperation({ type: 'add_annotation', data: { annotation: newText } }, newCanvas)
            }
        } else if (textEditingId) {
            const newAnnotations = editCanvas.annotations.filter(a => a.id !== textEditingId)
            const newCanvas: CanvasState = {
                ...editCanvas,
                annotations: newAnnotations,
            }
            pushOperation({ type: 'delete_annotation', data: { id: textEditingId } }, newCanvas)
        }

        setIsEditingText(false)
        setTextInputValue('')
        setTextEditingId(null)
        textStyleOverrideRef.current = false
    }, [textInputValue, textInputPos, toolSettings, editCanvas, pushOperation, textEditingId, contentGroupRef])

    const handleTextCancel = useCallback(() => {
        setIsEditingText(false)
        setTextInputValue('')
        setTextEditingId(null)
        textStyleOverrideRef.current = false
    }, [])

    const handleAnnotationDragEnd = useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target
        const newX = node.x()
        const newY = node.y()

        const newAnnotations = editCanvas.annotations.map(ann => {
            if (ann.id !== id) return ann
            return updateAnnotationPosition(ann, newX, newY)
        })

        const newCanvas: CanvasState = {
            ...editCanvas,
            annotations: newAnnotations,
        }
        pushOperation({ type: 'modify_annotation', data: { id } }, newCanvas)
    }, [editCanvas, pushOperation])

    const handleAnnotationTransformEnd = useCallback((annotation: Annotation, node: Konva.Node) => {
        const scaleX = node.scaleX()
        const scaleY = node.scaleY()
        const newX = node.x()
        const newY = node.y()

        node.scaleX(1)
        node.scaleY(1)

        if (annotation.type === 'arrow' || annotation.type === 'brush') {
            node.x(0)
            node.y(0)
        }

        const newAnnotations = editCanvas.annotations.map(ann => {
            if (ann.id !== annotation.id) return ann
            return updateAnnotationTransform(ann, newX, newY, scaleX, scaleY)
        })

        const newCanvas: CanvasState = {
            ...editCanvas,
            annotations: newAnnotations,
        }
        pushOperation({ type: 'modify_annotation', data: { id: annotation.id } }, newCanvas)
    }, [editCanvas, pushOperation])

    const handleSettingsChange = useCallback((settings: Partial<ToolSettings>) => {
        setToolSettings(prev => ({ ...prev, ...settings }))
        if (isEditingText) {
            textStyleOverrideRef.current = true
        }

        if (!selectedId) return

        const newAnnotations = editCanvas.annotations.map(ann => {
            if (ann.id !== selectedId) return ann
            return updateAnnotationWithSettings(ann, settings)
        })

        const newCanvas: CanvasState = {
            ...editCanvas,
            annotations: newAnnotations,
        }
        pushOperation({ type: 'modify_annotation', data: { id: selectedId, settings } }, newCanvas)
    }, [setToolSettings, isEditingText, selectedId, editCanvas, pushOperation])

    const startTextEditing = useCallback((annotation: TextAnnotation, absPos: { x: number; y: number }) => {
        setSelectedId(null)
        textStyleOverrideRef.current = false
        setToolSettings(prev => ({
            ...prev,
            strokeColor: annotation.fill,
            fontSize: annotation.fontSize,
            fontFamily: annotation.fontFamily,
        }))
        setTextEditingId(annotation.id)
        setTextInputValue(annotation.text)
        setTextInputPos(absPos)
        setIsEditingText(true)
        focusTextInput()
    }, [focusTextInput, setSelectedId, setToolSettings])

    return {
        selectedId,
        setSelectedId,
        drawingAnnotation,
        textPreview,
        textCaret,
        isEditingText,
        textInputPos,
        textInputValue,
        textEditingId,
        textInputRef,
        setTextInputValue,
        handleStageMouseDown,
        handleStageMouseMove,
        handleStageMouseUp,
        handleAnnotationDragEnd,
        handleAnnotationTransformEnd,
        handleSettingsChange,
        handleTextConfirm,
        handleTextCancel,
        startTextEditing,
    }
}
