/**
 * ImageEditor - 图片编辑器主组件
 * 基于 react-konva 实现
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Ellipse, Arrow, Text, Line, Group, Transformer } from 'react-konva'
import Konva from 'konva'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { EditorToolbar } from './EditorToolbar'
import { CropOverlay } from './CropOverlay'
import { useEditorHistory, useEditorExport } from './hooks'
import type {
    ImageEditorProps,
    EditorTool,
    ToolSettings,
    CropRect,
    CropRatio,
    CanvasState,
    RectAnnotation,
    CircleAnnotation,
    ArrowAnnotation,
    TextAnnotation,
    BrushAnnotation,
    Annotation,
} from './types'

import './ImageEditor.css'

// 默认工具设置
const defaultToolSettings: ToolSettings = {
    strokeColor: '#ff0000',
    fillColor: 'transparent',
    strokeWidth: 3,
    fontSize: 24,
    fontFamily: 'Arial',
    opacity: 1,
}

// 生成唯一 ID
const generateId = () => `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

export const ImageEditor: React.FC<ImageEditorProps> = ({
    imageUrl,
    imageId,
    imageList = [],
    currentIndex = 0,
    initialEditState,
    onClose,
    onSave,
    onNavigate,
}) => {
    // ==================== 状态 ====================
    const [currentTool, setCurrentTool] = useState<EditorTool>('rect')
    const [toolSettings, setToolSettings] = useState<ToolSettings>(defaultToolSettings)
    const [isCropping, setIsCropping] = useState(false)
    const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, width: 100, height: 100 })
    const [cropRatio, setCropRatio] = useState<CropRatio>('free')
    const [image, setImage] = useState<HTMLImageElement | null>(null)
    const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [baseScale, setBaseScale] = useState(1) // 基础缩放比例

    // 绘制状态
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawingAnnotation, setDrawingAnnotation] = useState<Annotation | null>(null)
    const drawStartRef = useRef({ x: 0, y: 0 })

    // 文字输入状态
    const [isEditingText, setIsEditingText] = useState(false)
    const [textInputValue, setTextInputValue] = useState('')
    const [textInputPos, setTextInputPos] = useState({ x: 0, y: 0 })

    // ==================== Refs ====================
    const stageRef = useRef<Konva.Stage>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const layerRef = useRef<Konva.Layer>(null)
    const textInputRef = useRef<HTMLTextAreaElement>(null)
    const transformerRef = useRef<Konva.Transformer>(null)
    const contentGroupRef = useRef<Konva.Group>(null)
    const shapeRefs = useRef<Map<string, Konva.Node>>(new Map())

    // ==================== 编辑历史 ====================
    const initState = useMemo(() => initialEditState || {
        imageId,
        originalDataUrl: imageUrl,
        operations: [],
        currentIndex: -1,
        canvas: {
            flipH: false,
            flipV: false,
            rotation: 0,
            annotations: [],
        },
    }, [initialEditState, imageId, imageUrl])

    const {
        state: editState,
        pushOperation,
        undo,
        redo,
        canUndo,
        canRedo,
    } = useEditorHistory(initState)

    // ==================== 导出 ====================
    const { exportToDataUrl } = useEditorExport()

    // ==================== 加载图片 ====================
    useEffect(() => {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        // 关键修复：如果存在编辑状态（即重新编辑），优先加载原始图片（clean image）作为底图
        // 否则使用传入的 imageUrl（可能是初始上传的图片）
        const srcToLoad = editState?.originalDataUrl || imageUrl
        img.src = srcToLoad
        img.onload = () => {
            setImage(img)
            setImageSize({ width: img.width, height: img.height })
            setCropRect({
                x: img.width * 0.1,
                y: img.height * 0.1,
                width: img.width * 0.8,
                height: img.height * 0.8,
            })
        }
    }, [imageUrl, editState?.originalDataUrl])

    // ==================== 自适应默认值 ====================
    useEffect(() => {
        if (imageSize.width > 0 && imageSize.height > 0) {
            // 计算缩放比例 (以 1000px 为基准)
            const scale = Math.max(imageSize.width, imageSize.height) / 1000
            setBaseScale(scale)

            // 如果是初始状态（没有编辑记录），则应用自适应的工具设置
            // 或者如果不匹配默认值（用户未自定义过），也应用
            // 这里为了简单，我们选择在图片尺寸变化时应用（通常是新图片加载）
            // 并且我们保留用户的颜色选择，只调整大小
            setToolSettings(prev => ({
                ...prev,
                strokeWidth: Math.max(3, Math.round(3 * scale)),
                fontSize: Math.max(48, Math.round(48 * scale))
            }))
        }
    }, [imageSize])

    // ==================== 计算显示尺寸 ====================
    // ==================== 计算显示尺寸 ====================
    // 注意：为了避免切换裁剪工具时图片大小变化，这里始终使用裁剪后的尺寸（如果有）
    // 裁剪模式下，内部的 CropOverlay 会在视觉上显示全图
    const displaySize = useMemo(() => {
        if (!image) return { width: 0, height: 0, scale: 1 }

        const rotation = editState.canvas.rotation || 0
        const isRotated = rotation === 90 || rotation === 270

        // 始终使用裁剪后的尺寸（如果存在），避免切换工具时尺寸跳动
        const crop = editState.canvas.cropRect

        let srcWidth = crop ? crop.width : image.width
        let srcHeight = crop ? crop.height : image.height

        if (isRotated) {
            [srcWidth, srcHeight] = [srcHeight, srcWidth]
        }

        return { width: srcWidth, height: srcHeight, scale: 1 }
    }, [image, editState.canvas.rotation, editState.canvas.cropRect])

    // ==================== 计算 Stage 尺寸 ====================
    useEffect(() => {
        const updateSize = () => {
            if (!containerRef.current || !image) return
            const container = containerRef.current
            const containerWidth = container.clientWidth
            const containerHeight = container.clientHeight
            const padding = 10

            const { width: imgWidth, height: imgHeight } = displaySize
            if (imgWidth === 0 || imgHeight === 0) return

            const scaleX = (containerWidth - padding * 2) / imgWidth
            const scaleY = (containerHeight - padding * 2) / imgHeight
            const scale = Math.min(scaleX, scaleY, 1)

            setStageSize({
                width: Math.max(imgWidth * scale, 100),
                height: Math.max(imgHeight * scale, 100),
            })
        }

        updateSize()
        window.addEventListener('resize', updateSize)
        return () => window.removeEventListener('resize', updateSize)
    }, [image, displaySize])

    // ==================== 计算图片变换 ====================
    const imageTransform = useMemo(() => {
        const { cropRect: crop } = editState.canvas
        return {
            rotation: editState.canvas.rotation || 0,
            cropX: crop?.x || 0,
            cropY: crop?.y || 0,
            cropWidth: crop?.width || imageSize.width,
            cropHeight: crop?.height || imageSize.height,
        }
    }, [editState.canvas, imageSize])

    // ==================== 工具操作 ====================
    const handleToolChange = useCallback((tool: EditorTool) => {
        // 如果从裁剪模式切换到其他工具，自动确认裁剪
        if (isCropping && tool !== 'crop') {
            // 应用当前裁剪
            const newCanvas: CanvasState = {
                ...editState.canvas,
                cropRect: { ...cropRect },
            }
            pushOperation({ type: 'crop', data: { cropRect } }, newCanvas)
            setIsCropping(false)
        }

        if (tool === 'crop') {
            setIsCropping(true)
            const crop = editState.canvas.cropRect
            if (crop) {
                setCropRect(crop)
            } else {
                // 默认裁剪框为全图大小
                setCropRect({
                    x: 0,
                    y: 0,
                    width: imageSize.width,
                    height: imageSize.height,
                })
            }
        } else {
            setIsCropping(false)
        }
        setCurrentTool(tool)
        setSelectedId(null)
    }, [editState.canvas, cropRect, imageSize, isCropping, pushOperation])

    const handleFlipH = useCallback(() => {
        const newCanvas: CanvasState = {
            ...editState.canvas,
            flipH: !editState.canvas.flipH,
        }
        pushOperation({ type: 'flip_h', data: {} }, newCanvas)
    }, [editState.canvas, pushOperation])

    const handleFlipV = useCallback(() => {
        const newCanvas: CanvasState = {
            ...editState.canvas,
            flipV: !editState.canvas.flipV,
        }
        pushOperation({ type: 'flip_v', data: {} }, newCanvas)
    }, [editState.canvas, pushOperation])

    const handleRotate = useCallback(() => {
        const newRotation = ((editState.canvas.rotation || 0) + 90) % 360
        const newCanvas: CanvasState = {
            ...editState.canvas,
            rotation: newRotation,
        }
        pushOperation({ type: 'rotate', data: { rotation: newRotation } }, newCanvas)
    }, [editState.canvas, pushOperation])

    const handleCropConfirm = useCallback(() => {
        const newCanvas: CanvasState = {
            ...editState.canvas,
            cropRect: { ...cropRect },
        }
        pushOperation({ type: 'crop', data: { cropRect } }, newCanvas)
        setIsCropping(false)
        setCurrentTool('rect')
    }, [editState.canvas, cropRect, pushOperation])

    const handleCropCancel = useCallback(() => {
        setIsCropping(false)
        setCurrentTool('rect')
    }, [])

    // ==================== Transformer 更新 ====================
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

    // ==================== 绘制处理 ====================
    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        if (isCropping) return

        // 检查是否点击了背景/图片（而不是标注）
        const clickedOnEmpty = e.target === e.target.getStage() ||
            e.target.getClassName() === 'Image' ||
            e.target.name() === 'background'

        // 如果点击了空白处或图片，取消选择并开始绘制
        if (clickedOnEmpty) {
            setSelectedId(null)
        } else {
            // 点击了某个标注，由标注的 onClick 处理选择
            // 不在这里开始绘制
            return
        }

        const stage = stageRef.current
        if (!stage) return

        const stagePos = stage.getPointerPosition()
        if (!stagePos) return

        // 获取相对于内容组（图片坐标系）的鼠标位置
        const imagePos = contentGroupRef.current?.getRelativePointerPosition() || stagePos

        // 矩形
        if (currentTool === 'rect') {
            setIsDrawing(true)
            drawStartRef.current = { x: imagePos.x, y: imagePos.y }
            const newRect: RectAnnotation = {
                id: generateId(),
                type: 'rect',
                x: imagePos.x,
                y: imagePos.y,
                width: 0,
                height: 0,
                stroke: toolSettings.strokeColor,
                strokeWidth: toolSettings.strokeWidth,
            }
            setDrawingAnnotation(newRect)
        }
        // 圆形/椭圆
        else if (currentTool === 'circle') {
            setIsDrawing(true)
            drawStartRef.current = { x: imagePos.x, y: imagePos.y }
            const newCircle: CircleAnnotation = {
                id: generateId(),
                type: 'circle',
                x: imagePos.x,
                y: imagePos.y,
                radiusX: 0,
                radiusY: 0,
                stroke: toolSettings.strokeColor,
                strokeWidth: toolSettings.strokeWidth,
            }
            setDrawingAnnotation(newCircle)
        }
        // 箭头
        else if (currentTool === 'arrow') {
            setIsDrawing(true)
            drawStartRef.current = { x: imagePos.x, y: imagePos.y }
            const newArrow: ArrowAnnotation = {
                id: generateId(),
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
        }
        // 画笔
        else if (currentTool === 'brush') {
            setIsDrawing(true)
            const newBrush: BrushAnnotation = {
                id: generateId(),
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
        }
        // 文字：输入框需要使用屏幕坐标（Stage坐标）定位
        else if (currentTool === 'text') {
            setTextInputPos({ x: stagePos.x, y: stagePos.y })
            setTextInputValue('')
            setIsEditingText(true)
            setTimeout(() => textInputRef.current?.focus(), 50)
        }
    }, [isCropping, currentTool, toolSettings])

    const handleStageMouseMove = useCallback(() => {
        if (!isDrawing || !drawingAnnotation) return

        const stage = stageRef.current
        if (!stage) return

        // 获取相对于内容组的鼠标位置
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
        }
        else if (drawingAnnotation.type === 'circle') {
            const centerX = (startX + pos.x) / 2
            const centerY = (startY + pos.y) / 2
            setDrawingAnnotation({
                ...drawingAnnotation,
                x: centerX,
                y: centerY,
                radiusX: Math.abs(pos.x - startX) / 2,
                radiusY: Math.abs(pos.y - startY) / 2,
            } as CircleAnnotation)
        }
        else if (drawingAnnotation.type === 'arrow') {
            setDrawingAnnotation({
                ...drawingAnnotation,
                points: [startX, startY, pos.x, pos.y],
            } as ArrowAnnotation)
        }
        else if (drawingAnnotation.type === 'brush') {
            const brush = drawingAnnotation as BrushAnnotation
            setDrawingAnnotation({
                ...brush,
                points: [...brush.points, pos.x, pos.y],
            } as BrushAnnotation)
        }
    }, [isDrawing, drawingAnnotation])

    const handleStageMouseUp = useCallback(() => {
        if (!isDrawing || !drawingAnnotation) return

        let isValid = false

        if (drawingAnnotation.type === 'rect') {
            const rect = drawingAnnotation as RectAnnotation
            isValid = rect.width > 5 && rect.height > 5
        }
        else if (drawingAnnotation.type === 'circle') {
            const circle = drawingAnnotation as CircleAnnotation
            isValid = circle.radiusX > 3 && circle.radiusY > 3
        }
        else if (drawingAnnotation.type === 'arrow') {
            const arrow = drawingAnnotation as ArrowAnnotation
            const dx = arrow.points[2] - arrow.points[0]
            const dy = arrow.points[3] - arrow.points[1]
            isValid = Math.sqrt(dx * dx + dy * dy) > 10
        }
        else if (drawingAnnotation.type === 'brush') {
            const brush = drawingAnnotation as BrushAnnotation
            isValid = brush.points.length > 4
        }

        if (isValid) {
            const newAnnotations = [...editState.canvas.annotations, drawingAnnotation]
            const newCanvas: CanvasState = {
                ...editState.canvas,
                annotations: newAnnotations,
            }
            pushOperation({ type: 'add_annotation', data: { annotation: drawingAnnotation } }, newCanvas)
        }

        setIsDrawing(false)
        setDrawingAnnotation(null)
    }, [isDrawing, drawingAnnotation, editState.canvas, pushOperation])

    // ==================== 文字输入 ====================
    // ==================== 文字输入 ====================
    const handleTextConfirm = useCallback(() => {
        if (textInputValue.trim()) {
            // 将输入框的 Stage 坐标（屏幕坐标）转换为 Image 坐标（Group内部坐标）
            let imageX = textInputPos.x
            let imageY = textInputPos.y

            if (contentGroupRef.current) {
                const transform = contentGroupRef.current.getAbsoluteTransform().copy()
                transform.invert()
                const imagePoint = transform.point(textInputPos)
                imageX = imagePoint.x
                imageY = imagePoint.y
            }

            const newText: TextAnnotation = {
                id: generateId(),
                type: 'text',
                x: imageX,
                y: imageY,
                text: textInputValue,
                fontSize: toolSettings.fontSize,
                fontFamily: toolSettings.fontFamily,
                fill: toolSettings.strokeColor,
            }
            const newAnnotations = [...editState.canvas.annotations, newText]
            const newCanvas: CanvasState = {
                ...editState.canvas,
                annotations: newAnnotations,
            }
            pushOperation({ type: 'add_annotation', data: { annotation: newText } }, newCanvas)
        }
        setIsEditingText(false)
        setTextInputValue('')
    }, [textInputValue, textInputPos, toolSettings, editState.canvas, pushOperation])

    // ==================== 标注拖拽结束 ====================
    // 按照 Konva 官方最佳实践：直接使用 node.x() 和 node.y() 作为新位置
    const handleAnnotationDragEnd = useCallback((id: string, e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target
        const newX = node.x()
        const newY = node.y()

        const newAnnotations = editState.canvas.annotations.map(ann => {
            if (ann.id !== id) return ann

            // 根据类型更新不同的位置属性
            if (ann.type === 'arrow') {
                // 箭头使用 points 数组，需要计算偏移
                const arrow = ann as ArrowAnnotation
                // 计算 points 的边界框来确定原始位置
                const xs = arrow.points.filter((_, i) => i % 2 === 0)
                const ys = arrow.points.filter((_, i) => i % 2 === 1)
                const minX = Math.min(...xs)
                const minY = Math.min(...ys)
                const dx = newX - minX
                const dy = newY - minY
                return {
                    ...arrow,
                    points: arrow.points.map((p, i) => i % 2 === 0 ? p + dx : p + dy),
                }
            } else if (ann.type === 'brush') {
                // 画笔同样使用 points 数组
                const brush = ann as BrushAnnotation
                const xs = brush.points.filter((_, i) => i % 2 === 0)
                const ys = brush.points.filter((_, i) => i % 2 === 1)
                const minX = Math.min(...xs)
                const minY = Math.min(...ys)
                const dx = newX - minX
                const dy = newY - minY
                return {
                    ...brush,
                    points: brush.points.map((p, i) => i % 2 === 0 ? p + dx : p + dy),
                }
            } else {
                // 矩形、椭圆、文字：直接使用新位置
                return { ...ann, x: newX, y: newY }
            }
        })

        const newCanvas: CanvasState = {
            ...editState.canvas,
            annotations: newAnnotations,
        }
        pushOperation({ type: 'modify_annotation', data: { id } }, newCanvas)
    }, [editState.canvas, pushOperation])

    // ==================== 保存和取消 ====================
    // ==================== 保存和取消 ====================
    const handleConfirm = useCallback(async () => {
        if (!stageRef.current) return
        try {
            // 计算 pixelRatio 以确保导出原图分辨率
            // stageSize 是屏幕显示尺寸，displaySize.width 是当前视口在原图中有多少物理像素（宽）
            // 例如：原图1000px，裁剪500px区域，显示在250px的Stage上
            // pixelRatio = 500 / 250 = 2。导出时 250 * 2 = 500px。
            const pixelRatio = displaySize.width / stageSize.width

            const dataUrl = await exportToDataUrl(stageRef.current, {
                pixelRatio: pixelRatio,
                mimeType: 'image/png', // 使用 PNG 保证质量
                quality: 1,
            })
            onSave(dataUrl, editState)
        } catch (error) {
            console.error('导出图片失败:', error)
        }
    }, [editState, exportToDataUrl, onSave, displaySize.width, stageSize.width])

    const handleCancel = useCallback(() => {
        onClose()
    }, [onClose])

    const handleSettingsChange = useCallback((settings: Partial<ToolSettings>) => {
        setToolSettings(prev => ({ ...prev, ...settings }))

        // 如果有选中的标注，同时更新它的属性
        if (selectedId) {
            const newAnnotations = editState.canvas.annotations.map(ann => {
                if (ann.id !== selectedId) return ann

                // 根据标注类型进行属性更新
                if (ann.type === 'rect' || ann.type === 'circle' || ann.type === 'arrow' || ann.type === 'brush') {
                    const updated = { ...ann } as any // Use 'any' for now to bypass strict type checking for common properties
                    if (settings.strokeColor !== undefined) {
                        updated.stroke = settings.strokeColor
                    }
                    if (settings.strokeWidth !== undefined) {
                        updated.strokeWidth = settings.strokeWidth
                    }
                    return updated
                } else if (ann.type === 'text') {
                    const updated = { ...ann } as TextAnnotation
                    if (settings.strokeColor !== undefined) {
                        updated.fill = settings.strokeColor
                    }
                    if (settings.fontSize !== undefined) {
                        updated.fontSize = settings.fontSize
                    }
                    return updated
                }
                return ann
            })

            const newCanvas: CanvasState = {
                ...editState.canvas,
                annotations: newAnnotations,
            }
            pushOperation({ type: 'modify_annotation', data: { id: selectedId, settings } }, newCanvas)
        }
    }, [selectedId, editState.canvas, pushOperation])

    // ==================== 键盘快捷键 ====================
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isEditingText) return

            if (e.key === 'Escape') {
                if (isCropping) {
                    handleCropCancel()
                } else {
                    handleCancel()
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
                const newAnnotations = editState.canvas.annotations.filter(a => a.id !== selectedId)
                const newCanvas: CanvasState = {
                    ...editState.canvas,
                    annotations: newAnnotations,
                }
                pushOperation({ type: 'delete_annotation', data: { id: selectedId } }, newCanvas)
                setSelectedId(null)
                return
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isEditingText, isCropping, handleCropCancel, handleCancel, undo, redo, selectedId, editState.canvas, pushOperation])

    // ==================== 渲染标注 ====================
    const renderAnnotation = useCallback((ann: Annotation) => {
        const isSelected = ann.id === selectedId
        // 匹配工具类型：当前工具与标注类型相同时可以选择/拖拽
        const toolMatchesType = (
            (currentTool === 'rect' && ann.type === 'rect') ||
            (currentTool === 'circle' && ann.type === 'circle') ||
            (currentTool === 'arrow' && ann.type === 'arrow') ||
            (currentTool === 'text' && ann.type === 'text') ||
            (currentTool === 'brush' && ann.type === 'brush')
        )

        const commonProps = {
            draggable: toolMatchesType && isSelected,
            onClick: () => {
                if (toolMatchesType) {
                    setSelectedId(ann.id)
                }
            },
            onTap: () => {
                if (toolMatchesType) {
                    setSelectedId(ann.id)
                }
            },
            onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => handleAnnotationDragEnd(ann.id, e),
            onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
                // 处理 Transformer 变换结束
                const node = e.target
                const scaleX = node.scaleX()
                const scaleY = node.scaleY()
                const newX = node.x()
                const newY = node.y()

                // 重置缩放
                node.scaleX(1)
                node.scaleY(1)

                // 对于箭头和画笔，由于它们使用 absolute points，我们需要重置 x,y 为 0
                // 否则会导致双重偏移（points更新了 + node.x/y偏移）
                if (ann.type === 'arrow' || ann.type === 'brush') {
                    node.x(0)
                    node.y(0)
                }

                const newAnnotations = editState.canvas.annotations.map(a => {
                    if (a.id !== ann.id) return a

                    if (a.type === 'rect') {
                        const rect = a as RectAnnotation
                        return {
                            ...rect,
                            x: newX,
                            y: newY,
                            width: Math.max(5, rect.width * scaleX),
                            height: Math.max(5, rect.height * scaleY),
                        }
                    } else if (a.type === 'circle') {
                        const circle = a as CircleAnnotation
                        return {
                            ...circle,
                            x: newX,
                            y: newY,
                            radiusX: Math.max(3, circle.radiusX * scaleX),
                            radiusY: Math.max(3, circle.radiusY * scaleY),
                        }
                    } else if (a.type === 'text') {
                        const text = a as TextAnnotation
                        return {
                            ...text,
                            x: newX,
                            y: newY,
                            fontSize: Math.max(8, Math.round(text.fontSize * Math.max(scaleX, scaleY))),
                        }
                    } else if (a.type === 'arrow') {
                        // 箭头：缩放所有点并重新定位
                        const arrow = a as ArrowAnnotation
                        const xs = arrow.points.filter((_, i) => i % 2 === 0)
                        const ys = arrow.points.filter((_, i) => i % 2 === 1)
                        const minX = Math.min(...xs)
                        const minY = Math.min(...ys)

                        // 对每个点应用缩放变换
                        const newPoints = arrow.points.map((p, i) => {
                            if (i % 2 === 0) {
                                // x 坐标：相对于原点缩放后加上新位置
                                return newX + (p - minX) * scaleX
                            } else {
                                // y 坐标
                                return newY + (p - minY) * scaleY
                            }
                        })
                        return {
                            ...arrow,
                            points: newPoints,
                        }
                    } else if (a.type === 'brush') {
                        // 画笔：缩放所有点
                        const brush = a as BrushAnnotation
                        const xs = brush.points.filter((_, i) => i % 2 === 0)
                        const ys = brush.points.filter((_, i) => i % 2 === 1)
                        const minX = Math.min(...xs)
                        const minY = Math.min(...ys)

                        const newPoints = brush.points.map((p, i) => {
                            if (i % 2 === 0) {
                                return newX + (p - minX) * scaleX
                            } else {
                                return newY + (p - minY) * scaleY
                            }
                        })
                        return {
                            ...brush,
                            points: newPoints,
                        }
                    }
                    return a
                })

                const newCanvas: CanvasState = {
                    ...editState.canvas,
                    annotations: newAnnotations,
                }
                pushOperation({ type: 'modify_annotation', data: { id: ann.id } }, newCanvas)
            },
            strokeScaleEnabled: false,
        }

        // 保存节点引用
        const saveRef = (node: Konva.Node | null) => {
            if (node) {
                shapeRefs.current.set(ann.id, node)
            } else {
                shapeRefs.current.delete(ann.id)
            }
        }

        switch (ann.type) {
            case 'rect': {
                const rect = ann as RectAnnotation
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
                const circle = ann as CircleAnnotation
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
                const arrow = ann as ArrowAnnotation
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
                const text = ann as TextAnnotation
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
                        {...commonProps}
                    />
                )
            }
            case 'brush': {
                const brush = ann as BrushAnnotation
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
    }, [currentTool, selectedId, handleAnnotationDragEnd, editState.canvas, pushOperation])

    // ==================== 渲染正在绘制的标注 ====================
    const renderDrawingAnnotation = useCallback(() => {
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
                        dash={[5, 5]}
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
                        dash={[5, 5]}
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
                        dash={[5, 5]}
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
                    />
                )
            }
            default:
                return null
        }
    }, [drawingAnnotation])

    // ==================== 渲染 ====================
    if (!image) {
        return (
            <div className="image-editor-container">
                <div className="editor-canvas-area">
                    <div className="editor-info-badge">加载中...</div>
                </div>
            </div>
        )
    }

    const { rotation } = imageTransform

    return (
        <div className="image-editor-container">
            <EditorToolbar
                currentTool={currentTool}
                onToolChange={handleToolChange}
                onFlipH={handleFlipH}
                onFlipV={handleFlipV}
                onRotate={handleRotate}
                onUndo={undo}
                onRedo={redo}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                canUndo={canUndo}
                canRedo={canRedo}
                isCropping={isCropping}
                // 工具设置
                toolSettings={toolSettings}
                onSettingsChange={handleSettingsChange}
                maxStrokeWidth={Math.max(20, Math.round(20 * baseScale * 1.5))}
                maxFontSize={Math.max(72, Math.round(72 * baseScale * 2.5))}
                // 裁剪选项
                cropRatio={cropRatio}
                onCropRatioChange={setCropRatio}
                onCropConfirm={handleCropConfirm}
                onCropCancel={handleCropCancel}
            />

            <div ref={containerRef} className="editor-canvas-area">
                <div className="editor-stage-container">
                    <Stage
                        ref={stageRef}
                        width={stageSize.width}
                        height={stageSize.height}
                        onMouseDown={handleStageMouseDown}
                        onMouseMove={handleStageMouseMove}
                        onMouseUp={handleStageMouseUp}
                        onMouseLeave={handleStageMouseUp}
                        style={{ cursor: currentTool !== 'select' && !isCropping ? 'crosshair' : 'default' }}
                    >
                        <Layer ref={layerRef}>
                            {/* 视口变换组：处理裁剪（位移）和缩放（适配 Stage） */}
                            <Group
                                ref={contentGroupRef}
                                x={stageSize.width / 2}
                                y={stageSize.height / 2}
                                offsetX={(() => {
                                    // 计算视口中心点在内容坐标系中的位置
                                    const showCrop = !isCropping && editState.canvas.cropRect
                                    if (showCrop) {
                                        return editState.canvas.cropRect!.x + editState.canvas.cropRect!.width / 2
                                    }
                                    return imageSize.width / 2
                                })()}
                                offsetY={(() => {
                                    const showCrop = !isCropping && editState.canvas.cropRect
                                    if (showCrop) {
                                        return editState.canvas.cropRect!.y + editState.canvas.cropRect!.height / 2
                                    }
                                    return imageSize.height / 2
                                })()}
                                scaleX={(() => {
                                    const showCrop = !isCropping && editState.canvas.cropRect
                                    const viewportWidth = showCrop ? editState.canvas.cropRect!.width : imageSize.width
                                    const viewportHeight = showCrop ? editState.canvas.cropRect!.height : imageSize.height

                                    const rotation = editState.canvas.rotation || 0
                                    const isRotated = rotation === 90 || rotation === 270
                                    const targetW = isRotated ? viewportHeight : viewportWidth

                                    return stageSize.width / targetW
                                })() * (editState.canvas.flipH ? -1 : 1)}
                                scaleY={(() => {
                                    const showCrop = !isCropping && editState.canvas.cropRect
                                    const viewportWidth = showCrop ? editState.canvas.cropRect!.width : imageSize.width
                                    const viewportHeight = showCrop ? editState.canvas.cropRect!.height : imageSize.height

                                    const rotation = editState.canvas.rotation || 0
                                    const isRotated = rotation === 90 || rotation === 270
                                    const targetW = isRotated ? viewportHeight : viewportWidth

                                    return stageSize.width / targetW
                                })() * (editState.canvas.flipV ? -1 : 1)}
                                rotation={rotation}
                            >
                                {/* 内容组：原点在图片左上角，不再使用 KonvaImage 的 crop */}
                                <KonvaImage
                                    image={image}
                                    x={0}
                                    y={0}
                                    width={imageSize.width}
                                    height={imageSize.height}
                                />
                                {editState.canvas.annotations.map(renderAnnotation)}
                                {renderDrawingAnnotation()}
                            </Group>

                            {/* Transformer 需要在最上层，但它必须关联到 Node */}
                            <Transformer
                                ref={transformerRef}
                                boundBoxFunc={(oldBox, newBox) => {
                                    if (newBox.width < 5 || newBox.height < 5) return oldBox
                                    return newBox
                                }}
                                rotateEnabled={false}
                                keepRatio={selectedId ? editState.canvas.annotations.find(a => a.id === selectedId)?.type === 'text' : false}
                                borderStroke="#007eff"
                                anchorStroke="#007eff"
                                anchorFill="#ffffff"
                                anchorSize={10}
                                anchorCornerRadius={5}
                                enabledAnchors={selectedId && editState.canvas.annotations.find(a => a.id === selectedId)?.type === 'text'
                                    ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                                    : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center', 'middle-left', 'middle-right']
                                }
                                centeredScaling={false}
                                ignoreStroke={true}
                                padding={0}
                            />
                        </Layer>
                    </Stage>

                    {/* 文字输入框 */}
                    {isEditingText && (
                        <textarea
                            ref={textInputRef}
                            className="text-input-overlay"
                            style={{
                                position: 'absolute',
                                left: textInputPos.x,
                                top: textInputPos.y,
                                fontSize: toolSettings.fontSize * (displaySize.width > 0 ? stageSize.width / displaySize.width : 1),
                                color: toolSettings.strokeColor,
                                fontFamily: toolSettings.fontFamily,
                                background: 'rgba(255,255,255,0.9)',
                                border: '2px solid #007eff',
                                borderRadius: '4px',
                                padding: '4px 8px',
                                minWidth: '100px',
                                minHeight: '40px',
                                outline: 'none',
                                resize: 'both',
                            }}
                            value={textInputValue}
                            onChange={(e) => setTextInputValue(e.target.value)}
                            onBlur={handleTextConfirm}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    setIsEditingText(false)
                                    setTextInputValue('')
                                }
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleTextConfirm()
                                }
                            }}
                            placeholder="输入文字..."
                        />
                    )}

                    {isCropping && (
                        <CropOverlay
                            imageWidth={stageSize.width}
                            imageHeight={stageSize.height}
                            cropRect={{
                                x: (cropRect.x / imageSize.width) * stageSize.width,
                                y: (cropRect.y / imageSize.height) * stageSize.height,
                                width: (cropRect.width / imageSize.width) * stageSize.width,
                                height: (cropRect.height / imageSize.height) * stageSize.height,
                            }}
                            cropRatio={cropRatio}
                            onCropRectChange={(rect) => {
                                setCropRect({
                                    x: (rect.x / stageSize.width) * imageSize.width,
                                    y: (rect.y / stageSize.height) * imageSize.height,
                                    width: (rect.width / stageSize.width) * imageSize.width,
                                    height: (rect.height / stageSize.height) * imageSize.height,
                                })
                            }}
                        />
                    )}
                </div>



                <div className="editor-bottom-bar">
                    {imageList.length > 1 && onNavigate && (
                        <>
                            <button className="editor-nav-button" onClick={() => onNavigate('prev')}>
                                <ChevronLeft size={20} />
                            </button>
                            <div className="editor-info-badge">
                                {currentIndex + 1} / {imageList.length}
                            </div>
                            <button className="editor-nav-button" onClick={() => onNavigate('next')}>
                                <ChevronRight size={20} />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

export default ImageEditor
