import React, { useEffect, useRef } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Ellipse, Arrow, Text, Line, Group, Transformer } from 'react-konva'
import Konva from 'konva'

import type { Annotation, CanvasState, EditorTool, RectAnnotation, CircleAnnotation, ArrowAnnotation, TextAnnotation, BrushAnnotation } from '../types'
import { TEXT_LINE_HEIGHT } from '../utils/textMetrics'

interface KonvaStageProps {
    stageRef: React.RefObject<Konva.Stage>
    contentGroupRef: React.RefObject<Konva.Group>
    stageSize: { width: number; height: number }
    imageSize: { width: number; height: number }
    image: HTMLImageElement
    currentTool: EditorTool
    isCropping: boolean
    canvas: CanvasState
    selectedId: string | null
    drawingAnnotation: Annotation | null
    textPreview?: TextAnnotation | null
    textCaret?: { x: number; y: number; height: number; color: string; visible: boolean } | null
    hiddenAnnotationId?: string | null
    onSelectAnnotation: (id: string | null) => void
    onStageMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => void
    onStageMouseMove: () => void
    onStageMouseUp: () => void
    onAnnotationDragEnd: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void
    onAnnotationTransformEnd: (annotation: Annotation, node: Konva.Node) => void
    onTextEditStart: (annotation: TextAnnotation, absPos: { x: number; y: number }) => void
}

export const KonvaStage: React.FC<KonvaStageProps> = ({
    stageRef,
    contentGroupRef,
    stageSize,
    imageSize,
    image,
    currentTool,
    isCropping,
    canvas,
    selectedId,
    drawingAnnotation,
    textPreview,
    textCaret,
    hiddenAnnotationId,
    onSelectAnnotation,
    onStageMouseDown,
    onStageMouseMove,
    onStageMouseUp,
    onAnnotationDragEnd,
    onAnnotationTransformEnd,
    onTextEditStart,
}) => {
    const transformerRef = useRef<Konva.Transformer>(null)
    const shapeRefs = useRef<Map<string, Konva.Node>>(new Map())

    useEffect(() => {
        if (!transformerRef.current) return

        if (selectedId) {
            const node = shapeRefs.current.get(selectedId)
            if (node) {
                transformerRef.current.nodes([node])
                transformerRef.current.getLayer()?.batchDraw()
            }
        } else {
            transformerRef.current.nodes([])
        }
    }, [selectedId])

    const renderAnnotation = (annotation: Annotation) => {
        if (hiddenAnnotationId && annotation.id === hiddenAnnotationId) {
            return null
        }

        const isSelected = annotation.id === selectedId
        const toolMatchesType = (
            (currentTool === 'rect' && annotation.type === 'rect') ||
            (currentTool === 'circle' && annotation.type === 'circle') ||
            (currentTool === 'arrow' && annotation.type === 'arrow') ||
            (currentTool === 'text' && annotation.type === 'text') ||
            (currentTool === 'brush' && annotation.type === 'brush')
        )

        const commonProps = {
            draggable: toolMatchesType && isSelected,
            onClick: () => {
                if (toolMatchesType) {
                    onSelectAnnotation(annotation.id)
                }
            },
            onTap: () => {
                if (toolMatchesType) {
                    onSelectAnnotation(annotation.id)
                }
            },
            onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onAnnotationDragEnd(annotation.id, e),
            onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                const node = e.target
                onAnnotationTransformEnd(annotation, node)
            },
            strokeScaleEnabled: false,
        }

        const saveRef = (node: Konva.Node | null) => {
            if (node) {
                shapeRefs.current.set(annotation.id, node)
            } else {
                shapeRefs.current.delete(annotation.id)
            }
        }

        switch (annotation.type) {
            case 'rect': {
                const rect = annotation as RectAnnotation
                return (
                    <Rect
                        key={rect.id}
                        ref={saveRef}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        stroke={rect.stroke}
                        strokeWidth={rect.strokeWidth}
                        fill={rect.fill}
                        {...commonProps}
                    />
                )
            }
            case 'circle': {
                const circle = annotation as CircleAnnotation
                return (
                    <Ellipse
                        key={circle.id}
                        ref={saveRef}
                        x={circle.x}
                        y={circle.y}
                        radiusX={circle.radiusX}
                        radiusY={circle.radiusY}
                        stroke={circle.stroke}
                        strokeWidth={circle.strokeWidth}
                        fill={circle.fill}
                        {...commonProps}
                    />
                )
            }
            case 'arrow': {
                const arrow = annotation as ArrowAnnotation
                return (
                    <Arrow
                        key={arrow.id}
                        ref={saveRef}
                        points={arrow.points}
                        stroke={arrow.stroke}
                        strokeWidth={arrow.strokeWidth}
                        pointerLength={arrow.pointerLength || 15}
                        pointerWidth={arrow.pointerWidth || 15}
                        fill={arrow.stroke}
                        {...commonProps}
                    />
                )
            }
            case 'text': {
                const text = annotation as TextAnnotation
                return (
                    <Text
                        key={text.id}
                        ref={saveRef}
                        x={text.x}
                        y={text.y}
                        text={text.text}
                        fontSize={text.fontSize}
                        fontFamily={text.fontFamily}
                        fill={text.fill}
                        lineHeight={TEXT_LINE_HEIGHT}
                        {...commonProps}
                        onDblClick={(e) => {
                            e.cancelBubble = true
                            const node = e.target
                            const absPos = node.getAbsolutePosition()
                            onTextEditStart(text, absPos)
                        }}
                    />
                )
            }
            case 'brush': {
                const brush = annotation as BrushAnnotation
                return (
                    <Line
                        key={brush.id}
                        ref={saveRef}
                        points={brush.points}
                        stroke={brush.stroke}
                        strokeWidth={brush.strokeWidth}
                        tension={brush.tension || 0.5}
                        lineCap={brush.lineCap || 'round'}
                        lineJoin={brush.lineJoin || 'round'}
                        {...commonProps}
                    />
                )
            }
            default:
                return null
        }
    }

    const renderDrawingAnnotation = () => {
        if (!drawingAnnotation) return null

        switch (drawingAnnotation.type) {
            case 'rect': {
                const rect = drawingAnnotation as RectAnnotation
                return (
                    <Rect
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        stroke={rect.stroke}
                        strokeWidth={rect.strokeWidth}
                        fill={rect.fill}
                        strokeScaleEnabled={false}
                    />
                )
            }
            case 'circle': {
                const circle = drawingAnnotation as CircleAnnotation
                return (
                    <Ellipse
                        x={circle.x}
                        y={circle.y}
                        radiusX={circle.radiusX}
                        radiusY={circle.radiusY}
                        stroke={circle.stroke}
                        strokeWidth={circle.strokeWidth}
                        strokeScaleEnabled={false}
                    />
                )
            }
            case 'arrow': {
                const arrow = drawingAnnotation as ArrowAnnotation
                return (
                    <Arrow
                        points={arrow.points}
                        stroke={arrow.stroke}
                        strokeWidth={arrow.strokeWidth}
                        pointerLength={15}
                        pointerWidth={15}
                        fill={arrow.stroke}
                        strokeScaleEnabled={false}
                    />
                )
            }
            case 'brush': {
                const brush = drawingAnnotation as BrushAnnotation
                return (
                    <Line
                        points={brush.points}
                        stroke={brush.stroke}
                        strokeWidth={brush.strokeWidth}
                        tension={0.5}
                        lineCap="round"
                        lineJoin="round"
                        strokeScaleEnabled={false}
                    />
                )
            }
            default:
                return null
        }
    }

    const renderTextPreview = () => {
        if (!textPreview) return null
        return (
            <Text
                key={textPreview.id}
                x={textPreview.x}
                y={textPreview.y}
                text={textPreview.text}
                fontSize={textPreview.fontSize}
                fontFamily={textPreview.fontFamily}
                fill={textPreview.fill}
                lineHeight={TEXT_LINE_HEIGHT}
                listening={false}
            />
        )
    }

    const renderTextCaret = () => {
        if (!textCaret) return null
        return (
            <Line
                points={[textCaret.x, textCaret.y, textCaret.x, textCaret.y + textCaret.height]}
                stroke={textCaret.color}
                strokeWidth={1}
                opacity={textCaret.visible ? 1 : 0}
                listening={false}
            />
        )
    }

    const showCrop = !isCropping && canvas.cropRect
    const viewportWidth = showCrop ? canvas.cropRect!.width : imageSize.width
    const viewportHeight = showCrop ? canvas.cropRect!.height : imageSize.height
    const rotation = canvas.rotation || 0
    const isRotated = rotation === 90 || rotation === 270
    const targetW = isRotated ? viewportHeight : viewportWidth
    const scale = stageSize.width / targetW

    return (
        <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            onMouseDown={onStageMouseDown}
            onMouseMove={onStageMouseMove}
            onMouseUp={onStageMouseUp}
            onMouseLeave={onStageMouseUp}
            style={{ cursor: currentTool !== 'select' && !isCropping ? 'crosshair' : 'default' }}
        >
            <Layer>
                <Group
                    ref={contentGroupRef}
                    x={stageSize.width / 2}
                    y={stageSize.height / 2}
                    offsetX={showCrop
                        ? canvas.cropRect!.x + canvas.cropRect!.width / 2
                        : imageSize.width / 2
                    }
                    offsetY={showCrop
                        ? canvas.cropRect!.y + canvas.cropRect!.height / 2
                        : imageSize.height / 2
                    }
                    scaleX={scale * (canvas.flipH ? -1 : 1)}
                    scaleY={scale * (canvas.flipV ? -1 : 1)}
                    rotation={rotation}
                >
                    <KonvaImage
                        image={image}
                        x={0}
                        y={0}
                        width={imageSize.width}
                        height={imageSize.height}
                    />
                    {canvas.annotations.map(renderAnnotation)}
                    {renderTextPreview()}
                    {renderTextCaret()}
                    {renderDrawingAnnotation()}
                </Group>

                <Transformer
                    ref={transformerRef}
                    boundBoxFunc={(oldBox, newBox) => {
                        if (newBox.width < 5 || newBox.height < 5) return oldBox
                        return newBox
                    }}
                    rotateEnabled={false}
                    keepRatio={selectedId ? canvas.annotations.find(a => a.id === selectedId)?.type === 'text' : false}
                    borderStroke="#007eff"
                    anchorStroke="#007eff"
                    anchorFill="#ffffff"
                    anchorSize={10}
                    anchorCornerRadius={5}
                    enabledAnchors={selectedId && canvas.annotations.find(a => a.id === selectedId)?.type === 'text'
                        ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                        : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center', 'middle-left', 'middle-right']
                    }
                    centeredScaling={false}
                    ignoreStroke={true}
                    padding={0}
                />
            </Layer>
        </Stage>
    )
}
