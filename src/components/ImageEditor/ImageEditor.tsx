/**
 * ImageEditor - 图片编辑器主组件
 * 基于 react-konva 实现
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Konva from 'konva'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { EditorToolbar } from './EditorToolbar'
import { CropOverlay } from './CropOverlay'
import { useEditorHistory, useEditorExport } from './hooks'
import { useAnnotationEditor } from './hooks/useAnnotationEditor'
import { useEditorShortcuts } from './hooks/useEditorShortcuts'
import { useEditorLayout } from './hooks/useEditorLayout'
import { KonvaStage } from './components/KonvaStage'
import { TextInputOverlay } from './components/TextInputOverlay'
import type {
    ImageEditorProps,
    EditorTool,
    ToolSettings,
    CropRect,
    CropRatio,
    CanvasState,
} from './types'
import { DEFAULT_TOOL_SETTINGS, createInitialEditState } from './types'
import { useI18n } from '@/hooks/useI18n'
import { UiIconButton } from '@/components/ui'

import './ImageEditor.css'

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
    const { t } = useI18n('ui')
    // ==================== 状态 ====================
    const [currentTool, setCurrentTool] = useState<EditorTool>('rect')
    const [toolSettings, setToolSettings] = useState<ToolSettings>(DEFAULT_TOOL_SETTINGS)
    const [isCropping, setIsCropping] = useState(false)
    const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, width: 100, height: 100 })
    const [cropRatio, setCropRatio] = useState<CropRatio>('free')
    const toolDefaultsRef = useRef<string | null>(null)
    // ==================== Refs ====================
    const stageRef = useRef<Konva.Stage>(null)
    const contentGroupRef = useRef<Konva.Group>(null)
    // ==================== 编辑历史 ====================
    const initState = useMemo(() => {
        if (initialEditState) return initialEditState
        return createInitialEditState(imageId, imageUrl)
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
    // ==================== 标注交互 ====================
    const {
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
    } = useAnnotationEditor({
        currentTool,
        toolSettings,
        setToolSettings,
        isCropping,
        editCanvas: editState.canvas,
        pushOperation,
        stageRef,
        contentGroupRef,
    })
    // ==================== 图片与布局 ====================
    const handleImageLoaded = useCallback((_: HTMLImageElement, size: { width: number; height: number }) => {
        setCropRect({
            x: size.width * 0.1,
            y: size.height * 0.1,
            width: size.width * 0.8,
            height: size.height * 0.8,
        })
    }, [])

    const {
        image,
        imageSize,
        stageSize,
        displaySize,
        baseScale,
        containerRef,
    } = useEditorLayout({
        imageUrl,
        originalSrc: editState?.originalSrc,
        canvas: editState.canvas,
        onImageLoaded: handleImageLoaded,
    })
    // ==================== 自适应默认值 ====================
    useEffect(() => {
        if (imageSize.width > 0 && imageSize.height > 0) {
            if (toolDefaultsRef.current === imageId) return
            toolDefaultsRef.current = imageId
            setToolSettings(prev => ({
                ...prev,
                strokeWidth: Math.max(3, Math.round(3 * baseScale)),
                fontSize: Math.max(48, Math.round(48 * baseScale)),
            }))
        }
    }, [imageId, imageSize, baseScale])
    // ==================== 工具操作 ====================
    const handleToolChange = useCallback((tool: EditorTool) => {
        if (isCropping && tool !== 'crop') {
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
    }, [editState.canvas, cropRect, imageSize, isCropping, pushOperation, setSelectedId])

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
    // ==================== 保存和取消 ====================
    const handleConfirm = useCallback(async () => {
        if (!stageRef.current) return
        try {
            const pixelRatio = displaySize.width / stageSize.width
            const dataUrl = await exportToDataUrl(stageRef.current, {
                pixelRatio: pixelRatio,
                mimeType: 'image/png',
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

    // ==================== 键盘快捷键 ====================
    useEditorShortcuts({
        isEditingText,
        isCropping,
        selectedId,
        editCanvas: editState.canvas,
        pushOperation,
        setSelectedId,
        onCancel: handleCancel,
        onCropCancel: handleCropCancel,
        undo,
        redo,
    })

    // ==================== 渲染 ====================
    if (!image) {
        return (
            <div className="image-editor-container">
                <div className="editor-canvas-area">
                    <div className="editor-info-badge">{t('common:loading')}</div>
                </div>
            </div>
        )
    }

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
                toolSettings={toolSettings}
                onSettingsChange={handleSettingsChange}
                maxStrokeWidth={Math.max(20, Math.round(20 * baseScale * 1.5))}
                maxFontSize={Math.max(72, Math.round(72 * baseScale * 2.5))}
                cropRatio={cropRatio}
                onCropRatioChange={setCropRatio}
                onCropConfirm={handleCropConfirm}
                onCropCancel={handleCropCancel}
            />

            <div ref={containerRef} className="editor-canvas-area">
                <div className="editor-stage-container">
                    <KonvaStage
                        stageRef={stageRef}
                        contentGroupRef={contentGroupRef}
                        stageSize={stageSize}
                        imageSize={imageSize}
                        image={image}
                        currentTool={currentTool}
                        isCropping={isCropping}
                        canvas={editState.canvas}
                        selectedId={selectedId}
                        drawingAnnotation={drawingAnnotation}
                        textPreview={textPreview}
                        textCaret={textCaret}
                        hiddenAnnotationId={textEditingId}
                        onSelectAnnotation={setSelectedId}
                        onStageMouseDown={handleStageMouseDown}
                        onStageMouseMove={handleStageMouseMove}
                        onStageMouseUp={handleStageMouseUp}
                        onAnnotationDragEnd={handleAnnotationDragEnd}
                        onAnnotationTransformEnd={handleAnnotationTransformEnd}
                        onTextEditStart={startTextEditing}
                    />

                    <TextInputOverlay
                        isEditing={isEditingText}
                        textInputRef={textInputRef}
                        position={textInputPos}
                        value={textInputValue}
                        onChange={setTextInputValue}
                        onConfirm={handleTextConfirm}
                        onCancel={handleTextCancel}
                        textEditingId={textEditingId}
                        annotations={editState.canvas.annotations}
                        toolSettings={toolSettings}
                        displaySize={displaySize}
                        stageSize={stageSize}
                        placeholder={t('ui:imageEditor.textPlaceholder')}
                    />

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
                            <UiIconButton
                                type="button"
                                className="editor-nav-button"
                                onClick={() => onNavigate('prev')}
                            >
                                <ChevronLeft size={20} />
                            </UiIconButton>
                            <div className="editor-info-badge">
                                {currentIndex + 1} / {imageList.length}
                            </div>
                            <UiIconButton
                                type="button"
                                className="editor-nav-button"
                                onClick={() => onNavigate('next')}
                            >
                                <ChevronRight size={20} />
                            </UiIconButton>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

export default ImageEditor
